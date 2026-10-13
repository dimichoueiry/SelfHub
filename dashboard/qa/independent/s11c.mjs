import { open, shot, BASE } from "./lib.mjs";
const { browser, page } = await open({ user: "maya", reduced: true });
const info = () => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "(body)"; return `${e.getAttribute("role")||e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || e.labels?.[0]?.innerText || e.innerText || "").trim().replace(/\s+/g," ").slice(0,50)}`; });
const seq = [];
async function tabTo(re, max = 60, key = "Tab") { for (let i = 0; i < max; i++) { await page.keyboard.press(key); const f = await info(); seq.push(f); if (re.test(f)) return f; } throw new Error("never reached " + re + " last: " + seq.slice(-5).join(" | ")); }
try {
await page.goto(BASE + "/people"); await page.getByText("Leo Park").first().waitFor(); await page.waitForTimeout(500);
await page.locator("body").click({ position: { x: 700, y: 20 } });
await tabTo(/Leo Park, open/);
console.log("tabs to Leo:", seq.length, "| after sidebar:", seq.slice(14).join(" → "));
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
console.log("drawer opened, focus:", await info());
seq.length = 0; await tabTo(/access to Ads Team/, 10); console.log("drawer tabs:", seq.join(" → "));
await page.keyboard.press("Enter"); await page.waitForTimeout(300); console.log("select open focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(300); console.log("Esc select -> ", await info(), "| drawer still open:", await page.getByRole("dialog").count());
await page.keyboard.press("Space"); await page.waitForTimeout(300);
for (let i = 0; i < 4; i++) { const f = await info(); if (/No access/.test(f)) break; await page.keyboard.press("ArrowDown"); }
console.log("on option:", await info());
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
console.log("confirm focus:", await info()); await shot(page, "11c-kbd-confirm");
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
console.log("Esc confirm -> focus:", await info(), "| value:", await page.getByRole("combobox", { name: /access to Ads Team/ }).innerText());
// trap check inside drawer
seq.length = 0; for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); seq.push(await info()); }
console.log("drawer cycle:", seq.join(" → "));
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
console.log("Esc drawer -> focus:", await info());
await shot(page, "11c-kbd-drawer-closed");
// members tab invite via keyboard
await page.goto(BASE + "/spaces/apex-roofing/members"); await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(400);
await page.getByLabel(/GitHub username/).focus(); await page.keyboard.type("kbd-tester");
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("Enter in invite field toasts:", await page.locator("[data-sonner-toast]").allInnerTexts(), "focus:", await info());
// remove via keyboard: Remove Tess
await page.getByRole("button", { name: "Remove kbd-tester" }).focus().catch(()=>{});
await page.keyboard.press("Enter"); await page.waitForTimeout(400);
console.log("remove confirm focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("after Esc focus:", await info());
} catch (e) { console.log("ERR", e.message); await shot(page, "11c-error"); }
await browser.close();
