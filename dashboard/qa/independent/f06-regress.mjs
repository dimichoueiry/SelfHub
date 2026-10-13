import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n) => shot(p, "final/f06-" + n);
const waitToast = async (page) => { for (let i = 0; i < 12; i++) { await page.waitForTimeout(300); const t = await toasts(page); if (t.length) return t; } return []; };
{ const { browser, page, logs } = await open({ user: "maya", reduced: true });
  try {
  await page.goto(BASE + "/spaces/apex-roofing/members"); await page.getByText("Tess Alvarez").waitFor(); await page.waitForTimeout(400);
  await page.getByLabel(/GitHub username/).fill("casey-lee"); await page.keyboard.press("Enter");
  console.log("invite:", JSON.stringify(await waitToast(page))); await page.waitForTimeout(500); await S(page, "invited");
  console.log("row:", (await page.locator("main").innerText()).match(/casey-lee[^\n]*\n?[^\n]*/)?.[0].replace(/\n/g, " / "));
  await page.goto(BASE + "/people"); await page.getByText("Leo Park").first().waitFor(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Leo Park/ }).click(); await page.waitForTimeout(400);
  await page.getByRole("combobox", { name: /access to Ads Team/ }).click(); await page.waitForTimeout(300);
  console.log("drawer options:", (await page.getByRole("option").allInnerTexts()).map(s => s.replace(/\n/g, " — ")));
  await S(page, "role-options");
  await page.getByRole("option", { name: /^Can edit/ }).click();
  console.log("role change:", JSON.stringify(await waitToast(page)));
  await page.locator("[data-sonner-toast]").getByRole("button", { name: /Undo/ }).first().click(); await page.waitForTimeout(1500);
  console.log("undo:", JSON.stringify(await toasts(page)), "| value:", await page.getByRole("combobox", { name: /access to Ads Team/ }).innerText());
  await S(page, "undo");
  } catch (e) { console.log("ERR", e.message); await S(page, "maya-error"); }
  console.log(logs.join("\n")); await browser.close(); }
{ const { browser, page, logs } = await open({ reduced: true });
  try {
  const more = () => page.getByRole("button", { name: /More file actions/ }).first();
  await page.goto(BASE + "/spaces/ads-team?path=templates%2Ffacebook-variants.md"); await page.getByText("Last edited by").waitFor(); await page.waitForTimeout(400);
  await more().click(); await page.getByRole("menuitem", { name: /Rename/ }).click(); await page.waitForTimeout(300);
  const d = page.getByRole("dialog");
  await d.getByRole("textbox").first().fill("templates/fb-variants.md"); await d.getByRole("button", { name: /^Rename/ }).click();
  const t = await waitToast(page); await page.waitForTimeout(1200);
  console.log("rename toasts:", JSON.stringify(await toasts(page)), "url:", decodeURIComponent(page.url()).split("path=")[1]); await S(page, "renamed");
  await more().click(); await page.getByRole("menuitem", { name: /Delete/ }).click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Delete file" }).click();
  console.log("delete:", JSON.stringify(await waitToast(page))); await page.waitForTimeout(800); await S(page, "deleted");
  console.log("tree fb:", await page.getByRole("treeitem", { name: /fb-variants/ }).count());
  } catch (e) { console.log("ERR", e.message); await S(page, "sam-error"); }
  console.log(logs.join("\n")); await browser.close(); }
