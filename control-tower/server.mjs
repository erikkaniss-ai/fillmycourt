import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const progress = weightedProgress(project.milestones);
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

export async function refreshGithub(project, { fetchImpl = fetch, now = new Date(), token = process.env.GITHUB_TOKEN } = {}) {
  if (!project.github?.repository || !project.github?.pullRequest) return null;
  const repo = project.github.repository;
  const prNumber = project.github.pullRequest;
  try {
    const pr = await githubJson(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, fetchImpl, token);
    const sha = pr.head.sha;
    const [checks, runs] = await Promise.all([
      githubJson(`https://api.github.com/repos/${repo}/commits/${sha}/status`, fetchImpl, token),
      githubJson(`https://api.github.com/repos/${repo}/actions/runs?event=pull_request&head_sha=${sha}&per_page=5`, fetchImpl, token)
    ]);
    const latestRun = (runs.workflow_runs || []).find((run) => run.name === "Platform CI") || (runs.workflow_runs || [])[0] || null;
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
      commitStatus: checks.total_count === 0 ? "not reported" : checks.state || "unknown"
    };
  } catch (error) {
    return {
      state: "unverified",
      fetchedAt: now.toISOString(),
      repository: repo,
      error: error.message
    };
  }
}

export async function buildSnapshot(config, options = {}) {
  const now = options.now || new Date();
  const projects = await Promise.all(config.projects.map(async (project) => {
    const github = await refreshGithub(project, { ...options, now });
    return { ...publicProject(project), githubLive: github };
  }));
  return {
    schemaVersion: config.schemaVersion,
    source: config.generatedFrom,
    fetchedAt: now.toISOString(),
    projects,
    rollup: buildRollup(projects)
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
