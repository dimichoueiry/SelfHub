import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const mode = process.argv[2];
const { browser, page, logs } = await open();
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
try {
if (mode === "getlatest") {
  await page.goto(BASE + "/spaces/ads-team?path=sops%2Ffacebook-ads.md");
  await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(500);
  const ed = page.getByLabel(/Content of .*/);
  await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await ed.pressSequentially("\n- QA getlatest line\n");
  await page.getByRole("button", { name: "Get latest" }).click();
  await page.waitForTimeout(400); await S(page, "r02-getlatest-click");
  const dlg = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  if (await dlg.count()) console.log("DLG:", await dlg.first().innerText());
  await page.waitForTimeout(2500); await T("toasts:");
  await S(page, "r02-getlatest-after");
  const v = await ed.inputValue().catch(() => "(editor gone)");
  console.log("editor has cadence:", v.includes("Creative testing cadence"), "has my line:", v.includes("QA getlatest"));
  console.log("bar:", (await page.locator("section[aria-label=File]").innerText()).slice(0, 250));
  console.log("header chip:", await page.getByRole("button", { name: /Sync status/ }).first().getAttribute("aria-label"));
} else {
  await page.goto(BASE + "/spaces/ads-team?path=README.md");
  await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(500);
  const ed = page.getByLabel(/Content of .*/);
  await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await ed.pressSequentially("\n- QA readme line\n");
  await page.getByLabel("Describe your change").fill("QA readme");
  await page.keyboard.press("Meta+s");
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) { console.log("toast", JSON.stringify(t)); break; } }
  await S(page, "r02-save-with-pull-toast");
  console.log("header chip:", await page.getByRole("button", { name: /Sync status/ }).first().getAttribute("aria-label"));
}
} catch (e) { console.log("ERR", e.message); await S(page, "r02-error-" + mode); }
console.log(logs.join("\n"));
await browser.close();
