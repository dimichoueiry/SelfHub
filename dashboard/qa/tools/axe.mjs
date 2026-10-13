// axe-core (WCAG 2.0/2.1 A+AA) at 1024, light and dark. Usage: node qa/tools/axe.mjs [baseUrl] [pagesJson] [demoUser]
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
const dir = readdirSync("node_modules/.pnpm").find((d) => d.startsWith("axe-core@"));
const AXE = readFileSync(`node_modules/.pnpm/${dir}/node_modules/axe-core/axe.min.js`, "utf8");
const base = process.argv[2] ?? "http://localhost:3100";
const pages = process.argv[3] ? JSON.parse(process.argv[3]) : { home: "/", file: "/spaces/apex?path=brief.md" };
const b = await chromium.launch();
const out = {};
for (const theme of ["light", "dark"]) {
  for (const [name, url] of Object.entries(pages)) {
    const p = await b.newPage({ viewport: { width: 1024, height: 900 } });
    await p.addInitScript((t) => { localStorage.setItem("selfhub.demoUser", "sam"); localStorage.setItem("theme", t); }, theme);
    await p.goto(base + url);
    await p.waitForTimeout(2500);
    await p.addScriptTag({ content: AXE });
    out[`${theme}/${name}`] = await p.evaluate(async () => {
      const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map((x) => x.target.join(" ")) }));
    });
    await p.close();
  }
}
console.log(JSON.stringify(out));
await b.close();
