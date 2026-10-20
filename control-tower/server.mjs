import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApprovedModel, assessMilestone, progressBreakdown, approvedRollup, assessScopedCi } from './acceptance.mjs';

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicDir = join(here, "public");
const configPath = join(here, "config", "projects.json");
const cacheTtlMs = 5 * 60 * 1000;
let cachedSnapshot = null;
let cachedAt = 0;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

export function weightedProgress(milestones = []) {
  if (!milestones.length) return null;
  const total = milestones.reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  if (!total) return null;
  const completed = milestones
    .filter((milestone) => milestone.acceptance === "passed")
    .reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  return Math.round((completed / total) * 100);
}

export function buildRollup(projects = []) {
  const baselined = projects.filter((project) => project.baseline && project.milestones?.length);
  const totalWeight = baselined.reduce(
    (sum, project) => sum + project.milestones.reduce((inner, milestone) => inner + Number(milestone.weight || 0), 0),
    0
  );
  const completedWeight = baselined.reduce(
    (sum, project) => sum + project.milestones
      .filter((milestone) => milestone.acceptance === "passed")
      .reduce((inner, milestone) => inner + Number(milestone.weight || 0), 0),
    0
  );
  return {
    percent: totalWeight ? Math.round((completedWeight / totalWeight) * 100) : null,
    baselinedProjects: baselined.length,
    totalProjects: projects.length,
    completedWeight,
    totalWeight
  };
}

function publicProject(project) {
  const progress = project.baseline === true ? weightedProgress(project.milestones) : null;
  return {
    ...project,
    progress,
    milestoneWeight: project.milestones?.reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0) || 0
  };
}

async function githubJson(url, fetchImpl, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "development-control-tower"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}


/**
 * Evidence-only required CI classification.
 * Never treat a successful unrelated workflow or a previous PR head as green.
 * GitHub's pull_request merge-SHA is admissible only with explicit PR/head proof.
 */
export function assessRequiredCi(required, runs, headSha, prNumber) {
  const unknown={verdict:"unverified",checks:[]};
  if(!Array.isArray(required)||!required.length || !Array.isArray(runs) ||
     !/^[a-f0-9]{40}$/.test(headSha)||!Number.isInteger(prNumber)||prNumber<1)
    return unknown;
  const allowed=runs.filter(run=>{
    if(!run||run.event!=="pull_request"||typeof run.name!=="string")return false;
    const refs=Array.isArray(run.pull_requests)?run.pull_requests:[];
    const linked=refs.some(p=>p?.number===prNumber && p.head?.sha===headSha);
    const direct=run.head_sha===headSha && (refs.length===0 || linked);
    return direct||linked;
  });
  const checks=required.map(workflow=>{
    const matching=allowed.filter(r=>r.name===workflow).sort((a,b)=>
      (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0) ||
      (Number(b.run_attempt)||0)-(Number(a.run_attempt)||0) ||
      (Number(b.id)||0)-(Number(a.id)||0));
    const latest=matching[0];
    if(!latest)return {workflow,status:"unverified",runId:null,url:null};
    const status=latest.status==="completed"
      ? latest.conclusion==="success"?"success"
        : ["failure","timed_out","cancelled","startup_failure","action_required"].includes(latest.conclusion)
          ?"failed_or_other":"unverified"
      : ["queued","waiting","pending","in_progress","requested"].includes(latest.status)
        ?"running":"unverified";
    const url=typeof latest.html_url==="string" &&
      /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/actions\/runs\/[0-9]+$/i.test(latest.html_url)
      ? latest.html_url:null;
    return {workflow,status,runId:Number.isSafeInteger(latest.id)?latest.id:null,url};
  });
  const verdict=checks.some(c=>c.status==="failed_or_other")?"failed_or_other"
    :checks.some(c=>c.status==="running")?"running"
    :checks.some(c=>c.status==="unverified")?"unverified":"success";
  return {verdict,checks};
}


/** Recent *observed* GitHub activity, reconstructable without new storage.
 * An updated_at value is a GitHub PR timestamp, NOT proof of an accepted change.
 */
export function sourceActivity(pr, runs, headSha) {
  const events=[];
  const validDate=(value)=>{
    if(typeof value!=="string"||!value.trim())return null;
    const dt=new Date(value);
    return Number.isFinite(dt.getTime())?dt.toISOString():null;
  };
  const validUrl=(value)=>typeof value==="string" &&
    /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:pull\/\d+|actions\/runs\/\d+)$/i.test(value);
  const prAt=validDate(pr?.updated_at);
  if(prAt&&validUrl(pr.html_url))
    events.push({kind:"pr_updated",at:prAt,label:"PR last updated",url:pr.html_url});
  for(const run of (Array.isArray(runs)?runs:[])){
    if(run?.head_sha!==headSha)continue;
    const at=validDate(run.created_at);
    if(!at||!validUrl(run.html_url))continue;
    const name=typeof run.name==="string"?run.name.slice(0,120):"Workflow";
    const outcome=run.status==="completed"?(run.conclusion||"unknown"):(run.status||"unknown");
    events.push({kind:"ci_run",at,label:name+" · "+outcome,url:run.html_url});
  }
  return events.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8);
}

export async function refreshGithub(project, { fetchImpl = fetch, now = new Date(), token = process.env.GITHUB_TOKEN } = {}) {
  if (!project.github?.repository) return null;
  const repo = project.github.repository;
  const prNumber = project.github.pullRequest;
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid repository mapping");
    if (project.github.private && !token) throw new Error("Dedicated read-only GitHub access is not configured; private PR/CI UNKNOWN");
    if (project.github.mode === "open-pulls") {
      const pulls = await githubJson(`https://api.github.com/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`, fetchImpl, token);
      const tracked = pulls.slice(0, 5);
      const pullRequests = await Promise.all(tracked.map(async (pr) => {
        const result = await refreshGithub({ github: { repository: repo, pullRequest: pr.number,
          requiredWorkflows: project.github.requiredWorkflows, private: project.github.private,
          scopedPolicy: project.github.scopedPolicies?.find(s => s.pr === pr.number), policyRequired: project.github.policyRequired } }, { fetchImpl, now, token });
        return { ...result, blockerLabels: (pr.labels || []).map((label) => label.name).filter((name) => /block|needs.?go|approval/i.test(name)) };
      }));
      return { state: "actual_verified", fetchedAt: now.toISOString(), repository: repo, openPullsReturned: pulls.length,
        listingMayBeTruncated: pulls.length === 100, coverage: "Five most recently updated open PRs; not a project completion metric", pullRequests };
    }
    if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("Invalid PR mapping");
    const pr = await githubJson(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, fetchImpl, token);
    const sha = pr.head.sha;
    // A missing secondary scope must not discard the positively verified PR.
    // CI remains UNKNOWN when Actions cannot be read; commit-status UNKNOWN
    // when the commit status API fails. Neither failure becomes a green check.
    const [checkResult, runResult] = await Promise.allSettled([
      githubJson(`https://api.github.com/repos/${repo}/commits/${sha}/status`, fetchImpl, token),
      githubJson(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, fetchImpl, token)
    ]);
    const checks = checkResult.status === "fulfilled" ? checkResult.value : null;
    const runs = runResult.status === "fulfilled" ? runResult.value : null;
    // Never attach a previous head's green run to the current PR. Keep each workflow's latest run.
    const workflows = [...new Map((runs?.workflow_runs || []).filter((run) => run.head_sha === sha)
      .map((run) => [run.workflow_id || run.name, run]).reverse()).values()];
    const requiredCi = project.github.scopedPolicy || project.github.policyRequired
      ? await assessScopedCi(project.github.scopedPolicy, runs?.workflow_runs || [], sha, prNumber, pr.head.ref,
        runId => githubJson(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, fetchImpl, token))
      : assessRequiredCi(project.github.requiredWorkflows, runs?.workflow_runs || [], sha, prNumber);
    // Raw runs are informational. Only requiredCi is the release-evidence assessment.
    const latestRun = workflows.find((run) => run.name === "Platform CI") || workflows[0] || null;
    return {
      state: "actual_verified",
      fetchedAt: now.toISOString(),
      repository: repo,
      pullRequest: {
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        state: pr.state,
        draft: Boolean(pr.draft),
        base: pr.base.ref,
        head: pr.head.ref,
        sha
      },
      ci: latestRun ? {
        name: latestRun.name,
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        runId: latestRun.id,
        url: latestRun.html_url
      } : {
        name: "No pull-request workflow run returned",
        status: "unknown",
        conclusion: null,
        runId: null,
        url: null
      },
      commitStatus: !checks ? "unverified" :
        checks.total_count === 0 ? "not reported" : checks.state || "unknown",
      sourceCoverage: {
        pr: true,
        actions: runResult.status === "fulfilled",
        commitStatus: checkResult.status === "fulfilled"
      },
      requiredCi,
      sourceActivity: sourceActivity(pr, workflows, sha),
      workflows: workflows.map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion, runId: run.id, url: run.html_url, sha: run.head_sha }))
    };
  } catch {
    return {
      state: "unverified",
      fetchedAt: now.toISOString(),
      repository: repo,
      error: project.github.private && !token ? "Dedicated read-only GitHub access is not configured; private PR/CI UNKNOWN" : "GitHub read unavailable; status UNKNOWN (check access, API limit or network)"
    };
  }
}

export async function buildSnapshot(config, options = {}) {
  const now = options.now || new Date();
  const model = validateApprovedModel(options.approvedModel) ? options.approvedModel : null;
  const projectConfig = [...config.projects];
  if (model) for (const p of model.projects) if (!projectConfig.some(c => c.id === p.id)) projectConfig.push({ id: p.id, name: p.name, portfolio: 'Shared tooling', access: 'private-preview', now: [], next: [], blocked: [], milestones: [] });
  const projects = await Promise.all(projectConfig.map(async (project) => {
    const definition = model?.projects.find(p => p.id === project.id);
    const policies = project.id === 'continuum' ? model?.continuumCiPolicy?.selectors : null;
    const sourceProject = policies ? { ...project, github: { ...project.github, scopedPolicies: policies, policyRequired: true } } : project;
    const token = project.github?.private ? options.privateToken || "" : options.token || "";
    const github = await refreshGithub(sourceProject, { ...options, now, token });
    if (definition) {
      const milestones = definition.milestones.map(m => assessMilestone(m, model.receipts?.[m.id], github, model.releaseSha, now));
      const progress = progressBreakdown(milestones, true);
      return { ...publicProject(project), kind: definition.kind, portfolioWeight: definition.portfolioWeight,
        baseline: true, approval: { id: model.proposalId, by: model.approvedBy, at: model.approvedAt },
        milestones, milestoneWeight: 100, progress: progress.overall, progressBreakdown: progress,
        owner: definition.owner, target: definition.target, githubLive: github };
    }
    return { ...publicProject(project), githubLive: github };
  }));
  return {
    schemaVersion: config.schemaVersion,
    source: config.generatedFrom,
    fetchedAt: now.toISOString(),
    projects,
    rollup: model ? approvedRollup(projects) : buildRollup(projects),
    approvedBaseline: model ? { id: model.proposalId, by: model.approvedBy, at: model.approvedAt, releaseSha: model.releaseSha } : null
  };
}

async function getSnapshot() {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < cacheTtlMs) return cachedSnapshot;
  const config = JSON.parse(await readFile(configPath, "utf8"));
  cachedSnapshot = await buildSnapshot(config);
  cachedAt = now;
  return cachedSnapshot;
}

function respond(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

async function serve(request, response) {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  if (request.method !== "GET") return respond(response, 405, JSON.stringify({ error: "READ_ONLY" }));
  if (requestUrl.pathname === "/api/snapshot") {
    return respond(response, 200, JSON.stringify(await getSnapshot()));
  }
  const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safeName = requested.replace(/^\/+/, "");
  if (!["index.html", "app.js", "styles.css"].includes(safeName)) {
    return respond(response, 404, "Not found", "text/plain; charset=utf-8");
  }
  const content = await readFile(join(publicDir, safeName));
  return respond(response, 200, content, mimeTypes[extname(safeName)] || "application/octet-stream");
}

export function createControlTowerServer() {
  return createServer((request, response) => {
    serve(request, response).catch((error) => respond(response, 500, JSON.stringify({ error: "SNAPSHOT_UNAVAILABLE", message: error.message })));
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = Number(process.env.PORT || 4173);
  createControlTowerServer().listen(port, "127.0.0.1", () => {
    console.log(`Development Control Tower available at http://127.0.0.1:${port}`);
  });
}
