import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
try {
await page.goto(BASE + "/spaces/apex-roofing/members");
await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
await shot(page, "04d-members");
const input = page.getByLabel(/Invite by GitHub username|GitHub username/).first();
// empty
await page.getByRole("button", { name: "Invite", exact: true }).click();
await page.waitForTimeout(800);
console.log("empty-> btn disabled?", await page.getByRole("button", { name: "Invite", exact: true }).isDisabled()); await T("empty");
await input.fill("not a user!!");
await page.getByRole("button", { name: "Invite", exact: true }).click().catch(e=>console.log("click fail", e.message.slice(0,80)));
await page.waitForTimeout(1500);
await shot(page, "04d-invite-invalid");
console.log("INVALID area:", (await page.locator("main").innerText()).split("Invite by GitHub username")[1]?.slice(0, 300)); await T("toasts");
await input.fill("alex-rivera");
await page.getByRole("combobox", { name: "Role for the new member" }).click();
await page.getByRole("option", { name: /^Can edit/ }).click();
await page.getByRole("button", { name: "Invite", exact: true }).click();
await page.waitForTimeout(2500);
await T("after invite:");
await shot(page, "04d-invited", true);
console.log("AFTER:", (await page.locator("main").innerText()).split("Members")[2]?.slice(0, 700));
} catch (e) { console.log("ERR", e.message); await shot(page, "04d-error"); }
console.log(logs.join("\n"));
await browser.close();
