// Olsen Steiner Development Control Tower — source-only; no deployment.
export const PROJECTS = Object.freeze([
  {id:"getacourt", name:"GetACourt", repo:"erikkaniss-ai/fillmycourt", pr:5,
    now:"Provider Connection Foundation: synthetic/read-only contract",
    next:"Official provider authority and protected UAT",
    go:"Authorise a named provider/club for official access review"},
  {id:"fillmycourt", name:"FillMyCourt", repo:"erikkaniss-ai/fillmycourt", pr:8,
    now:"Operator read-only MVP and private UAT",
    next:"Club-owned inventory and cross-tenant hosted acceptance",
    go:"Approve one consenting pilot club"},
  {id:"rebloom", name:"ReBloom", repo:"erikkaniss-ai/rebloom-world", pr:53,
    now:"UX/UI review artifacts",
    next:"Protected staging UX acceptance",
    go:"Confirm current release acceptance and design baseline"},
  {id:"continuum", name:"Continuum", repo:"erikkaniss-ai/continuum-internal-preservation", pr:95,
    now:"Legacy Altegio partner-only read foundation",
    next:"Authorised customer data sync and Concierge QA",
    go:"Approve verified source scopes before any live customer import"}
]);

// Evidence-backed progress only. Do not turn PR count, CI success or elapsed
// time into a completion percentage. An unapproved/unbaselined plan => null.
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
