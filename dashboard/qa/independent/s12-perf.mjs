import { open, shot, BASE } from "./lib.mjs";
const routes = [["home","/","sam"],["file","/spaces/ads-team?path=sops%2Ffacebook-ads.md","sam"],["people","/people","maya"],["rules","/rules","maya"],["members","/spaces/apex-roofing/members","maya"],["history","/spaces/ads-team/history","sam"]];
for (const [n, p, u] of routes) {
  const { browser, ctx, page } = await open({ user: u });
  await ctx.addInitScript(() => { window.__cls = 0; window.__shifts = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push([Math.round(performance.now()), +e.value.toFixed(3), e.sources?.map(s => s.node?.nodeName + "." + (s.node?.className?.toString?.() || "").slice(0, 30)).slice(0,2)]); } }).observe({ type: "layout-shift", buffered: true }); });
  const t0 = Date.now();
  await page.goto(BASE + p);
  const texts = [];
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(100); const t = await page.locator("main").innerText().catch(() => ""); texts.push(t); if (i === 2) await shot(page, `12-${n}-t300`); }
  await page.waitForLoadState("networkidle");
  const ready = Date.now() - t0;
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ cls: +window.__cls.toFixed(3), shifts: window.__shifts.slice(0, 4), lcp: 0 }));
  const leaks = texts.flatMap(t => (t.match(/\b[a-z]+-[a-z]+(?:-[a-z]+)?\b|R-\d{8}-[0-9a-f]{4}|\bundefined\b|\bnull\b|NaN|Invalid Date/g) || [])).filter(x => /okafor|chen|reyes|nair|park|ito|whitfield|bell|alvarez|R-\d|undefined|null|NaN|Invalid/.test(x));
  console.log(n, "networkidle", ready, "ms; CLS", r.cls, JSON.stringify(r.shifts), "early-leaks:", [...new Set(leaks)].slice(0, 6).join(","));
  await browser.close();
}
