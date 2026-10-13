import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n) => shot(p, "re/" + n);
{ const { browser, page } = await open({ user: "maya", theme: "dark" });
  await page.goto(BASE + "/spaces/apex-roofing/members"); await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Remove Tess Alvarez" }).click(); await page.waitForTimeout(500);
  const b = page.getByRole("alertdialog").getByRole("button", { name: /^Remove/ });
  await b.screenshot({ path: new URL("./shots/re/r11-dark-danger-zoom.png", import.meta.url).pathname }); await S(page, "r11-dark-danger");
  console.log("dark danger:", await b.evaluate(e => { const s = getComputedStyle(e); return s.color + " on " + s.backgroundColor; }));
  await page.keyboard.press("Escape");
  // sync popover button style when synced
  await page.goto(BASE + "/spaces/ads-team"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Sync status/ }).first().click(); await page.waitForTimeout(400);
  const sb = page.getByRole("dialog").getByRole("button", { name: /Sync now/ });
  console.log("synced popover Sync now variant:", await sb.getAttribute("data-variant")); await S(page, "r11-popover-synced-dark");
  await page.keyboard.press("Escape");
  // Bolt ahead sync
  await page.goto(BASE + "/"); await page.getByText("Needs you").waitFor(); await page.waitForTimeout(800);
  const row = page.getByRole("button", { name: /Sync now/ });
  console.log("needs rows:", (await page.locator("main").innerText()).match(/Bolt HVAC: [^\n]*\n[^\n]*/)?.[0]);
  await row.last().click();
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) { console.log("bolt sync toast", JSON.stringify(t)); break; } }
  await page.waitForTimeout(800); await S(page, "r11-bolt-synced");
  console.log("bolt card:", (await page.locator("main").innerText()).match(/Bolt HVAC\n[\s\S]{0,160}/)?.[0].replace(/\n/g, " / "));
  await browser.close(); }
{ const { browser, ctx, page } = await open();
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  const t0 = Date.now(); await page.goto(BASE + "/"); await page.waitForTimeout(250); await S(page, "r11-home-t250"); await page.waitForLoadState("networkidle"); const ms = Date.now() - t0; await page.waitForTimeout(800);
  console.log("home networkidle", ms, "CLS", await page.evaluate(() => window.__cls.toFixed(3)));
  await browser.close(); }
