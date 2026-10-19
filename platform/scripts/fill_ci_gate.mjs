// Fail-closed gate for FillMyCourt's EXISTING PRIVATE PR #8 Netlify draft.
// Only GitHub Actions read-scoped token is used. Never logs credentials.
const OWNER_REPO = "erikkaniss-ai/fillmycourt";
const PR = 8;
const HEAD_BRANCH = "fill/operator-mvp-readonly";
const BASE_BRANCH = "platform/v0.4-staging";
const WORKFLOW = ".github/workflows/platform-ci.yml";
const SHA_PATTERN = /^[a-f0-9]{40}$/;

export function classifyFullCi(runs, expectedSha) {
  if (!SHA_PATTERN.test(expectedSha)) throw Error("INVALID_SHA");
  if (!Array.isArray(runs)) throw Error("INVALID_CI_RESPONSE");
  const matching = runs.filter(r =>
    r.head_sha === expectedSha &&
    r.head_branch === HEAD_BRANCH &&
    r.head_repository?.full_name === OWNER_REPO &&
    r.event === "pull_request" &&
    r.path === WORKFLOW &&
    Array.isArray(r.pull_requests) &&
    r.pull_requests.some(p =>
      p.number === PR &&
      p.head?.sha === expectedSha &&
      p.head?.ref === HEAD_BRANCH &&
      p.base?.ref === BASE_BRANCH)
  ).sort((a,b) => b.run_number-a.run_number || b.run_attempt-a.run_attempt);
  if (!matching.length) return {status:"WAIT", reason:"NO_MATCHING_FULL_CI"};
  const run = matching[0];
  if (run.status !== "completed") return {status:"WAIT", reason:"FULL_CI_PENDING"};
  if (run.conclusion !== "success") return {status:"BLOCK", reason:"FULL_CI_NOT_SUCCESS"};
  return {status:"READY", runId:run.id};
}

export function matchesCurrentPr(pr, expectedSha) {
  return SHA_PATTERN.test(expectedSha) &&
    pr?.number === PR &&
    pr?.state === "open" &&
    pr?.draft === true &&
    pr?.head?.sha === expectedSha &&
    pr?.head?.ref === HEAD_BRANCH &&
    pr?.head?.repo?.full_name === OWNER_REPO &&
    pr?.base?.ref === BASE_BRANCH &&
    pr?.base?.repo?.full_name === OWNER_REPO;
}

async function githubApi(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw Error("GITHUB_TOKEN_UNAVAILABLE");
  const res = await fetch("https://api.github.com" + path, {
    headers:{
      accept:"application/vnd.github+json",
      authorization:"Bearer " + token,
      "x-github-api-version":"2022-11-28"
    },
    signal:AbortSignal.timeout(12000)
  });
  if (!res.ok) throw Error("GITHUB_API_UNAVAILABLE_" + res.status);
  return await res.json();
}

async function assertHead(sha) {
  const pr = await githubApi("/repos/" + OWNER_REPO + "/pulls/" + PR);
  if (!matchesCurrentPr(pr,sha)) throw Error("PR_HEAD_CHANGED_OR_NOT_PRIVATE_DRAFT");
}

async function main() {
  const sha = process.env.SOURCE_SHA;
  if (!SHA_PATTERN.test(sha || "")) throw Error("INVALID_SOURCE_SHA");
  await assertHead(sha);
  if (process.argv.includes("--check-head")) {
    console.log("Existing private PR #8 HEAD confirmed; no other repo or branch authorized.");
    return;
  }
  for (let attempt=0; attempt<70; attempt++) {
    const response = await githubApi(
      "/repos/" + OWNER_REPO + "/actions/workflows/platform-ci.yml/runs" +
      "?head_sha=" + sha + "&event=pull_request&per_page=100"
    );
    const check = classifyFullCi(response.workflow_runs,sha);
    if (check.status === "BLOCK") throw Error(check.reason);
    if (check.status === "READY") {
      await assertHead(sha);
      console.log("Exact SHA full Platform CI SUCCESS:",check.runId);
      return;
    }
    if (attempt === 69) throw Error("FULL_CI_TIMEOUT_FAIL_CLOSED");
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch(err=>{console.error("FILL_PRIVATE_DEPLOY_BLOCKED:",err.message);process.exitCode=1;});
}
