import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
try {
await page.goto(BASE + "/people");
await page.getByText("Leo Park").first().waitFor();
await page.getByRole("button", { name: /Leo Park/ }).or(page.getByRole("row", { name: /Leo Park/ })).first().click();
await page.waitForTimeout(600);
await shot(page, "04b-drawer-leo");
const dlg = page.getByRole("dialog");
console.log("DRAWER:", await dlg.innerText());
console.log("controls:", await dlg.locator("button, [role=combobox], select").evaluateAll(els => els.map(e => `${e.tagName}|${e.getAttribute("role")}|${e.getAttribute("aria-label")}|${e.innerText.trim()}`)));
} catch (e) { console.log("ERR", e.message); await shot(page, "04b-error"); }
console.log(logs.join("\n"));
await browser.close();
