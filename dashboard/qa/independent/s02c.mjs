import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open();
try {
await page.goto(BASE + "/spaces/ads-team?path=sops%2Ffacebook-ads.md");
await page.getByText("Last edited by").waitFor();
await page.getByRole("button", { name: "Edit", exact: true }).click();
const ed = page.getByLabel(/Content of .* \(markdown\)/);
await ed.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
await ed.pressSequentially("\n- QA independent check line\n");
// unsaved guard: click another tree item
await page.getByRole("treeitem", { name: /google-ads/ }).click();
await page.waitForTimeout(500);
await shot(page, "02c-unsaved-guard");
console.log("GUARD:", await page.getByRole("alertdialog").or(page.getByRole("dialog")).first().innerText().catch(()=>"none"));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
console.log("still editing:", await ed.isVisible());
// save without message
await page.getByRole("button", { name: /Save & sync/ }).click();
await page.waitForTimeout(2500);
console.log("toasts:", await toasts(page));
await shot(page, "02c-saved-toast");
console.log("reader top:", (await page.locator("main").innerText()).match(/Last edited by[^\n]*/)?.[0]);
await page.reload();
await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(800);
console.log("persisted:", (await page.locator("main").innerText()).includes("QA independent check line"));
await page.locator("text=QA independent check line").scrollIntoViewIfNeeded();
await shot(page, "02c-after-reload");
// locked northline file
await page.goto(BASE + "/spaces/northline?path=locked%2Fcompliance.md");
await page.getByRole("note").first().waitFor(); await page.waitForTimeout(800);
await shot(page, "02d-northline-locked");
console.log("LOCKED:", (await page.locator("main").innerText()).slice(0, 1200));
// non-locked northline file (view only)
await page.goto(BASE + "/spaces/northline?path=sops%2Freporting.md");
await page.waitForTimeout(2000);
await shot(page, "02d-northline-viewonly");
// Bolt by direct link
await page.goto(BASE + "/spaces/bolt-hvac?path=brief.md");
await page.waitForTimeout(2500);
await shot(page, "02e-bolt-noaccess");
console.log("BOLT:", await page.locator("main").innerText());
} catch (e) { console.log("ERR", e.message); await shot(page, "02c-error"); }
console.log(logs.join("\n"));
await browser.close();
