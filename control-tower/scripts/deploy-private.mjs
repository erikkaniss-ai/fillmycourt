import { execFileSync } from "node:child_process";
import { join } from "node:path";

const site = "d763b7a1-dccd-4638-8876-ac1670171698";
const target = "https://control-tower--fillmycourt-preview.netlify.app";
const token = process.env.NETLIFY_AUTH_TOKEN;
if (!token || process.env.NETLIFY_SITE_ID !== site) throw Error("Existing private-site credential required");
async function publishedId() {
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${site}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Error(`Deployment metadata unavailable: ${response.status}`);
  const value = await response.json();
  return value.published_deploy?.id;
}
async function assertPrivate(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (response.status !== 401) throw Error(`Expected anonymous HTTP 401 at ${url}; observed ${response.status}`);
}
await assertPrivate("https://fillmycourt-preview.netlify.app/");
const original = await publishedId();
if (!original) throw Error("Published preview baseline is unknown");
const cli = join(process.env.RUNNER_TEMP, "control-tower-tools/node_modules/netlify-cli/bin/run.js");
const output = execFileSync(process.execPath, [cli, "deploy", "--site", site,
  "--dir", "public", "--functions", "netlify/functions", "--alias", "control-tower",
  "--no-build", "--json"], { encoding: "utf8", maxBuffer: 2_000_000 });
const deployment = JSON.parse(output);
if (new URL(deployment.deploy_url).origin !== target) throw Error("Unexpected deploy destination");
if (await publishedId() !== original) throw Error("Published operator preview unexpectedly changed");
await assertPrivate(target + "/");
await assertPrivate(target + "/api/snapshot");
console.log(JSON.stringify({ url: target, deployId: deployment.deploy_id, sourceSha: process.env.GITHUB_SHA,
  publishedOperatorDeployUnchanged: original, anonymousPage: 401, anonymousApi: 401 }));
