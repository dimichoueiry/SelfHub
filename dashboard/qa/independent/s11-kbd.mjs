import { open, shot, BASE } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "sam", reduced: true });
const info = () => page.evaluate(() => {
  const e = document.activeElement; if (!e || e === document.body) return { name: "(body)", ring: false };
  const s = getComputedStyle(e);
  const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  return { name: (e.getAttribute("aria-label") || e.labels?.[0]?.innerText || e.getAttribute("placeholder") || e.innerText || e.tagName).trim().replace(/\s+/g, " ").slice(0, 45), role: e.getAttribute("role") || e.tagName.toLowerCase(), ring };
});
const seq = [];
async function tabTo(re, max = 60, key = "Tab") {
  for (let i = 0; i < max; i++) { await page.keyboard.press(key); const f = await info(); seq.push(f); if (re.test(f.name)) return f; }
  throw new Error("never reached " + re);
}
try {
await page.goto(BASE + "/"); await page.getByText("Needs you").waitFor(); await page.waitForTimeout(500);
await tabTo(/^Ads Team/);
console.log("J2 tab order to Ads Team:", seq.map(f => `${f.name}${f.ring ? "" : " [NO RING]"}`).join(" → "));
await page.keyboard.press("Enter"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(600);
seq.length = 0;
const tr = await tabTo(/README|\.github|CODEOWNERS|rules|sops|templates/, 30);
console.log("into tree after", seq.length, "tabs:", seq.map(f => f.name + (f.ring ? "" : "[NO RING]")).join(" → "));
// arrow to sops/facebook-ads
for (let i = 0; i < 25; i++) { const f = await info(); if (/^facebook-ads/.test(f.name)) break; await page.keyboard.press("ArrowUp"); }
const atFile = await info(); console.log("tree arrow reached:", atFile);
await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
console.log("URL:", decodeURIComponent(page.url()), "focus:", await info());
seq.length = 0;
await tabTo(/^Edit$/, 30); console.log("tabs to Edit:", seq.length);
await page.keyboard.press("Enter"); await page.waitForTimeout(600);
console.log("focus after Edit:", await info());
await shot(page, "11-kbd-edit-focus");
await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type("\n- keyboard QA line\n");
seq.length = 0;
await tabTo(/Describe your change/i, 15);
console.log("tab from editor to message:", seq.map(f => f.name).join(" → "));
await page.keyboard.type("Keyboard QA");
await page.keyboard.press("Meta+s"); await page.waitForTimeout(2500);
console.log("after Cmd+S toasts:", await page.locator("[data-sonner-toast]").allInnerTexts(), "focus:", await info());
await shot(page, "11-kbd-saved");
// ••• menu: open with keyboard, Escape, focus return
const more = page.getByRole("button", { name: /More|actions/i }).last();
await more.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
console.log("menu open focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("after Esc focus:", await info());
// sync popover
const sync = page.getByRole("button", { name: /Sync status/ }).first();
await sync.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
console.log("popover focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("after Esc (popover):", await info());
// cmd k via search button
const sb = page.getByRole("button", { name: /Search files/ }).first();
await sb.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
console.log("palette focus:", await info());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
console.log("after Esc (palette):", await info());
// user menu switch to Maya via keyboard
const um = page.getByRole("button", { name: /Sam Okafor|account|user/i }).last();
await um.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
console.log("user menu:", await page.getByRole("menu").innerText().catch(()=>"(none)"));
await page.keyboard.press("Escape"); await page.waitForTimeout(200);
console.log("after Esc user menu:", await info());
} catch (e) { console.log("ERR", e.message); console.log(seq.slice(-10)); await shot(page, "11-kbd-error"); }
console.log(logs.join("\n"));
await browser.close();
