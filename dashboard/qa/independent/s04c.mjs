import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
const T = async (l) => { const t = await toasts(page); console.log(l, JSON.stringify(t)); return t; };
try {
await page.goto(BASE + "/people");
await page.getByText("Leo Park").first().waitFor();
await page.getByRole("row", { name: /Leo Park/ }).first().click();
const dlg = page.getByRole("dialog");
// change role: Ads Team Can view -> Can edit
await dlg.getByRole("combobox", { name: "Leo Park's access to Ads Team" }).click();
await page.waitForTimeout(300);
await shot(page, "04c-role-menu");
console.log("OPTIONS:", await page.getByRole("option").allInnerTexts());
await page.getByRole("option", { name: /^Can edit/ }).click();
await page.waitForTimeout(2500);
await T("after role change:");
await shot(page, "04c-role-changed");
// remove: Northline -> No access
await dlg.getByRole("combobox", { name: "Leo Park's access to Northline" }).click();
await page.getByRole("option", { name: /^No access/ }).click();
await page.waitForTimeout(500);
const confirm = page.getByRole("alertdialog");
console.log("CONFIRM:", await confirm.innerText().catch(()=>"(no alertdialog)"));
await shot(page, "04c-remove-confirm");
await confirm.getByRole("button", { name: /Remove/ }).click();
await page.waitForTimeout(2500);
await T("after remove:");
await shot(page, "04c-removed-toast");
const undo = page.locator("[data-sonner-toast]").getByRole("button", { name: /Undo/ }).last();
await undo.click();
await page.waitForTimeout(3000);
await T("after undo:");
await shot(page, "04c-after-undo");
console.log("DRAWER:", await dlg.innerText().catch(()=>"(closed)"));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await shot(page, "04c-matrix-after");
console.log("LEO ROW:", await page.getByRole("row", { name: /Leo Park/ }).innerText());
} catch (e) { console.log("ERR", e.message); await shot(page, "04c-error"); }
console.log(logs.join("\n"));
await browser.close();
