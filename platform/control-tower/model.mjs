// Olsen Steiner Development Control Tower — source-only; no deployment.
export const PROJECTS = Object.freeze([
  {id:"getacourt", name:"GetACourt", repo:"erikkaniss-ai/fillmycourt", pr:5,
    required_ci:["Platform CI"],
    now:"Provider Connection Foundation: synthetic/read-only contract",
    next:"Official provider authority and protected UAT",
    go:"Authorise a named provider/club for official access review"},
  {id:"fillmycourt", name:"FillMyCourt", repo:"erikkaniss-ai/fillmycourt", pr:8,
    required_ci:["Platform CI","FillMyCourt private draft preview"],
    now:"Operator read-only MVP and private UAT",
    next:"Club-owned inventory and cross-tenant hosted acceptance",
    go:"Approve one consenting pilot club"},
  {id:"rebloom", name:"ReBloom", repo:"erikkaniss-ai/rebloom-world", pr:53,
    required_ci:["ReBloom canonical Linux validation"],
    now:"UX/UI review artifacts",
    next:"Protected staging UX acceptance",
    go:"Confirm current release acceptance and design baseline"},
  {id:"continuum", name:"Continuum", repo:"erikkaniss-ai/continuum-internal-preservation", pr:95,
    required_ci:[], // Canonical PR CI must be verified before status can be marked green.
    now:"Legacy Altegio partner-only read foundation",
    next:"Authorised customer data sync and Concierge QA",
    go:"Approve verified source scopes before any live customer import"}
]);

// Evidence-backed progress only. Do not turn PR count, CI success or elapsed
// time into a completion percentage. An unapproved/unbaselined plan => null.

/**
 * CI status is based on the required workflow set for the *exact PR HEAD*,
 * never on the most recent (possibly unrelated) passing workflow. A GitHub
 * pull_request workflow may report a synthetic merge SHA: then require a
 * positive pull_requests association with the PR number and source HEAD.
 * Missing, skipped or neutral required evidence remains unverified.
 */
export function classifyRequiredCI(required, runs, headSha, prNumber) {
  const none=Object.freeze({ci:"unverified",ci_url:null,ci_evidence:[]});
  if(!Array.isArray(required)||!required.length||!Array.isArray(runs) ||
      !/^[a-f0-9]{40}$/.test(headSha)||!Number.isSafeInteger(prNumber))return none;
  const matched=runs.filter(run=>{
    if(!run || run.event!=="pull_request" || typeof run.name!=="string")return false;
    const refs=Array.isArray(run.pull_requests)?run.pull_requests:[];
    const linked=refs.some(p=>p && p.number===prNumber && p.head?.sha===headSha);
    const direct=run.head_sha===headSha && (refs.length===0 || linked);
    return direct || linked;
  });
  const evidence=required.map(name=>{
    const candidates=matched.filter(run=>run.name===name);
    candidates.sort((a,b)=>{
      const time=(run)=>Number.isFinite(Date.parse(run.created_at)) ?
        Date.parse(run.created_at) : 0;
      return time(b)-time(a) || (Number(b.run_attempt)||0)-(Number(a.run_attempt)||0)
        || (Number(b.id)||0)-(Number(a.id)||0);
    });
    const run=candidates[0];
    if(!run)return {workflow:name,state:"unverified",url:null};
    const state=run.status==="completed"
      ? run.conclusion==="success"?"success"
        : ["failure","timed_out","cancelled","action_required","startup_failure"].includes(run.conclusion)
          ?"failed_or_other":"unverified"
      : ["queued","pending","in_progress","waiting","requested"].includes(run.status)
        ?"running":"unverified";
    const url=typeof run.html_url==="string" && /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/actions\/runs\/\d+$/i.test(run.html_url)
      ?run.html_url:null;
    return {workflow:name,state,url};
  });
  const states=evidence.map(x=>x.state);
  const ci=states.includes("failed_or_other")?"failed_or_other"
    :states.includes("running")?"running"
      :states.includes("unverified")?"unverified":"success";
  const pick=evidence.find(x=>x.state==="failed_or_other")||evidence.find(x=>x.state==="running")||evidence[0];
  return {ci,ci_url:pick?.url||null,ci_evidence:evidence};
}

export function weightedProgress(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  if (!milestones.every(m => Number.isFinite(m.weight) && m.weight > 0 &&
      typeof m.criterion === "string" && m.criterion.trim() &&
      ["accepted","pending"].includes(m.state) &&
      (m.state !== "accepted" || (typeof m.evidence_url === "string" &&
        /^https:\/\/[^ ]+$/.test(m.evidence_url))))) return null;
  const total = milestones.reduce((a,m) => a + m.weight,0);
  return Math.round(100 * milestones.reduce((a,m) =>
    a + (m.state === "accepted" ? m.weight : 0),0) / total);
}

export function projectView(config, observed) {
  const verified = observed && observed.verified === true;
  return {
    id:config.id,name:config.name,repo:config.repo,pr:config.pr,
    now:config.now,next:config.next,go:config.go,
    go_source:"manual checkpoint, 2026-10-20",
    progress_pct:weightedProgress(config.milestones),
    progress_basis:config.milestones?.length ? "accepted_milestones" : "unbaselined",
    verified:!!verified,
    checked_at:verified ? observed.checked_at : null,
    head_sha:verified ? observed.head_sha : null,
    pr_draft:verified ? observed.pr_draft : null,
    pr_state:verified ? observed.pr_state : "unverified",
    ci:verified ? observed.ci : "unverified",
    ci_url:verified ? observed.ci_url : null,
    ci_evidence:verified ? observed.ci_evidence||[] : [],
    pr_url:"https://github.com/" + config.repo + "/pull/" + config.pr,
    staging:"unverified",
    release:"not_authorized"
  };
}

export function portfolio(configs, observations, at) {
  const projects=configs.map(c=>projectView(c,observations[c.id]));
  return {
    generated_at:at,
    policy:"read_only_observations; no production authority",
    progress_pct:null, // no portfolio % until all product milestone baselines reviewed
    projects,
    summary:{
      projects:projects.length,
      verified:projects.filter(p=>p.verified).length,
      ci_success:projects.filter(p=>p.ci==="success").length,
      needs_owner_go:projects.length,
      unbaselined:projects.filter(p=>p.progress_pct===null).length
    }
  };
}
