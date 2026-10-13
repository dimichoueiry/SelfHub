import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
async function invite(login, tag) {
  await page.getByLabel(/GitHub username/).first().fill(login);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const t = await toasts(page);
    const err = await page.locator("main [role=alert], main p.text-danger-text, main [id*=error]").allInnerTexts().catch(() => []);
    if (t.length || err.length) { console.log(tag, i*300+300, "ms toast:", JSON.stringify(t), "inline:", JSON.stringify(err)); await shot(page, `04e-${tag}`); return; }
  }
  console.log(tag, "no toast/inline after 3s"); await shot(page, `04e-${tag}`);
  console.log((await page.locator("main").innerText()).split("Invite\n")[1]?.slice(0, 200));
}
try {
await page.goto(BASE + "/spaces/apex-roofing/members");
await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(500);
await invite("casey-lee", "new-user");
await invite("alex-rivera", "duplicate");
await invite("sam-okafor", "team-member");
} catch (e) { console.log("ERR", e.message); }
console.log(logs.join("\n"));
await browser.close();
