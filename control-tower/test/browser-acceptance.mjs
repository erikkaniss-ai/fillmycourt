import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createControlTowerServer } from "../server.mjs";

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
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
