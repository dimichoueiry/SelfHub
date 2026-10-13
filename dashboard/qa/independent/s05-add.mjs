import { open, shot, BASE, toasts } from "./lib.mjs";
const { browser, page, logs } = await open({ user: "maya" });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
const d = page.getByRole("dialog");
try {
await page.goto(BASE + "/");
await page.getByText("Needs you").waitFor(); await page.waitForTimeout(800);
// CREATE
await page.getByRole("button", { name: /Add space/ }).first().click();
await d.getByRole("button", { name: /Create a new space/ }).click();
await page.waitForTimeout(400);
await shot(page, "05-create-form");
console.log("CREATE FORM:", await d.innerText());
await d.getByRole("button", { name: /Create space|Create/ }).last().click();
await page.waitForTimeout(600);
await shot(page, "05-create-empty-submit");
console.log("EMPTY SUBMIT:", (await d.innerText()).slice(0, 600));
await d.getByLabel(/Name/).first().fill("Cedar Dental QA");
const client = d.getByRole("radio", { name: /Client/ }); if (await client.count()) await client.click();
const desc = d.getByLabel(/Description/); if (await desc.count()) await desc.fill("Dental client: brief and offers.");
await shot(page, "05-create-filled");
await d.getByRole("button", { name: /Create space|Create/ }).last().click();
await page.waitForTimeout(300); await shot(page, "05-create-creating");
await page.waitForTimeout(4000);
await shot(page, "05-create-done");
console.log("DONE:", await d.innerText().catch(()=>"(closed)")); await T("t");
const openBtn = d.getByRole("button", { name: /^Open / });
if (await openBtn.count()) { await openBtn.click(); await page.waitForTimeout(2500); console.log("URL", page.url()); await shot(page, "05-create-opened"); console.log((await page.locator("main").innerText()).slice(0,500)); }
// CONNECT plain folder
await page.goto(BASE + "/");
await page.getByText("Needs you").waitFor(); await page.waitForTimeout(500);
await page.getByRole("button", { name: /Add space/ }).first().click();
await d.getByRole("button", { name: /Connect an existing repo/ }).click();
await page.waitForTimeout(400);
await shot(page, "05-connect-form");
console.log("CONNECT FORM:", await d.innerText());
await d.getByLabel("Repository").fill("/tmp/selfhub-qa-extra/plain");
await d.getByRole("button", { name: "Connect", exact: true }).click();
await page.waitForTimeout(2500);
await shot(page, "05-connect-plain-folder");
console.log("PLAIN:", await d.innerText());
} catch (e) { console.log("ERR", e.message); await shot(page, "05-error"); }
console.log(logs.join("\n"));
await browser.close();
