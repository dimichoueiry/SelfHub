import { open, shot, BASE, AXE } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const routes = [
  ["home", "/", "sam"], ["file", "/spaces/ads-team?path=sops%2Ffacebook-ads.md", "sam"],
  ["locked", "/spaces/northline?path=locked%2Fcompliance.md", "sam"], ["history", "/spaces/ads-team/history", "sam"],
  ["noaccess", "/spaces/bolt-hvac", "sam"], ["people", "/people", "maya"], ["members", "/spaces/apex-roofing/members", "maya"],
  ["rules", "/rules", "maya"], ["settings", "/settings", "maya"], ["space-settings", "/spaces/ads-team/settings", "maya"], ["csv", "/spaces/ads-team?path=templates%2Fcampaign-naming.csv", "sam"],
];
const out = {};
for (const theme of ["light", "dark"]) for (const width of JSON.parse(process.env.WIDTHS)) {
  for (const user of ["sam", "maya"]) {
    const { browser, page, logs } = await open({ user, theme, width, height: width === 390 ? 844 : 900, reduced: true });
    for (const [name, path, u] of routes.filter(r => r[2] === user && (!process.env.ROUTES || process.env.ROUTES.split(",").includes(r[0])))) {
      const key = `${name}-${width}-${theme}`;
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(900);
      await shot(page, `final/f03-${key}`);
      const m = await page.evaluate((w) => {
        const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
        const label = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || e.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
        const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const offRight = [...document.querySelectorAll("body *")].filter(e => vis(e) && e.children.length === 0 && e.getBoundingClientRect().right > w + 1 && !e.closest("[data-radix-scroll-area-viewport], .overflow-x-auto, [style*='overflow']")).map(e => label(e)).slice(0, 8);
        const truncated = [...document.querySelectorAll("body *")].filter(e => vis(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis").map(e => label(e)).slice(0, 15);
        const small = w <= 500 ? [...document.querySelectorAll("a[href], button, [role=button], [role=tab], [role=treeitem], [role=combobox], input, select, textarea, [role=menuitem], [role=checkbox], [role=switch]")].filter(vis).map(e => ({ l: label(e), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })).filter(x => x.h < 40 || x.w < 40).slice(0, 25) : [];
        return { docOverflow, offRight, truncated, small };
      }, width);
      let axe = null;
      if (true) {
        await page.addScriptTag({ path: AXE });
        axe = await page.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }); return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, nodes: v.nodes.slice(0, 6).map(n => ({ t: n.target.join(" "), s: (n.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 160), html: n.html.slice(0, 120) })) })); });
      }
      out[key] = { ...m, axe };
      console.log(key, "overflow", m.docOverflow, "offRight", m.offRight.length, "trunc", m.truncated.length, "small", m.small.length, "axe", axe ? axe.map(a => `${a.id}:${a.n}`).join(",") : "-");
    }
    await browser.close();
  }
}
writeFileSync(new URL(process.env.OUT, import.meta.url), JSON.stringify(out, null, 1));
