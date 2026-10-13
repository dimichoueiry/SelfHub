import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ reduced: true });
const f = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,40)}`; });
const ring = () => page.evaluate(() => [...document.querySelectorAll("[role=treeitem]")].filter(e => e.matches(":focus-visible")).map(e => e.innerText.trim()));
const sel = () => page.evaluate(() => [...document.querySelectorAll("[role=treeitem][aria-selected=true]")].map(e => e.innerText.trim()));
await page.goto(BASE + "/spaces/ads-team?path=README.md"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(800);
await page.getByPlaceholder(/Find a file/).focus();
await page.keyboard.press("Tab"); console.log("tab into tree:", await f());
for (let i = 0; i < 6; i++) { if (/campaign-naming/.test(await f())) break; await page.keyboard.press("ArrowUp"); await page.waitForTimeout(60); console.log("  up ->", await f()); }
console.log("before Enter:", await f());
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("after Enter focus:", await f(), "| focus-visible:", await ring(), "| selected:", await sel(), "| url:", decodeURIComponent(page.url()).split("path=")[1]);
await shot(page, "re/r04b-tree-after-enter");
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("Enter again ->", decodeURIComponent(page.url()).split("path=")[1], "focus:", await f());
await browser.close();
