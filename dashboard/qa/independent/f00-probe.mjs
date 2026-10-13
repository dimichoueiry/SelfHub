import { open, BASE } from "./lib.mjs";
const { browser, page } = await open();
await page.goto(BASE + "/spaces/ads-team"); await page.getByRole("tree").waitFor(); await page.waitForTimeout(500);
console.log(await page.locator("button").evaluateAll(b => b.map(x => `${x.getAttribute("aria-label") || ""} | ${x.innerText.trim().slice(0, 40)}`).filter(s => /sync|change|GitHub/i.test(s))));
await browser.close();
