import { open, shot, BASE } from "./lib.mjs";
const { browser, page, logs } = await open();
try {
await page.goto(BASE + "/");
await page.getByText("Needs you").waitFor(); await page.waitForTimeout(600);
await page.keyboard.press("Control+k"); await page.waitForTimeout(400);
console.log("Ctrl+K opened:", await page.getByRole("dialog").isVisible().catch(()=>false));
await page.keyboard.type("CPL"); await page.waitForTimeout(1500);
console.log("CPL:", (await page.getByRole("dialog").innerText()).slice(0, 700));
await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(2000);
console.log("after Enter URL:", decodeURIComponent(page.url()));
await shot(page, "08b-opened-result");
// click trigger then Escape -> focus return
await page.getByRole("button", { name: /Search/ }).first().click(); await page.waitForTimeout(300);
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("focus after Esc (click-opened):", await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").slice(0,60)));
} catch (e) { console.log("ERR", e.message); }
console.log(logs.join("\n"));
await browser.close();
