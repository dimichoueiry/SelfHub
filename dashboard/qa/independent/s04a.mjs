import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
try {
const t0 = Date.now();
await page.goto(BASE + "/people");
for (const ms of [200, 700]) { await page.waitForTimeout(ms === 200 ? 200 : 500); await shot(page, `04-people-t${ms}`); }
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
await shot(page, "04-people-matrix", true);
console.log("PEOPLE:", await page.locator("main").innerText());
await page.goto(BASE + "/");
await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
await shot(page, "04-maya-home");
console.log("HOME:", (await page.locator("main").innerText()).slice(0, 900));
} catch (e) { console.log("ERR", e.message); }
console.log(logs.join("\n"));
await browser.close();
