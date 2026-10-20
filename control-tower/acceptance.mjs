const shaPattern = /^[a-f0-9]{40}$/;
const knownIncomplete = new Set(['BLOCKED', 'FAILED', 'VERIFIED_NOT_STARTED']);

export function validateApprovedModel(model) {
  if (model?.status !== 'APPROVED' || !model.proposalId || !model.approvedBy ||
      !Number.isFinite(Date.parse(model.approvedAt)) || !Array.isArray(model.projects)) return false;
  const projectIds = new Set(), milestoneIds = new Set();
  for (const project of model.projects) {
    if (!project.id || projectIds.has(project.id) || !project.milestones?.length) return false;
    projectIds.add(project.id);
    let weight = 0;
    for (const milestone of project.milestones) {
      if (!milestone.id || milestoneIds.has(milestone.id) || !Number.isFinite(milestone.weight) || milestone.weight <= 0 ||
          !Array.isArray(milestone.acceptance) || milestone.acceptance.length < 2) return false;
      milestoneIds.add(milestone.id); weight += milestone.weight;
    }
    if (Math.abs(weight - 100) > 0.00001) return false;
  }
  const products = model.projects.filter(p => p.kind === 'product');
  return products.length === 4 && products.every(p => p.portfolioWeight === 25) &&
    model.projects.filter(p => p.kind !== 'product').every(p => p.portfolioWeight === 0);
}

function livePr(github, number) {
  return github?.pullRequests?.find(p => p.pullRequest?.number === number) ||
    (github?.pullRequest?.number === number ? github : null);
}

export function assessMilestone(milestone, receipt, github, releaseSha, now = new Date()) {
  const unknown = reason => ({ ...milestone, acceptanceCriteria: milestone.acceptance,
    acceptance: 'UNKNOWN', evidence: 'unverified', reference: reason, receipt: receipt || null });
  if (!receipt || !receipt.reviewer || !Number.isFinite(Date.parse(receipt.verifiedAt))) return unknown('No complete acceptance receipt; UNKNOWN, not zero completion.');
  if (Date.parse(receipt.verifiedAt) > +now || receipt.expiresAt &&
      (!Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= +now)) return unknown('Acceptance review is expired or has an invalid future timestamp.');
  if (knownIncomplete.has(receipt.status) && receipt.reason && receipt.owner) {
    return { ...unknown(receipt.reason), acceptance: receipt.status, evidence: 'manual' };
  }
  if (receipt.status !== 'ACCEPTED' || receipt.allCriteriaAccepted !== true ||
      receipt.acceptedCriteriaCount !== milestone.acceptance.length || !receipt.evidenceUrls?.length ||
      !['synthetic_verified', 'actual_verified'].includes(receipt.evidence)) return unknown(receipt.reason || 'Acceptance incomplete.');
  if (receipt.scope === 'hosted' && (receipt.evidence !== 'actual_verified' || !receipt.deployId || !receipt.environment || !receipt.sourceSha ||
      !receipt.sourceSha.match(shaPattern) || receipt.hostedQa !== true)) return unknown('Hosted environment/deploy/QA receipt incomplete or synthetic.');
  if (receipt.scope !== 'hosted' && receipt.scope !== 'source_synthetic') return unknown('Unknown acceptance evidence scope.');
  if (receipt.scope === 'source_synthetic' && receipt.evidence !== 'synthetic_verified') return unknown('Source-only evidence scope mismatch.');
  if (receipt.releaseSha && receipt.releaseSha !== releaseSha) return unknown('Dashboard source changed; acceptance must be rechecked.');
  if (receipt.pullRequest) {
    const live = livePr(github, receipt.pullRequest);
    if (!live || live.state !== 'actual_verified' || !shaPattern.test(receipt.sourceSha || '') || live.pullRequest.sha !== receipt.sourceSha)
      return unknown('Receipt source is stale or absent from the bounded live feed.');
    if (live.requiredCi?.verdict !== 'success') return unknown('Current required CI does not satisfy the acceptance receipt.');
  } else if (!receipt.releaseSha) return unknown('No verifiable source association.');
  return { ...milestone, acceptanceCriteria: milestone.acceptance, acceptance: 'ACCEPTED',
    evidence: receipt.evidence, reference: receipt.reason, receipt };
}

export function progressBreakdown(milestones, approved) {
  if (!approved || !milestones?.length) return { approved: false, confirmed: null, unknown: null, unfinished: null, overall: null };
  const total = milestones.reduce((sum, m) => sum + m.weight, 0);
  if (Math.abs(total - 100) > 0.00001) return { approved: false, confirmed: null, unknown: null, unfinished: null, overall: null };
  const confirmed = milestones.filter(m => m.acceptance === 'ACCEPTED').reduce((sum, m) => sum + m.weight, 0);
  const unfinished = milestones.filter(m => knownIncomplete.has(m.acceptance)).reduce((sum, m) => sum + m.weight, 0);
  const unknown = total - confirmed - unfinished;
  return { approved: true, confirmed, unknown, unfinished, overall: unknown > 0 ? null : confirmed };
}

export function approvedRollup(projects) {
  const products = projects.filter(p => p.kind === 'product');
  const valid = products.length === 4 && products.every(p => p.progressBreakdown?.approved && p.portfolioWeight === 25);
  if (!valid) return { percent: null, confirmed: null, unknown: null, unfinished: null, baselinedProjects: 0, totalProjects: 4 };
  const sum = key => products.reduce((n, p) => n + p.progressBreakdown[key] * p.portfolioWeight / 100, 0);
  const confirmed = sum('confirmed'), unknown = sum('unknown'), unfinished = sum('unfinished');
  return { percent: unknown > 0 ? null : confirmed, confirmed, unknown, unfinished, baselinedProjects: 4, totalProjects: 4 };
}

function outcome(status, conclusion) {
  if (status !== 'completed') return ['queued', 'waiting', 'pending', 'requested', 'in_progress'].includes(status) ? 'running' : 'unverified';
  if (conclusion === 'success') return 'success';
  return ['failure', 'timed_out', 'startup_failure'].includes(conclusion) ? 'failed_or_other' : 'unverified';
}

export async function assessScopedCi(selector, runs, sha, prNumber, branch, getJobs) {
  const unknown = reason => ({ verdict: 'unverified', checks: [{ workflow: selector?.workflowName || 'Approved required CI policy', status: 'unverified', reason }] });
  if (!selector || !selector.policyReviewed) return unknown(selector?.policyReason || 'No approved/audited PR policy.');
  if (selector.sha !== sha) return unknown('Source changed since workflow command/risk audit; re-audit required.');
  const candidates = (runs || []).filter(run => {
    const path = String(run.path || '').split('@')[0];
    if (path !== selector.workflowPath) return false;
    const refs = Array.isArray(run.pull_requests) ? run.pull_requests : [];
    const linked = refs.some(p => p.number === prNumber && p.head?.sha === sha);
    return linked && run.event === 'pull_request' || run.head_sha === sha && (run.event === 'pull_request' && (refs.length === 0 || linked) ||
      ['push', 'workflow_dispatch'].includes(run.event) && run.head_branch === branch);
  }).sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) ||
    (Number(b.run_attempt) || 0) - (Number(a.run_attempt) || 0) || (Number(b.id) || 0) - (Number(a.id) || 0));
  const run = candidates[0];
  if (!run) return unknown('No exact workflow-path/source/branch evidence.');
  if (!Number.isSafeInteger(run.id) || run.id < 1) return unknown('Invalid workflow run identity.');
  const base = { workflow: selector.workflowName, runId: run.id, url: run.html_url };
  const runOutcome = outcome(run.status, run.conclusion);
  if (runOutcome !== 'success') return { verdict: runOutcome, checks: [{ ...base, status: runOutcome }] };
  let jobs;
  try { jobs = await getJobs(run.id); } catch { return unknown('Required job/step API unavailable. PR head remains verified.'); }
  if (!jobs || !Number.isInteger(jobs.total_count) || jobs.total_count > jobs.jobs?.length) return unknown('Job evidence truncated or unavailable.');
  const job = jobs.jobs?.filter(j => j.name === selector.job).sort((a, b) => b.id - a.id)[0];
  if (!job || job.head_sha !== run.head_sha) return unknown('Missing required job or job-source association.');
  const checks = [{ ...base, workflow: `${selector.workflowName} / ${selector.job}`, status: outcome(job.status, job.conclusion) }];
  for (const required of selector.requiredSteps || []) {
    const step = job.steps?.find(s => s.name === required);
    checks.push({ ...base, workflow: required, status: step ? outcome(step.status, step.conclusion) : 'unverified' });
  }
  if (!selector.requiredSteps?.length) return unknown('Required steps not audited.');
  const verdict = checks.some(c => c.status === 'failed_or_other') ? 'failed_or_other' :
    checks.some(c => c.status === 'running') ? 'running' : checks.some(c => c.status !== 'success') ? 'unverified' : 'success';
  return { verdict, checks };
}
