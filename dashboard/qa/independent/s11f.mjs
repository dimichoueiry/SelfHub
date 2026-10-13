import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ user: "maya", reduced: true });
const info = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,40)}`; });
await page.goto(BASE + "/spaces/apex-roofing/members"); await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(400);
await page.getByLabel(/GitHub username/).focus(); await page.keyboard.type("kbd-tester"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("Enter-to-invite toasts:", await page.locator("[data-sonner-toast]").allInnerTexts());
const rm = page.getByRole("button", { name: "Remove Tess Alvarez" });
await rm.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
console.log("Members remove via Enter: alertdialog", await page.getByRole("alertdialog").count(), "focus:", await info());
await shot(page, "11f-members-remove-enter");
if (await page.getByRole("alertdialog").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); console.log("Esc ->", await info()); }
const role = page.getByRole("combobox", { name: "Role for Tess Alvarez" });
await role.focus(); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300); await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
console.log("Members role->No access via Enter: alertdialog", await page.getByRole("alertdialog").count(), "value:", await role.innerText().catch(()=>"?"));
await browser.close();
