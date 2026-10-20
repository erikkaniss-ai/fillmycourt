import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createControlTowerServer, buildSnapshot } from "../server.mjs";

const requireTools = createRequire(process.env.CONTROL_TOWER_TOOLS + "/package.json");
const { chromium } = requireTools("playwright-core");
const server = createControlTowerServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator(".project-card").first().waitFor({ timeout: 30000 });
    assert.equal(await page.locator(".project-card").count(), 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}`);
    await page.locator("summary").first().click();
    assert.equal(await page.locator("details").first().getAttribute("open"), "");
    console.log(`Browser PASS: ${width}px, five cards, milestone expansion, no horizontal overflow`);
  }
  assert.deepEqual(errors, []);
  // Generic synthetic baseline only; private engineering data never enters CI logs.
  const config = { projects: Array.from({ length: 6 }, (_, i) => ({
    id: 'p' + i, name: 'Synthetic project ' + i, portfolio: 'Test', access: 'private-preview',
    now: [], next: [], blocked: [], history: [], environments: []
  })) };
  const approvedModel = { status: 'APPROVED', proposalId: 'synthetic-test',
    approvedBy: 'Fictional owner', approvedAt: '2026-01-01T00:00:00Z', receipts: {},
    projects: config.projects.map((p, i) => ({ ...p, kind: i < 4 ? 'product' : 'dependency',
      portfolioWeight: i < 4 ? 25 : 0, milestones: [
        { id: 'M' + i, name: 'Synthetic acceptance', weight: 100, acceptance: ['First condition', 'Second condition'] }
      ] }))
  };
  approvedModel.projectReviews = { p0: {
    reviewedAt: '2026-01-01T00:00:00Z', reviewer: 'Fictional reviewer', scope: 'Synthetic decision review',
    blocked: ['Reviewer: missing exact artifact acceptance; do not infer completion.'],
    links: [{title: 'Untrusted protocol must not become a link', url: 'javascript:alert(1)'}]
  }};
  const fixture = await buildSnapshot(config, { approvedModel });
  await page.route('**/api/snapshot', route => route.fulfill({ json: fixture }));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.locator('.project-card').first().waitFor();
    assert.equal(await page.locator('.project-card').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.progress-label').first().innerText(), '0% confirmed · 100% UNKNOWN');
    assert.match(await page.locator('#rollup').innerText(), /Confirmed: 0%; UNKNOWN: 100%/);
    assert.match(await page.locator('.project-card').first().innerText(), /Reviewer: missing exact artifact acceptance/);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('.rollup-number').evaluate(e =>
      getComputedStyle(e).whiteSpace === 'nowrap'), true, 'UNKNOWN must remain readable on one line');
    console.log('Approved-model browser PASS: ' + width + 'px, six cards, UNKNOWN preserved');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
