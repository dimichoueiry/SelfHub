import { open, shot, BASE, toasts } from "./lib.mjs";
const S = (p, n, f) => shot(p, "re/" + n, f);
const { browser, page, logs } = await open({ user: "maya", reduced: true });
const T = async (l) => console.log(l, JSON.stringify(await toasts(page)));
const d = page.getByRole("dialog");
try {
await page.goto(BASE + "/"); await page.getByText("Needs you").waitFor(); await page.waitForTimeout(800);
await S(page, "r07-maya-home");
console.log("MAYA HOME:", (await page.locator("main").innerText()).slice(0, 900));
// connect plain folder
await page.getByRole("button", { name: /Add space/ }).first().click();
await d.getByRole("button", { name: /Connect/ }).first().click(); await page.waitForTimeout(400);
await S(page, "r07-connect-form"); console.log("CONNECT FORM:", await d.innerText());
const repo = d.getByRole("textbox").first();
await repo.fill("/tmp/selfhub-qa-extra/plain");
await d.getByRole("button", { name: "Connect", exact: true }).click(); await page.waitForTimeout(2500);
await S(page, "r07-connect-plain"); console.log("PLAIN ERR:", await d.innerText());
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
// create
await page.getByRole("button", { name: /Add space/ }).first().click();
await d.getByRole("button", { name: /Create a new space/ }).click(); await page.waitForTimeout(300);
await d.getByRole("button", { name: /^Create space/ }).click(); await page.waitForTimeout(400);
const name = d.getByLabel(/^Name/);
await name.fill("Cedar Dental QA"); await page.waitForTimeout(200);
console.log("name aria-invalid after typing:", await name.getAttribute("aria-invalid"));
await S(page, "r07-create-filled");
await d.getByRole("radio", { name: /Client/ }).click().catch(()=>{});
await d.getByRole("button", { name: /^Create space/ }).click(); await page.waitForTimeout(4000);
await S(page, "r07-create-done"); console.log("CREATE DONE:", await d.innerText().catch(()=>"(closed)"));
await d.getByRole("button", { name: /^Open / }).click(); await page.waitForTimeout(2500);
await S(page, "r07-created-space"); console.log("NEW SPACE header:", (await page.locator("main").innerText()).slice(0, 300));
await page.goto(BASE + "/spaces/cedar-dental-qa/settings"); await page.waitForTimeout(2000);
await S(page, "r07-space-settings", true); console.log("SETTINGS:", (await page.locator("main").innerText()).slice(0, 1600));
// rules
await page.goto(BASE + "/rules"); await page.getByRole("button", { name: /^Reject/ }).first().waitFor(); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Reject/ }).last().click(); await page.waitForTimeout(500);
const ad = page.getByRole("alertdialog").or(d).first();
await S(page, "r07-reject-dialog"); console.log("REJECT DLG:", await ad.innerText());
const reason = ad.getByRole("textbox"); if (await reason.count()) await reason.fill("We already track calls with CallRail; not needed.");
await ad.getByRole("button", { name: /Reject rule/ }).click(); await page.waitForTimeout(1500); await T("reject:");
const undo = page.locator("[data-sonner-toast]").getByRole("button", { name: /Undo/ });
console.log("reject undo present:", await undo.count());
await page.getByRole("tab", { name: /Rejected/ }).click(); await page.waitForTimeout(800);
await S(page, "r07-rejected-tab"); console.log("REJECTED:", (await page.locator("main").innerText()).slice(0, 700));
await page.getByRole("tab", { name: /Pending/ }).click(); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Approve/ }).first().click(); await page.waitForTimeout(1500); await T("approve:");
console.log("approve undo present:", await undo.count());
await S(page, "r07-approved");
} catch (e) { console.log("ERR", e.message); await S(page, "r07-error"); }
console.log(logs.join("\n"));
await browser.close();
