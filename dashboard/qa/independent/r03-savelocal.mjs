import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const mode = process.argv[2];
const { browser, page, logs } = await open();
const info = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,50)}`; });
try {
if (mode === "home") {
  await page.goto(BASE + "/"); await page.getByText("Needs you").waitFor(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Review and save" }).click(); await page.waitForTimeout(600);
  const d = page.getByRole("dialog"); await S(page, "r03-home-review-dialog");
  console.log("DLG:", await d.innerText()); console.log("focus:", await info());
  console.log("controls:", await d.locator("button,input,textarea,a").evaluateAll(es => es.map(e => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || e.tagName).trim().slice(0, 50))));
  const save = d.getByRole("button", { name: /^Save/ }).last();
  await save.click(); await page.waitForTimeout(400); await S(page, "r03-home-saving");
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) { console.log("toast", JSON.stringify(t)); break; } }
  await page.waitForTimeout(800); await S(page, "r03-home-after");
  console.log("NEEDS:", (await page.locator("main").innerText()).slice(0, 400));
  console.log("dialog open?", await d.count(), "focus:", await info());
} else {
  await page.goto(BASE + "/spaces/apex-roofing"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(800);
  const chip = page.getByRole("button", { name: /Sync status/ }).first();
  console.log("chip:", await chip.getAttribute("aria-label"));
  await chip.click(); await page.waitForTimeout(500);
  const pop = page.getByRole("dialog").first(); await S(page, "r03-popover");
  console.log("POPOVER:", await pop.innerText());
  const btn = pop.getByRole("button", { name: /Save|Review/ }).first();
  console.log("button:", await btn.innerText());
  await btn.click(); await page.waitForTimeout(600); await S(page, "r03-popover-click");
  const d2 = page.getByRole("dialog");
  console.log("NOW:", await d2.last().innerText().catch(()=>"(none)"));
  const s2 = d2.last().getByRole("button", { name: /^Save/ }).last();
  if (await s2.count()) { await s2.click(); }
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) { console.log("toast", JSON.stringify(t)); break; } }
  await page.waitForTimeout(800); await S(page, "r03-popover-after");
  console.log("chip after:", await chip.getAttribute("aria-label"), "focus:", await info());
}
} catch (e) { console.log("ERR", e.message); await S(page, "r03-error-" + mode); }
console.log(logs.join("\n"));
await browser.close();
