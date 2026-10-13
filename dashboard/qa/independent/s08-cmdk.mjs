import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open();
try {
await page.goto(BASE + "/");
await page.getByText("Needs you").waitFor(); await page.waitForTimeout(600);
const trigger = page.getByRole("button", { name: /Search/ }).first();
await page.keyboard.press("Meta+k"); await page.waitForTimeout(400);
let d = page.getByRole("dialog");
console.log("Meta+K opened:", await d.isVisible().catch(()=>false));
await shot(page, "08-cmdk-open");
console.log("EMPTY PALETTE:", await d.innerText());
await page.keyboard.type("urgency");
await page.waitForTimeout(1500); await shot(page, "08-cmdk-urgency");
console.log("RESULTS urgency:", await d.innerText());
await page.keyboard.press("Control+a"); await page.keyboard.type("zzqqxx"); await page.waitForTimeout(1500);
await shot(page, "08-cmdk-none"); console.log("NONE:", await d.innerText());
await page.keyboard.press("Control+a"); await page.keyboard.type("CPL"); await page.waitForTimeout(1500);
console.log("CPL:", await d.innerText());
await shot(page, "08-cmdk-cpl");
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("after Enter URL:", page.url());
await page.keyboard.press("Control+k"); await page.waitForTimeout(400);
console.log("Ctrl+K opened:", await page.getByRole("dialog").isVisible().catch(()=>false));
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("after Esc focused:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0,120)));
// search for bolt content as Sam (no access) - should not leak
await page.keyboard.press("Meta+k"); await page.keyboard.type("Austin"); await page.waitForTimeout(1500);
console.log("Austin (bolt):", await page.getByRole("dialog").innerText());
} catch (e) { console.log("ERR", e.message); await shot(page, "08-error"); }
console.log(logs.join("\n"));
await browser.close();
