import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open();
try {
await page.goto(BASE + "/spaces/ads-team");
await page.getByRole("tree").waitFor();
const btn = page.getByRole("button", { name: /updates to pull/ });
await btn.click();
await page.waitForTimeout(500);
await shot(page, "03-ads-sync-popover");
const pop = page.getByRole("dialog");
console.log("POPOVER:", await pop.innerText());
await pop.getByRole("button", { name: /Sync now/ }).click();
await page.waitForTimeout(250);
await shot(page, "03-ads-syncing");
console.log("DURING:", await pop.innerText());
await page.waitForTimeout(4000);
await shot(page, "03-ads-synced");
console.log("AFTER:", await pop.innerText().catch(()=>"(closed)"));
console.log("toasts", await toasts(page));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
console.log("header chip:", await page.getByRole("button", { name: /Synced|pull|pushed/ }).first().innerText());
// Apex from Home
await page.goto(BASE + "/");
await page.getByText("Needs you").waitFor();
await page.waitForTimeout(1200);
const row = page.locator("li, div").filter({ hasText: /^Apex Roofing: local changes not pushed/ }).last();
await page.getByRole("button", { name: /Sync now/ }).last().click();
await page.waitForTimeout(250);
await shot(page, "03-apex-home-syncing");
await page.waitForTimeout(4000);
console.log("toasts", await toasts(page));
await shot(page, "03-apex-home-after");
console.log("NEEDS:", await page.locator("main").innerText().then(t=>t.slice(0,500)));
} catch (e) { console.log("ERR", e.message); await shot(page, "03-error"); }
console.log(logs.join("\n"));
await browser.close();
