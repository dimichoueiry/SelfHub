import { expect, test, type Page } from "@playwright/test";
import { as } from "../tests/helpers";

// Live screenshots at 1440 and 390, light. Runs after the journeys, against the same API.

type Shot = { name: string; user?: "sam" | "maya"; url: string; ready: (p: Page) => Promise<void>; act?: (p: Page, w: number) => Promise<void> };

const shots: Shot[] = [
  {
    name: "home",
    url: "/",
    ready: async (p) => {
      await expect(p.getByText(/(needs? you|Nothing needs you) · \d+ spaces?/)).toBeVisible();
      await expect(p.locator("ol li").first()).toBeVisible();
      await expect(p.locator("main").getByText(/Ads Team|Apex Roofing/).first()).toBeVisible();
    },
  },
  { name: "space-files", url: "/spaces/apex-roofing?path=brief.md", ready: (p) => expect(p.getByText(/Last edited by/)).toBeVisible() },
  { name: "locked-file", url: "/spaces/northline?path=locked/compliance.md", ready: (p) => expect(p.getByRole("note").getByText(/^Locked\. Only/)).toBeVisible() },
  {
    name: "editor",
    url: "/spaces/apex-roofing?path=brief.md",
    ready: (p) => expect(p.getByText(/Last edited by/)).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(p.getByRole("button", { name: /Save & sync/ })).toBeVisible();
    },
  },
  { name: "space-history", url: "/spaces/apex-roofing/history", ready: (p) => expect(p.getByRole("list", { name: "Changes" })).toBeVisible().then(() => expect(p.locator("table").or(p.getByText(/No text changes in this file\.|Only the name changed/)).first()).toBeVisible()) },
  { name: "rules", url: "/rules", ready: (p) => expect(p.getByText(/Only approvers of Apex Roofing can decide/)).toBeVisible() },
  { name: "members-personal", url: "/spaces/me/members", ready: (p) => expect(p.getByText(/This is your personal space/)).toBeVisible() },
  { name: "people", url: "/people", ready: (p) => expect(p.getByRole("button", { name: /Leo Park/ })).toBeVisible() },
  {
    name: "people-maya-drawer",
    user: "maya",
    url: "/people",
    ready: (p) => expect(p.getByRole("button", { name: /Leo Park/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: /^Sam Okafor/ }).click();
      await expect(p.getByText("Via the Ads team. Change it on the team in GitHub.").first()).toBeVisible();
    },
  },
  { name: "members-maya", user: "maya", url: "/spaces/apex-roofing/members", ready: (p) => expect(p.getByRole("list", { name: "Members of Apex Roofing" })).toBeVisible() },
  { name: "no-access", url: "/spaces/bolt-hvac", ready: (p) => expect(p.getByText("You don't have access to Bolt HVAC")).toBeVisible() },
  { name: "personal", url: "/spaces/me", ready: (p) => expect(p.getByText(/Last edited by/)).toBeVisible() },
  {
    name: "palette",
    url: "/",
    ready: (p) => expect(p.getByText("Recent activity")).toBeVisible(),
    act: async (p) => {
      await p.keyboard.press("ControlOrMeta+k");
      await p.getByPlaceholder("Search files, spaces and actions…").fill("apex");
      await expect(p.getByText("Files", { exact: true })).toBeVisible();
    },
  },
  {
    name: "sync-popover",
    url: "/spaces/apex-roofing",
    ready: (p) => expect(p.getByRole("button", { name: /sync status$/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: /sync status$/ }).click();
      await expect(p.getByRole("dialog")).toBeVisible();
    },
  },
  { name: "settings", url: "/settings", ready: (p) => expect(p.getByText("@sam-okafor · Northline")).toBeVisible() },
];

for (const s of shots) {
  for (const width of [1440, 390]) {
    test(`${s.name} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await as(page, s.user ?? "sam", "light");
      await page.goto(s.url);
      await s.ready(page);
      if (s.act) await s.act(page, width);
      await page.waitForTimeout(300);
      await expect(page.locator("body")).not.toContainText(/\[object Object\]|Invalid Date|\bNaN\b|\bundefined\b/);
      // Every avatar image loaded (no broken or empty avatars).
      const broken = await page.locator("img").evaluateAll((imgs) =>
        imgs.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).map((i) => (i as HTMLImageElement).src),
      );
      expect(broken).toEqual([]);
      await page.screenshot({ path: `qa/screenshots-live/${width}-light/${s.name}.png` });
    });
  }
}
