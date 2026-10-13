import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open();
try {
await page.goto(BASE + "/spaces/ads-team?path=sops%2Ffacebook-ads.md");
await page.getByRole("button", { name: "Edit", exact: true }).click();
const ed = page.getByLabel(/Content of .* \(markdown\)/);
await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
await ed.pressSequentially("\n- QA independent check line\n");
await page.getByLabel("Describe your change").fill("QA: add check line");
await page.keyboard.press("Meta+s");
await page.getByRole("dialog").waitFor();
await page.getByRole("button", { name: "Start from theirs" }).click();
await page.waitForTimeout(1500);
await shot(page, "02b-start-from-theirs");
const v = await ed.inputValue();
console.log("has cadence:", v.includes("Creative testing cadence"), "has my line:", v.includes("QA independent"));
console.log("toasts:", await toasts(page));
console.log("bar:", await page.locator("main").innerText().then(t => t.slice(t.indexOf("Editing"), t.indexOf("Editing")+120)));
if (!v.includes("QA independent")) { await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); await ed.pressSequentially("\n- QA independent check line\n"); }
const msg = page.getByLabel("Describe your change"); if (!(await msg.inputValue())) await msg.fill("QA: add check line");
await page.getByRole("button", { name: /Save & sync/ }).click();
await page.waitForTimeout(400);
await shot(page, "02b-saving");
await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 15000 });
console.log("toasts:", await toasts(page));
await shot(page, "02b-saved-toast");
await page.reload();
await page.getByText("Last edited by").waitFor();
await page.waitForTimeout(1000);
const main = await page.locator("main").innerText();
console.log("persisted:", main.includes("QA independent check line"), "header:", main.match(/Last edited by[^\n]*/)?.[0]);
console.log("sync chip:", await page.locator("header, main").first().innerText().then(t=>t.slice(0,200)));
await shot(page, "02b-after-reload");
} catch (e) { console.log("ERR", e.message); await shot(page, "02b-error"); }
console.log(logs.join("\n"));
await browser.close();
