import { open, BASE } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const out = [];
const grab = async (page, where) => {
  const t = await page.evaluate(() => {
    const txt = document.body.innerText;
    const attrs = [...document.querySelectorAll("[title],[aria-label],[placeholder]")].filter(e => e.getBoundingClientRect().width > 0).flatMap(e => [e.getAttribute("title"), e.getAttribute("placeholder")]).filter(Boolean);
    return txt + "\n" + attrs.join("\n");
  });
  for (const line of t.split("\n").map(s => s.trim()).filter(Boolean)) out.push([where, line]);
};
const click = async (page, loc) => { try { await loc.first().click({ timeout: 4000 }); await page.waitForTimeout(500); return true; } catch { return false; } };
for (const user of ["sam", "maya"]) {
  const { browser, page } = await open({ user, reduced: true });
  const routes = ["/", "/people", "/rules", "/settings", "/spaces/northline?path=locked%2Fcompliance.md", "/spaces/northline?path=sops%2Freporting.md", "/spaces/ads-team", "/spaces/ads-team/history", "/spaces/ads-team/members", "/spaces/ads-team/settings", "/spaces/apex-roofing/members", "/spaces/bolt-hvac", "/spaces/me", "/spaces/me/members", "/spaces/me/settings"];
  for (const r of routes) {
    await page.goto(BASE + r); await page.waitForLoadState("networkidle"); await page.waitForTimeout(700);
    await grab(page, `${user} ${r}`);
    if (r === "/rules") for (const tab of ["Active", "Rejected"]) { if (await click(page, page.getByRole("tab", { name: new RegExp(tab) }))) await grab(page, `${user} ${r} [${tab}]`); }
    if (r.startsWith("/spaces/ads-team") && !r.includes("/")) {}
    if (r === "/spaces/ads-team") {
      if (await click(page, page.getByRole("button", { name: /sync status/i }))) { await grab(page, `${user} sync popover`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /More file actions/ }))) { await grab(page, `${user} file menu`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /New file/ }))) { await grab(page, `${user} new file dlg`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: "Edit", exact: true }))) { await grab(page, `${user} editor`); await click(page, page.getByRole("button", { name: "Cancel" })); }
    }
    if (r.endsWith("/members") && user === "maya") {
      if (await click(page, page.getByRole("combobox", { name: /Role for the new member/ }))) { await grab(page, `${user} role options`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /^Remove / }))) { await grab(page, `${user} remove confirm`); await page.keyboard.press("Escape"); }
      for (const b of await page.getByRole("button", { name: /managed|team|info/i }).all().catch(() => [])) { await b.hover().catch(()=>{}); await page.waitForTimeout(300); }
      await grab(page, `${user} members hover`);
    }
    if (r === "/people" && user === "maya") {
      if (await click(page, page.getByRole("button", { name: /^Sam Okafor/ }))) { await grab(page, `${user} sam drawer`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /^Leo Park/ }))) { if (await click(page, page.getByRole("combobox", { name: /access to Ads Team/ }))) await grab(page, `${user} leo drawer options`); await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); }
    }
    if (r === "/") {
      if (await click(page, page.getByRole("button", { name: /Add space/ }))) { await grab(page, `${user} add space`);
        if (await click(page, page.getByRole("dialog").getByRole("button", { name: /Connect/ }))) await grab(page, `${user} connect`);
        await page.keyboard.press("Escape"); }
      await page.keyboard.press("Meta+k"); await page.waitForTimeout(500); await grab(page, `${user} palette`); await page.keyboard.press("Escape");
      if (await click(page, page.getByRole("button", { name: /Account|Sam Okafor|Maya Chen/ }))) { await grab(page, `${user} account menu`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /Organization/ }))) { await grab(page, `${user} org menu`); await page.keyboard.press("Escape"); }
      if (await click(page, page.getByRole("button", { name: /Other spaces/ }))) await grab(page, `${user} other spaces`);
    }
  }
  await browser.close();
}
const uniq = new Map(); for (const [w, l] of out) if (!uniq.has(l)) uniq.set(l, w);
writeFileSync(new URL("./copy-strings-final.json", import.meta.url), JSON.stringify([...uniq], null, 1));
const reOld = /\b(repo|repos|repository|commit|commits|committed|pull|pulled|pulls|push|pushed|pushing|branch|clone|merge|rebase|sha|remote|manifest|CODEOWNERS|space\.json|write|read|admin)\b|R-\d{8}|\[SelfHub\]|@[a-z]+-[a-z]+|\b[a-z]+-[a-z]+(?:-[a-z]+)?\b/i;
const re = /\b(updates?|repos?|repository|GitHub (write|read|admin)|get latest|sync to|unsaved)\b|@[a-z]+-[a-z]+|\b(commit\w*|push\w*|pull(ed|s)?|branch|clone|remote)\b/i;
for (const [l, w] of uniq) if (re.test(l) && l.length < 300) console.log(`[${w}] ${l}`);
