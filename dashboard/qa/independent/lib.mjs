import { chromium } from "@playwright/test";
export const BASE = "http://localhost:3300";
export const SHOTS = new URL("./shots/", import.meta.url).pathname;
export const AXE = "/tmp/selfhub-qa-axe/node_modules/axe-core/axe.min.js";
export async function open({ user = "sam", theme = "light", width = 1440, height = 900, reduced = false } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", deviceScaleFactor: 1 });
  await ctx.addInitScript(([u, t]) => { if (!sessionStorage.getItem("qa-init")) { localStorage.setItem("selfhub.demoUser", u); localStorage.setItem("theme", t); sessionStorage.setItem("qa-init","1"); } }, [user, theme]);
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", m => { if (["error","warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", e => logs.push("pageerror: " + e.message));
  page.on("response", r => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return { browser, ctx, page, logs };
}
export const shot = (page, name, full = false) => page.screenshot({ path: SHOTS + name + ".png", fullPage: full });
export const toasts = (page) => page.locator("[data-sonner-toast]").allInnerTexts();
