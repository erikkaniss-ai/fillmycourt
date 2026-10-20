import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMilestone, progressBreakdown, approvedRollup, assessScopedCi, validateApprovedModel } from '../acceptance.mjs';
import { buildSnapshot } from '../server.mjs';
const sha = 'a'.repeat(40), now = new Date('2026-10-21T00:00:00Z');
const milestone = { id: 'A1', weight: 25, acceptance: ['one', 'two'] };
const receipt = { status: 'ACCEPTED', scope: 'source_synthetic', evidence: 'synthetic_verified', allCriteriaAccepted: true,
  acceptedCriteriaCount: 2, reviewer: 'Test reviewer', verifiedAt: '2026-10-20T10:00:00Z', sourceSha: sha,
  pullRequest: 1, evidenceUrls: ['https://github.com/org/repo/actions/runs/1'] };
const github = { state: 'actual_verified', pullRequest: { number: 1, sha }, requiredCi: { verdict: 'success' } };

test('unknown weight stays in denominator and prevents overall percentage', () => {
  const points = progressBreakdown([{ weight: 25, acceptance: 'ACCEPTED' }, { weight: 20, acceptance: 'BLOCKED' }, { weight: 55, acceptance: 'UNKNOWN' }], true);
  assert.deepEqual(points, { approved: true, confirmed: 25, unknown: 55, unfinished: 20, overall: null });
  assert.equal(progressBreakdown([{ weight: 100, acceptance: 'ACCEPTED' }], false).confirmed, null);
  assert.equal(progressBreakdown([{ weight: 100, acceptance: 'ACCEPTED' }], true).overall, 100);
  assert.equal(progressBreakdown([{ weight: 99, acceptance: 'ACCEPTED' }], true).approved, false);
});

test('milestone only earns all-or-nothing weight with current exact required CI', () => {
  assert.equal(assessMilestone(milestone, receipt, github, null, now).acceptance, 'ACCEPTED');
  for (const mutated of [{ ...receipt, acceptedCriteriaCount: 1 }, { ...receipt, allCriteriaAccepted: false }, { ...receipt, reviewer: null }])
    assert.equal(assessMilestone(milestone, mutated, github, null, now).acceptance, 'UNKNOWN');
  assert.equal(assessMilestone(milestone, receipt, { ...github, pullRequest: { number: 1, sha: 'b'.repeat(40) } }, null, now).acceptance, 'UNKNOWN');
  assert.equal(assessMilestone(milestone, receipt, { ...github, requiredCi: { verdict: 'running' } }, null, now).acceptance, 'UNKNOWN');
});

test('synthetic evidence never satisfies hosted or stale review', () => {
  const hosted = { ...receipt, scope: 'hosted', deployId: 'deploy', environment: 'preview', hostedQa: true };
  assert.equal(assessMilestone(milestone, hosted, github, null, now).acceptance, 'UNKNOWN');
  assert.equal(assessMilestone(milestone, { ...receipt, releaseSha: sha }, github, 'b'.repeat(40), now).acceptance, 'UNKNOWN');
  assert.equal(assessMilestone(milestone, { ...receipt, verifiedAt: '2028-01-01T00:00:00Z' }, github, null, now).acceptance, 'UNKNOWN');
  assert.equal(assessMilestone(milestone, { status: 'BLOCKED', owner: 'Owner', reason: 'Gate', reviewer: 'QA', verifiedAt: receipt.verifiedAt, expiresAt: '2026-10-20T12:00:00Z' }, github, null, now).acceptance, 'UNKNOWN');
});

test('four product rollup cannot count infrastructure or omit an unknown product', () => {
  const products = Array.from({ length: 4 }, () => ({ kind: 'product', portfolioWeight: 25, progressBreakdown: { approved: true, confirmed: 20, unknown: 80, unfinished: 0 } }));
  const rollup = approvedRollup([...products, { kind: 'dependency', portfolioWeight: 0, progressBreakdown: { approved: true, confirmed: 100, unknown: 0 } }]);
  assert.equal(rollup.confirmed, 20); assert.equal(rollup.unknown, 80); assert.equal(rollup.percent, null);
  assert.equal(approvedRollup(products.slice(1)).confirmed, null);
});

const selector = { sha, workflowPath: '.github/workflows/source.yml', workflowName: 'Required source', job: 'verify', requiredSteps: ['Full regression', 'Git clean'], policyReviewed: true };
const run = { id: 10, path: selector.workflowPath, head_sha: sha, event: 'push', head_branch: 'feature', status: 'completed', conclusion: 'success', created_at: '2026-10-20T10:00:00Z' };
const jobs = { total_count: 1, jobs: [{ id: 1, name: 'verify', head_sha: sha, status: 'completed', conclusion: 'success', steps: selector.requiredSteps.map(name => ({ name, status: 'completed', conclusion: 'success' })) }] };
test('scoped Continuum policy verifies push branch, path, source, job and every required step', async () => {
  const result = await assessScopedCi(selector, [run], sha, 1, 'feature', async () => jobs);
  assert.equal(result.verdict, 'success'); assert.equal(result.checks.length, 3);
  for (const mutated of [{ ...run, path: '.github/workflows/packaging.yml' }, { ...run, head_sha: 'b'.repeat(40) }, { ...run, head_branch: 'wrong' }])
    assert.equal((await assessScopedCi(selector, [mutated], sha, 1, 'feature', async () => jobs)).verdict, 'unverified');
  const unrelatedPr = { ...run, event: 'pull_request', pull_requests: [{ number: 2, head: { sha } }] };
  assert.equal((await assessScopedCi(selector, [unrelatedPr], sha, 1, 'feature', async () => jobs)).verdict, 'unverified');
});

test('missing, skipped, cancelled, truncated or unavailable step evidence fails closed', async () => {
  for (const conclusion of ['skipped', 'cancelled', 'neutral']) {
    const altered = structuredClone(jobs); altered.jobs[0].steps[1].conclusion = conclusion;
    assert.equal((await assessScopedCi(selector, [run], sha, 1, 'feature', async () => altered)).verdict, 'unverified');
  }
  assert.equal((await assessScopedCi(selector, [run], sha, 1, 'feature', async () => ({ ...jobs, total_count: 2 }))).verdict, 'unverified');
  assert.equal((await assessScopedCi(selector, [run], sha, 1, 'feature', async () => { throw Error('private credential'); })).verdict, 'unverified');
  assert.equal((await assessScopedCi({ ...selector, policyReviewed: false }, [run], sha, 1, 'feature', async () => jobs)).verdict, 'unverified');
});

test('latest failed required attempt cannot be masked by an old green run', async () => {
  const failed = { ...run, id: 11, run_attempt: 2, conclusion: 'failure', created_at: '2026-10-20T11:00:00Z' };
  assert.equal((await assessScopedCi(selector, [run, failed], sha, 1, 'feature', async () => jobs)).verdict, 'failed_or_other');
  assert.equal((await assessScopedCi(selector, [{ ...run, conclusion: 'cancelled' }], sha, 1, 'feature', async () => jobs)).verdict, 'unverified');
});

test('draft or tampered approved model never activates a baseline', () => {
  assert.equal(validateApprovedModel({ status: 'DRAFT_FOR_ERIK_APPROVAL' }), false);
  const model = { status: 'APPROVED', proposalId: 'test', approvedBy: 'Owner', approvedAt: receipt.verifiedAt,
    projects: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, kind: 'product', portfolioWeight: 25, milestones: [{ id: `M${i}`, weight: 100, acceptance: ['a', 'b'] }] })) };
  assert.equal(validateApprovedModel(model), true);
  model.projects[0].milestones[0].weight = 99;
  assert.equal(validateApprovedModel(model), false);
});

test('approved model integrates six cards without treating absent evidence as completed', async () => {
  const projects = Array.from({ length: 6 }, (_, i) => ({
    id: 'p' + i, name: 'Fictional project', kind: i < 4 ? 'product' : 'dependency',
    portfolioWeight: i < 4 ? 25 : 0,
    milestones: [{ id: 'M' + i, weight: 100, acceptance: ['one', 'two'] }]
  }));
  const approvedModel = { status: 'APPROVED', proposalId: 'test', approvedBy: 'Owner',
    approvedAt: receipt.verifiedAt, projects, receipts: {} };
  const result = await buildSnapshot({ projects: projects.slice(0, 5).map(p => ({ id: p.id })) }, {
    approvedModel, privateToken: 'never-return-this', now
  });
  assert.equal(result.projects.length, 6);
  assert.equal(result.projects.every(p => p.baseline && p.progress === null && p.progressBreakdown.unknown === 100), true);
  assert.equal(result.rollup.confirmed, 0);
  assert.equal(result.rollup.unknown, 100);
  assert.equal(result.rollup.percent, null);
  assert.equal(JSON.stringify(result).includes('never-return-this'), false);
});
