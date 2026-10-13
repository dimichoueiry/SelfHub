import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const { browser, page, logs } = await open({ user: "maya", reduced: true });
const f = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.innerText || "").trim().replace(/\s+/g," ").slice(0,50)}`; });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
try {
await page.goto(BASE + "/people"); await page.getByText("Leo Park").first().waitFor(); await page.waitForTimeout(600);
await S(page, "r05-people-1440");
const leo = page.getByRole("button", { name: /^Leo Park/ });
console.log("leo button name:", await leo.getAttribute("aria-label"), "| text:", (await leo.innerText()).replace(/\n/g, " / "));
await leo.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
console.log("drawer focus:", await f());
const cb = page.getByRole("combobox", { name: /access to Northline/ });
await cb.focus(); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
console.log("options:", (await page.getByRole("option").allInnerTexts()).map(s => s.replace(/\n/g, " — ")));
await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
const ad = page.getByRole("alertdialog");
console.log("F-19 Enter on No access -> alertdialog:", await ad.count(), "focus:", await f());
await S(page, "r05-enter-no-access-confirm");
if (await ad.count()) { console.log("CONFIRM:", await ad.innerText()); await page.keyboard.press("Escape"); await page.waitForTimeout(400); console.log("Esc confirm ->", await f(), "| value:", await cb.innerText()); }
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
console.log("Esc drawer ->", await f());
// role change + undo (mouse)
await leo.click(); await page.waitForTimeout(400);
await page.getByRole("combobox", { name: /access to Ads Team/ }).click(); await page.getByRole("option", { name: /^Can edit/ }).click(); await page.waitForTimeout(1500);
await T("role change:"); 
await page.locator("[data-sonner-toast]").getByRole("button", { name: /Undo/ }).first().click(); await page.waitForTimeout(2000);
await T("after undo:"); console.log("ads value:", await page.getByRole("combobox", { name: /access to Ads Team/ }).innerText());
// remove + undo
await page.getByRole("combobox", { name: /access to Northline/ }).click(); await page.getByRole("option", { name: /^No access/ }).click(); await page.waitForTimeout(500);
await page.getByRole("alertdialog").getByRole("button", { name: /Remove/ }).click(); await page.waitForTimeout(1500); await T("remove:");
await page.locator("[data-sonner-toast]").getByRole("button", { name: /Undo/ }).first().click(); await page.waitForTimeout(2000); await T("undo:");
console.log("northline value:", await page.getByRole("combobox", { name: /access to Northline/ }).innerText());
await page.keyboard.press("Escape");
// Members: invite + pending + remove Esc focus
await page.goto(BASE + "/spaces/apex-roofing/members"); await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(500);
await S(page, "r05-members-1440");
console.log("invite disabled when empty:", await page.getByRole("button", { name: "Invite", exact: true }).isDisabled());
await page.getByLabel(/GitHub username/).fill("casey-lee"); await page.keyboard.press("Enter");
for (let i = 0; i < 10; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) { console.log("invite toast", JSON.stringify(t)); break; } }
await page.waitForTimeout(500); await S(page, "r05-invited");
console.log("casey row:", (await page.locator("main").innerText()).match(/casey-lee[\s\S]{0,120}/)?.[0].replace(/\n/g, " / "));
await page.getByLabel(/GitHub username/).fill("sam-okafor"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
console.log("dup msg:", (await page.locator("main").innerText()).match(/@sam-okafor already[^\n]*/)?.[0]);
const rm = page.getByRole("button", { name: "Remove Tess Alvarez" });
await rm.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
console.log("members confirm:", await page.getByRole("alertdialog").count(), "focus:", await f());
await page.keyboard.press("Escape"); await page.waitForTimeout(400); console.log("Esc ->", await f());
} catch (e) { console.log("ERR", e.message); await S(page, "r05-error"); }
console.log(logs.join("\n"));
await browser.close();
