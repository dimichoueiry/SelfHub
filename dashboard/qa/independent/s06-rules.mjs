import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
try {
await page.goto(BASE + "/rules");
await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
await shot(page, "06-rules-pending", true);
console.log("RULES:", await page.locator("main").innerText());
const cards = page.locator("main article, main li").filter({ has: page.getByRole("button", { name: /^Approve/ }) });
console.log("cards with approve:", await cards.count());
await page.getByRole("button", { name: /^Approve/ }).first().click();
await page.waitForTimeout(500); await shot(page, "06-approve-click");
const dlg = page.getByRole("dialog").or(page.getByRole("alertdialog"));
if (await dlg.count()) { console.log("APPROVE DLG:", await dlg.first().innerText()); }
await page.waitForTimeout(2500); await T("after approve:"); await shot(page, "06-approved");
console.log("AFTER APPROVE:", (await page.locator("main").innerText()).slice(0, 900));
await page.getByRole("button", { name: /^Reject/ }).first().click();
await page.waitForTimeout(500); await shot(page, "06-reject-click");
if (await dlg.count()) { console.log("REJECT DLG:", await dlg.first().innerText()); }
} catch (e) { console.log("ERR", e.message); await shot(page, "06-error"); }
console.log(logs.join("\n"));
await browser.close();
