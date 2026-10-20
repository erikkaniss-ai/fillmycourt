import assert from "node:assert/strict";
import test from "node:test";
import handler from "../netlify/functions/control-tower-snapshot.mts";

test("hosted snapshot rejects wrong site, production context and write methods", async () => {
  const site = { id: "d763b7a1-dccd-4638-8876-ac1670171698" };
  const deployment = { context: "branch-deploy" };
  for (const [request, context, expected] of [
    [new Request("https://preview.test/api/snapshot"), { site: { id: "wrong" }, deploy: deployment }, 503],
    [new Request("https://preview.test/api/snapshot"), { site, deploy: { context: "production" } }, 503],
    [new Request("https://preview.test/api/snapshot", { method: "POST" }), { site, deploy: deployment }, 405]
  ]) {
    const response = await handler(request, context);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  }
});
