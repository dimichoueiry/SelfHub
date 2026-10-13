import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ reduced: true });
const f = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.innerText?.trim().slice(0,40));
await page.goto(BASE + "/spaces/ads-team?path=README.md"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(800);
await page.getByRole("treeitem", { name: /README/ }).focus();
for (const k of ["ArrowUp", "ArrowUp", "ArrowUp"]) await page.keyboard.press(k);
console.log("before Enter:", await f());
await page.keyboard.press("Enter"); 
for (const ms of [100, 600, 1500]) { await page.waitForTimeout(ms); console.log(ms, "focus:", await f(), "url:", decodeURIComponent(page.url()).split("path=")[1]); }
await shot(page, "11b-tree-focus-after-open");
await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("2nd: focus:", await f(), "url:", decodeURIComponent(page.url()).split("path=")[1]);
await browser.close();
