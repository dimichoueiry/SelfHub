import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
try {
await page.goto(BASE + "/rules");
await page.getByRole("button", { name: /^Reject/ }).first().waitFor(); await page.waitForTimeout(500);
await shot(page, "06b-before-reject");
await page.getByRole("button", { name: /^Reject/ }).first().click();
const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
await shot(page, "06b-reject-confirm");
await dlg.getByRole("button", { name: "Reject rule" }).click();
await page.waitForTimeout(300); await T("t300");
await page.waitForTimeout(1500); await T("after reject:");
await shot(page, "06b-rejected");
console.log("PENDING NOW:", (await page.locator("main").innerText()).slice(0, 500));
await page.getByRole("tab", { name: /Rejected/ }).click(); await page.waitForTimeout(1000);
await shot(page, "06b-rejected-tab");
console.log("REJECTED TAB:", (await page.locator("main").innerText()).slice(0, 900));
await page.getByRole("tab", { name: /Active/ }).click(); await page.waitForTimeout(1000);
await shot(page, "06b-active-tab", true);
console.log("ACTIVE:", (await page.locator("main").innerText()).slice(0, 700));
// rejecting as Sam? Sam shouldn't see buttons
} catch (e) { console.log("ERR", e.message); await shot(page, "06b-error"); }
console.log(logs.join("\n"));
await browser.close();
const s = await open({ user: "sam" });
await s.page.goto(BASE + "/rules"); await s.page.waitForLoadState("networkidle"); await s.page.waitForTimeout(800);
await shot(s.page, "06c-rules-sam");
console.log("SAM RULES:", (await s.page.locator("main").innerText()).slice(0, 600));
await s.browser.close();
