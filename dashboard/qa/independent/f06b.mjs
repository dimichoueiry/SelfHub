import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page } = await open({ reduced: true });
const seen = []; const poll = async (ms) => { for (let i = 0; i < ms / 150; i++) { await page.waitForTimeout(150); for (const t of await toasts(page)) if (!seen.includes(t)) { seen.push(t); console.log("  +toast @" + i * 150 + "ms:", t.replace(/\n/g, " / ")); } } };
const more = () => page.getByRole("button", { name: /More file actions/ }).first();
for (const [from, to] of [["templates/ad-brief.md", "templates/brief-template.md"], ["sops/google-ads.md", "sops/google-search.md"]]) {
  seen.length = 0;
  await page.goto(BASE + "/spaces/ads-team?path=" + encodeURIComponent(from)); await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(600);
  await more().click(); await page.getByRole("menuitem", { name: /Rename/ }).click(); await page.waitForTimeout(300);
  await page.getByRole("dialog").getByRole("textbox").first().fill(to);
  console.log("rename", from, "->", to);
  await page.getByRole("dialog").getByRole("button", { name: /^Rename/ }).click();
  await poll(3000); await shot(page, "final/f06b-rename-" + to.split("/")[1].replace(".md", ""));
  console.log("  url:", decodeURIComponent(page.url()).split("path=")[1], "| h1:", await page.locator("section[aria-label=File] h1").first().innerText().catch(() => "?"));
}
seen.length = 0;
await more().click(); await page.getByRole("menuitem", { name: /Delete/ }).click(); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Delete file" }).click(); console.log("delete:"); await poll(3000);
await shot(page, "final/f06b-deleted");
await browser.close();
const m = await open({ user: "maya" });
await m.page.goto(BASE + "/spaces/apex-roofing/members"); await m.page.getByText("Tess Alvarez").waitFor(); await m.page.waitForTimeout(500);
console.log("casey row:", (await m.page.locator("main").innerText()).match(/casey-lee[\s\S]{0,80}/)?.[0].replace(/\n+/g, " / "));
await m.browser.close();
