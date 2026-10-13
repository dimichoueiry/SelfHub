import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const { browser, page, logs } = await open({ reduced: true });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
const more = () => page.getByRole("button", { name: /More file actions/ }).first();
try {
// rename
await page.goto(BASE + "/spaces/ads-team?path=templates%2Ffacebook-variants.md"); await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(500);
await more().click(); await page.getByRole("menuitem", { name: /Rename/ }).click(); await page.waitForTimeout(300);
const d = page.getByRole("dialog");
console.log("RENAME DLG:", await d.innerText());
const inp = d.getByRole("textbox").first();
await inp.fill("templates/facebook variants?.md"); await page.waitForTimeout(300);
console.log("invalid name state:", (await d.innerText()).split("\n").filter(l => /letter|character|use|can't|cannot/i.test(l)), "rename disabled:", await d.getByRole("button", { name: /^Rename/ }).isDisabled().catch(()=>"?"));
await S(page, "r06-rename-invalid");
await inp.fill("templates/fb-variants.md");
await d.getByRole("button", { name: /^Rename/ }).click();
for (let i = 0; i < 10; i++) { await page.waitForTimeout(300); if ((await toasts(page)).length) break; }
await page.waitForTimeout(800); await T("rename toasts:"); console.log("url:", decodeURIComponent(page.url()).split("path=")[1]);
await S(page, "r06-renamed");
// delete
await more().click(); await page.getByRole("menuitem", { name: /Delete/ }).click(); await page.waitForTimeout(300);
console.log("DELETE DLG:", await page.getByRole("alertdialog").or(d).first().innerText());
await page.getByRole("button", { name: "Delete file" }).click(); await page.waitForTimeout(2000); await T("delete:");
// history diff
await page.goto(BASE + "/spaces/ads-team/history"); await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
await S(page, "r06-history");
console.log("HISTORY:", (await page.locator("main").innerText()).slice(0, 1400));
// unsaved guard
await page.goto(BASE + "/spaces/ads-team?path=sops%2Fgoogle-ads.md"); await page.getByText("Last edited by").waitFor();
await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.waitForTimeout(300);
await page.getByLabel(/Content of .*/).pressSequentially("x");
await page.getByRole("treeitem", { name: /README/ }).click(); await page.waitForTimeout(400);
console.log("guard:", await page.getByRole("alertdialog").or(page.getByRole("dialog")).first().innerText().catch(()=>"NONE"));
await page.getByRole("button", { name: /Discard/ }).click(); await page.waitForTimeout(500);
// locked + view-only + no access
await page.goto(BASE + "/spaces/northline?path=locked%2Fcompliance.md"); await page.getByRole("note").first().waitFor(); await page.waitForTimeout(500);
await S(page, "r06-locked"); console.log("LOCKED note:", await page.getByRole("note").first().innerText());
await page.goto(BASE + "/spaces/northline?path=sops%2Freporting.md"); await page.waitForTimeout(2000);
await S(page, "r06-viewonly"); console.log("VIEWONLY note:", await page.getByRole("note").first().innerText().catch(()=>"(none)"));
await page.goto(BASE + "/spaces/bolt-hvac?path=brief.md"); await page.waitForTimeout(2000);
await S(page, "r06-noaccess"); console.log("NOACCESS:", (await page.locator("main").innerText()).slice(0, 500));
// cmd k snippets
await page.keyboard.press("Meta+k"); await page.keyboard.type("CPL"); await page.waitForTimeout(1500);
await S(page, "r06-cmdk"); console.log("CMDK:", (await page.getByRole("dialog").innerText()).slice(0, 900));
await page.keyboard.press("Meta+a"); await page.keyboard.type("urgency"); await page.waitForTimeout(1500);
console.log("CMDK2:", (await page.getByRole("dialog").innerText()).slice(0, 900));
} catch (e) { console.log("ERR", e.message); await S(page, "r06-error"); }
console.log(logs.join("\n"));
await browser.close();
