// Usage: node f01-p0.mjs <file> <trigger: notice|popover|sidebar> <choice: replace|discard|none> <tag>
import { open, shot, BASE, toasts } from "./lib.mjs";
const [file, trigger, choice, tag] = process.argv.slice(2);
const S = (n) => shot(page, `final/f01-${tag}-${n}`);
const { browser, page, logs } = await open({ reduced: true });
const API = "http://localhost:8788/api";
const fileApi = async () => (await (await fetch(`${API}/spaces/ads-team/file?path=${encodeURIComponent(file)}`, { headers: { "X-SelfHub-User": "sam-okafor" } })).json()).content;
const section = () => page.locator("section[aria-label=File]");
const dirty = async () => (await section().innerText()).includes("Unsaved changes");
try {
  await page.goto(BASE + "/spaces/ads-team?path=" + encodeURIComponent(file));
  await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(500);
  const ed = page.getByLabel(/Content of .*/);
  await ed.evaluate(el => el.setSelectionRange(0, 0));
  await ed.pressSequentially("QA TOP LINE\n\n"); await page.waitForTimeout(300);
  console.log("notice:", (await section().innerText()).split("\n")[0]);
  console.log("before: dirty", await dirty(), "line", (await ed.inputValue()).includes("QA TOP LINE"));
  await S("1-before");
  if (trigger === "notice") await section().getByRole("button", { name: /Sync now|Get latest/ }).first().click();
  else if (trigger === "popover") { await page.getByRole("button", { name: /sync status/i }).first().click(); await page.waitForTimeout(400); await page.getByRole("dialog").getByRole("button", { name: /Sync now/ }).click(); }
  else { const b = page.getByRole("button", { name: /Sync all/ }).first(); console.log("sidebar btn:", await b.getAttribute("aria-label")); await b.click(); }
  let t = [];
  for (let i = 0; i < 15; i++) { await page.waitForTimeout(300); t = await toasts(page); if (t.length) break; }
  await page.waitForTimeout(700);
  if (trigger === "popover") { console.log("POPOVER:", (await page.getByRole("dialog").first().innerText().catch(()=>"(closed)")).replace(/\n+/g, " | ")); await S("2a-popover"); await page.keyboard.press("Escape"); }
  const v = await ed.inputValue();
  console.log("after sync: dirty", await dirty(), "| my line", v.includes("QA TOP LINE"), "| cadence in draft", v.includes("Creative testing cadence"));
  console.log("toasts:", JSON.stringify(t));
  console.log("inline note:", (await section().innerText()).split("\n").filter(l => /changed this file|choose what to keep|didn't touch|latest/i.test(l)));
  console.log("server has cadence:", (await fileApi()).includes("Creative testing cadence"));
  await S("2-after-sync");
  await page.getByLabel("Describe your change").fill("QA final " + tag);
  await page.getByRole("button", { name: /Save & sync/ }).click();
  const dlg = page.getByRole("dialog").or(page.getByRole("alertdialog")).first();
  const got = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  if (got) {
    await page.waitForTimeout(400); await S("3-conflict");
    console.log("CONFLICT:", (await dlg.innerText()).replace(/\n+/g, " | ").slice(0, 500));
    const see = dlg.getByRole("button", { name: /See what/ }); if (await see.count()) { await see.click(); await page.waitForTimeout(500); await S("3b-conflict-diff"); console.log("DIFF:", (await dlg.innerText()).replace(/\n+/g, " | ").slice(0, 900)); }
    if (choice === "replace") await dlg.getByRole("button", { name: /Replace/ }).click();
    if (choice === "discard") await dlg.getByRole("button", { name: /Discard/ }).click();
    if (choice === "close") { await page.keyboard.press("Escape"); await page.waitForTimeout(500); console.log("dialog after Esc:", await page.getByRole("dialog").count()); }
    if (choice === "keepboth") await dlg.getByRole("button", { name: /both|Keep both|Combine/ }).click();
    if (choice === "replace") { const c = page.getByRole("alertdialog"); if (await c.count()) { console.log("REPLACE CONFIRM:", await c.innerText()); await c.getByRole("button").last().click(); } }
    await page.waitForTimeout(2500);
    console.log("after choice toasts:", JSON.stringify(await toasts(page)));
    const ev = await ed.inputValue().catch(() => "(editor closed)");
    console.log("editor after choice: line", ev.includes("QA TOP LINE"), "cadence", ev.includes("Creative testing cadence"), "| dirty", await dirty().catch(()=>"?"));
    await S("4-after-choice");
  } else {
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(300); if ((await toasts(page)).length) break; }
    console.log("no conflict; toasts:", JSON.stringify(await toasts(page))); await S("3-saved");
  }
  await page.waitForTimeout(800);
  const c = await fileApi();
  console.log("SERVER FINAL: my line", c.includes("QA TOP LINE"), "| cadence", c.includes("Creative testing cadence"), "| google-ads/negative (other file)", "-");
} catch (e) { console.log("ERR", e.message); await S("error"); }
console.log(logs.filter(l => !/409/.test(l)).join("\n"));
await browser.close();
