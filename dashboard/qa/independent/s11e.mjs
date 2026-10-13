import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ user: "maya", reduced: true });
const info = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,40)}`; });
await page.goto(BASE + "/people"); await page.getByText("Leo Park").first().waitFor(); await page.waitForTimeout(500);
const leo = page.getByRole("button", { name: /Leo Park, open/ });
for (const key of ["Space", "Enter"]) {
  await leo.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const cb = page.getByRole("combobox", { name: /access to Northline/ });
  await cb.focus(); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
  console.log(key, "opened with ArrowDown, focus:", await info());
  await page.keyboard.press("End"); await page.waitForTimeout(100);
  console.log(" focus:", await info());
  await page.keyboard.press(key); await page.waitForTimeout(700);
  console.log(" after", key, "focus:", await info(), "alertdialog:", await page.getByRole("alertdialog").count(), "value:", await cb.innerText().catch(()=>"?"));
  await shot(page, `11e-${key}`);
  if (await page.getByRole("alertdialog").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); console.log(" Esc confirm ->", await info()); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  console.log(" Esc drawer ->", await info());
}
// mouse for comparison
await leo.click(); await page.waitForTimeout(400);
await page.getByRole("combobox", { name: /access to Northline/ }).click(); await page.getByRole("option", { name: /^No access/ }).click(); await page.waitForTimeout(500);
console.log("mouse: alertdialog", await page.getByRole("alertdialog").count(), "focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(400); console.log("mouse Esc confirm ->", await info());
await browser.close();
