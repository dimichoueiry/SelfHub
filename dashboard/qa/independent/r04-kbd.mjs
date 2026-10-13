import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const { browser, page } = await open({ reduced: true });
const f = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,50)}`; });
try {
// F-21 exact steps
await page.goto(BASE + "/spaces/ads-team?path=README.md"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(800);
await page.getByRole("treeitem", { name: /README/ }).focus();
for (let i = 0; i < 6; i++) { if (/campaign-naming/.test(await f())) break; await page.keyboard.press("ArrowUp"); }
console.log("before Enter:", await f());
await page.keyboard.press("Enter");
for (const ms of [100, 600, 1500]) { await page.waitForTimeout(ms); console.log(ms, "focus:", await f(), "url:", decodeURIComponent(page.url()).split("path=")[1]); }
await S(page, "r04-tree-focus-csv");
await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("2nd focus:", await f(), "url:", decodeURIComponent(page.url()).split("path=")[1]);
// F-24 CSV rendering
await page.goto(BASE + "/spaces/ads-team?path=templates%2Fcampaign-naming.csv"); await page.waitForTimeout(2000);
console.log("csv tables:", await page.locator("section[aria-label=File] table").count());
await S(page, "r04-csv");
await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(500);
console.log("csv editor label:", await page.locator("textarea").first().getAttribute("aria-label"));
await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(400);
// F-26 reader scroll focusable
await page.goto(BASE + "/spaces/ads-team?path=sops%2Ffacebook-ads.md"); await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(500);
const sc = await page.evaluate(() => { const s = [...document.querySelectorAll("section[aria-label=File] *")].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight); return s ? { tab: s.getAttribute("tabindex"), label: s.getAttribute("aria-label"), role: s.getAttribute("role") } : null; });
console.log("reader scroller:", JSON.stringify(sc));
// tab into it and PageDown
await page.getByRole("button", { name: "Edit", exact: true }).focus();
for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); const x = await f(); if (/region|div/.test(x)) { console.log("tabbed to:", x); break; } }
const before = await page.evaluate(() => [...document.querySelectorAll("section[aria-label=File] *")].find(e => e.getAttribute("tabindex") === "0" && e.scrollHeight > e.clientHeight)?.scrollTop);
await page.keyboard.press("PageDown"); await page.waitForTimeout(300);
const after = await page.evaluate(() => [...document.querySelectorAll("section[aria-label=File] *")].find(e => e.getAttribute("tabindex") === "0" && e.scrollHeight > e.clientHeight)?.scrollTop);
console.log("scrollTop", before, "->", after);
// F-20: Edit -> save via Cmd+S -> focus
await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(400);
const ed = page.getByLabel(/Content of .*/);
await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); await ed.pressSequentially("\n- kbd recheck\n");
await page.keyboard.press("Meta+s"); await page.waitForTimeout(2500);
console.log("after Cmd+S focus:", await f(), JSON.stringify(await toasts(page)));
// palette from button + Esc
const sb = page.getByRole("button", { name: /Search/ }).first();
await sb.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("palette Esc ->", await f());
await page.keyboard.press("Meta+k"); await page.waitForTimeout(300); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("palette (via Cmd+K) Esc ->", await f());
} catch (e) { console.log("ERR", e.message); await S(page, "r04-error"); }
await browser.close();
