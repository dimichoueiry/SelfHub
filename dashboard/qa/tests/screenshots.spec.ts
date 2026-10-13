import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

const widths = [1440, 1024, 390] as const;
const themes = ["light", "dark"] as const;

type Shot = {
  name: string;
  user?: "sam" | "maya";
  url: string;
  ready: (page: Page) => Promise<void>;
  act?: (page: Page, width: number) => Promise<void>;
  only?: number[];
};

const shots: Shot[] = [
  { name: "home", url: "/", ready: (p) => expect(p.getByText(/Rule waiting for you/).first()).toBeVisible().then(() => expect(p.getByText("Maya gave Leo view access")).toBeVisible()) },
  { name: "space-files", url: "/spaces/apex?path=brief.md", ready: (p) => expect(p.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible() },
  { name: "locked-file", url: "/spaces/northline?path=locked/compliance.md", ready: (p) => expect(p.getByRole("note").getByText(/^Locked\. Only Maya Lindqvist/)).toBeVisible() },
  {
    name: "editor",
    url: "/spaces/apex?path=brief.md",
    ready: (p) => expect(p.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Edit", exact: true }).click();
      await p.getByLabel("Content of brief.md (markdown)").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await p.getByLabel("Content of brief.md (markdown)").pressSequentially("\n- New note");
    },
  },
  { name: "space-history", url: "/spaces/apex/history", ready: (p) => expect(p.getByRole("list", { name: "Changes" })).toBeVisible().then(() => expect(p.locator("table").first()).toBeVisible()) },
  { name: "rules", url: "/rules", ready: (p) => expect(p.locator("article").first()).toBeVisible() },
  { name: "people-sam", url: "/people", ready: (p) => expect(p.getByRole("button", { name: /Leo Brandt/ })).toBeVisible() },
  {
    name: "people-maya-drawer",
    user: "maya",
    url: "/people",
    ready: (p) => expect(p.getByRole("button", { name: /Leo Brandt/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: /^Leo Brandt/ }).click();
      await expect(p.getByRole("dialog", { name: "Leo Brandt" })).toBeVisible();
    },
  },
  { name: "members-maya", user: "maya", url: "/spaces/apex/members", ready: (p) => expect(p.getByRole("list", { name: "Members of Apex Roofing" })).toBeVisible() },
  { name: "no-access", url: "/spaces/bolt", ready: (p) => expect(p.getByText("You don't have access to Bolt HVAC")).toBeVisible() },
  { name: "settings", url: "/settings", ready: (p) => expect(p.getByText("@sam · Northline")).toBeVisible() },
  {
    name: "palette",
    url: "/",
    ready: (p) => expect(p.getByText("Recent activity")).toBeVisible(),
    act: async (p) => {
      await p.keyboard.press("ControlOrMeta+k");
      await p.getByPlaceholder("Search files, spaces and actions…").fill("apex");
      await expect(p.getByRole("option").first()).toBeVisible();
      await expect(p.getByText("Files", { exact: true })).toBeVisible();
    },
  },
  {
    name: "add-space-create",
    url: "/",
    ready: (p) => expect(p.getByText("Recent activity")).toBeVisible(),
    act: async (p, w) => {
      if (w < 768) {
        await p.getByRole("button", { name: "Open navigation" }).click();
      }
      await p.getByRole("button", { name: "Add space" }).first().click();
      await p.getByRole("button", { name: /Create a new space/ }).click();
      await p.getByRole("button", { name: "Create space" }).click();
      await expect(p.getByText("Give the space a name.")).toBeVisible();
    },
  },
  {
    name: "sync-popover",
    url: "/spaces/content",
    ready: (p) => expect(p.getByRole("button", { name: /sync status$/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: /sync status$/ }).click();
      await expect(p.getByText("What to do")).toBeVisible();
    },
  },
  {
    name: "rail-focus",
    url: "/",
    only: [1024],
    ready: (p) => expect(p.getByText("Recent activity")).toBeVisible(),
    act: async (p) => {
      // Keyboard focus (not hover) must reveal the space name and its status.
      await p.getByRole("link", { name: /^Content Team,/ }).focus();
      await expect(p.getByRole("tooltip")).toContainText("Content Team");
    },
  },
  {
    name: "people-maya-confirm",
    user: "maya",
    url: "/people",
    only: [1440, 390],
    ready: (p) => expect(p.getByRole("button", { name: /Leo Brandt/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: /^Leo Brandt/ }).click();
      await p.getByRole("combobox", { name: "Leo Brandt's access to Northline", exact: true }).click();
      await p.getByRole("option", { name: /^No access/ }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "toast",
    url: "/spaces/apex?path=brief.md",
    only: [1440],
    ready: (p) => expect(p.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Edit", exact: true }).click();
      const ed = p.getByLabel("Content of brief.md (markdown)");
      await ed.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await ed.pressSequentially("\n- Toast check");
      await p.getByRole("button", { name: /Save & sync/ }).click();
      await expect(p.locator("[data-sonner-toast]").first()).toBeVisible();
    },
  },
  {
    name: "editor-focus",
    url: "/spaces/apex?path=brief.md",
    only: [1440],
    ready: (p) => expect(p.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Edit", exact: true }).click();
      await p.keyboard.press("Tab");
      await p.keyboard.press("Shift+Tab");
    },
  },
  {
    name: "home-other-spaces",
    url: "/",
    ready: (p) => expect(p.getByRole("heading", { name: /Sam/ })).toBeVisible(),
    act: async (p) => {
      const row = p.getByRole("button", { name: /Other spaces in Northline/ });
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await expect(p.getByRole("link", { name: /Bolt HVAC/ }).last()).toBeVisible();
      await p.getByRole("link", { name: /Bolt HVAC/ }).last().scrollIntoViewIfNeeded();
    },
  },
  {
    name: "table",
    url: "/spaces/northline?path=README.md",
    only: [390, 1440],
    ready: (p) => expect(p.getByRole("heading", { name: "Northline company brain" })).toBeVisible(),
    act: async (p) => {
      await p.locator(".md table").scrollIntoViewIfNeeded();
    },
  },
  {
    name: "role-options",
    user: "maya",
    url: "/spaces/apex/members",
    only: [1440],
    ready: (p) => expect(p.getByRole("list", { name: "Members of Apex Roofing" })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("combobox", { name: "Role for Sam Okafor" }).click();
      await expect(p.getByRole("option", { name: /^No access/ })).toBeVisible();
    },
  },
  {
    name: "mobile-nav",
    url: "/",
    only: [390],
    ready: (p) => expect(p.getByRole("heading", { name: /Sam/ })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      await expect(p.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    },
  },
  {
    name: "mobile-tree-sheet",
    url: "/spaces/apex?path=brief.md",
    only: [390],
    ready: (p) => expect(p.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible(),
    act: async (p) => {
      await p.getByRole("button", { name: "Files", exact: true }).click();
      await expect(p.getByRole("dialog", { name: "Files in Apex Roofing" })).toBeVisible();
    },
  },
];

for (const shot of shots) {
  for (const width of widths) {
    if (shot.only && !shot.only.includes(width)) continue;
    for (const theme of themes) {
      test(`${shot.name} @${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await as(page, shot.user ?? "sam", theme);
        await page.goto(shot.url);
        await shot.ready(page);
        if (shot.act) await shot.act(page, width);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `qa/screenshots/${width}-${theme}/${shot.name}.png` });
      });
    }
  }
}
