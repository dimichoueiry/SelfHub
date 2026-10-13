import { open, shot, BASE, toasts } from "./lib.mjs";
for (const user of ["sam", "maya"]) {
  const { browser, page } = await open({ user });
  await page.goto(BASE + "/"); await page.getByText("Needs you").waitFor(); await page.waitForTimeout(800);
  console.log(user, "before:", (await page.locator("main").innerText()).match(/Needs you[\s\S]*?Your spaces/)?.[0].replace(/\n+/g, " | "));
  await page.getByRole("button", { name: /Sync all spaces now/ }).first().click();
  let seen = [];
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(300); for (const t of await toasts(page)) if (!seen.includes(t)) seen.push(t); if (seen.some(t => !/Syncing/.test(t))) break; }
  await page.waitForTimeout(800);
  console.log(user, "toasts:", JSON.stringify(seen));
  await shot(page, `final/f02-syncall-${user}`);
  console.log(user, "after:", (await page.locator("main").innerText()).match(/Needs you[\s\S]*?Your spaces/)?.[0].replace(/\n+/g, " | "));
  await browser.close();
}
const r = await (await fetch("http://localhost:8788/api/spaces", { headers: { "X-SelfHub-User": "maya-chen" } })).json();
console.log(r.map(s => `${s.id}:${s.sync.state}`).join(" "));
