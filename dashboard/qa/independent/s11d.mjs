import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ user: "maya", reduced: true });
const info = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,40)}`; });
await page.goto(BASE + "/people"); await page.getByText("Leo Park").first().waitFor(); await page.waitForTimeout(500);
await page.getByRole("button", { name: /Leo Park, open/ }).focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
const cb = page.getByRole("combobox", { name: /access to Ads Team/ });
await cb.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
console.log("options:", await page.getByRole("option").evaluateAll(o => o.map(x => `${x.innerText.split("\n")[0]} disabled=${x.getAttribute("aria-disabled")||x.dataset.disabled||""}`)));
for (let i = 0; i < 5; i++) { console.log(" ", await info()); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(80); }
await page.keyboard.press("End"); console.log("End:", await info());
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
console.log("after Enter:", await info(), "| alertdialog:", await page.getByRole("alertdialog").count());
await shot(page, "11d-kbd-after-select");
if (await page.getByRole("alertdialog").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); console.log("Esc confirm ->", await info(), "| cb:", await cb.innerText().catch(()=>"gone")); }
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
console.log("Esc drawer ->", await info());
await browser.close();
