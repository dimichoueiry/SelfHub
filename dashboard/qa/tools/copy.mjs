// Crawl rendered UI copy (not file content) and grep for glossary violations.
// Usage: node qa/tools/copy.mjs [baseUrl] [spaceId] [behindSpaceId]
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://localhost:3100";
const space = process.argv[3] ?? "apex";
const behind = process.argv[4] ?? "ads-team";
const b = await chromium.launch();
const seen = new Map();
async function collect(p, where) {
  const strings = await p.evaluate(() => {
    const out = [];
    const skip = (el) => el.closest(".md, textarea, pre");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || skip(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const t = walker.currentNode.textContent.trim();
      if (t) out.push(t);
    }
    for (const el of document.querySelectorAll("[aria-label],[title],[placeholder]")) {
      if (skip(el)) continue;
      for (const a of ["aria-label", "title", "placeholder"]) { const v = el.getAttribute(a); if (v) out.push(v); }
    }
    return out;
  });
  for (const s of strings) if (!seen.has(s)) seen.set(s, where);
}
for (const user of ["sam", "maya"]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript((u) => localStorage.setItem("selfhub.demoUser", u), user);
  for (const r of ["/", `/spaces/${space}?path=brief.md`, `/spaces/${space}/history`, `/spaces/${space}/members`, `/spaces/${space}/settings`, "/people", "/rules", "/settings", `/spaces/${behind}`]) {
    await p.goto(base + r); await p.waitForTimeout(1800); await collect(p, `${user} ${r}`);
  }
  await p.goto(base + `/spaces/${behind}`); await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /sync status$/ }).click(); await p.waitForTimeout(400); await collect(p, `${user} popover`); await p.keyboard.press("Escape");
  await p.keyboard.press("ControlOrMeta+k"); await p.waitForTimeout(400); await collect(p, `${user} cmdk`); await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "Add space" }).first().click(); await p.waitForTimeout(300); await collect(p, `${user} add-space`);
  await p.getByRole("button", { name: /Connect an existing GitHub repository/ }).click(); await p.waitForTimeout(400); await collect(p, `${user} connect`);
  await p.keyboard.press("Escape");
  if (user === "maya") {
    await p.goto(base + `/spaces/${space}/members`); await p.waitForTimeout(1500);
    await p.getByRole("combobox").nth(1).click(); await p.waitForTimeout(300); await collect(p, "maya role options"); await p.keyboard.press("Escape");
    await p.goto(base + "/people"); await p.waitForTimeout(1500);
    await p.getByRole("button").filter({ hasText: /Leo/ }).first().click(); await p.waitForTimeout(500); await collect(p, "maya drawer");
  }
  await p.goto(base + `/spaces/${behind}?path=README.md`); await p.waitForTimeout(1500);
  const edit = p.getByRole("button", { name: "Edit", exact: true }); if (await edit.count()) { await edit.click(); await p.waitForTimeout(500); await collect(p, `${user} editor`); }
  await p.close();
}
const re = /\bupdates?\b|\brepo\b|GitHub (write|read)|@|Get latest/i;
const hits = [...seen.entries()].filter(([s]) => re.test(s));
console.log(`${seen.size} strings; ${hits.length} hits`);
for (const [s, w] of hits) console.log(`- [${w}] ${s.slice(0, 140)}`);
await b.close();
