import { open, shot, BASE } from "./lib.mjs";
const { browser, page, logs } = await open();
const t0 = Date.now();
await page.goto(BASE + "/");
// capture early frames for flash detection
for (const ms of [150, 500, 1000]) { await page.waitForTimeout(ms === 150 ? 150 : ms - 150); await shot(page, `01-home-1440-light-t${ms}`); }
await page.waitForLoadState("networkidle");
console.log("networkidle after", Date.now() - t0, "ms");
await shot(page, "01-home-1440-light", true);
console.log(await page.locator("body").innerText());
console.log(logs.join("\n"));
await browser.close();
