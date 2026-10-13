import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// SH-7 / SH-5: a space that's only on this computer, and connecting it to GitHub (sample mode).
const shot = (name: string) => `qa/screenshots/connect-github/${name}.png`;

const POPOVER_LINE =
  "Connect it to GitHub to back it up and share it with your team. GitHub is a free service that stores your files online.";

async function createRidgeline(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Add space" }).first().click();
  await expect(page.getByText("Start from a template. It's saved on this computer first, and you can connect it to GitHub after.")).toBeVisible();
  await page.getByRole("button", { name: /Create a new space/ }).click();
  await expect(page.getByText("It stays on this computer until you connect it to GitHub.")).toBeVisible();
  await page.getByLabel("Name").fill("Ridgeline Plumbing");
  await page.screenshot({ path: shot("01-create-form") });
  await page.getByRole("button", { name: "Create space" }).click();
  await expect(page.getByRole("dialog").locator("ol").getByText("Creating the folder on this computer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ridgeline Plumbing is ready" })).toBeVisible();
}

test("popover: admin connects a local space, focus moves in and back", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/");
  await createRidgeline(page);
  await expect(page.getByText("Created on this computer with starter files.")).toBeVisible();
  await page.getByRole("button", { name: "Open Ridgeline Plumbing" }).click();
  await expect(page).toHaveURL(/\/spaces\/ridgeline-plumbing/);

  const pill = page.getByRole("button", { name: "Not connected to GitHub, sync status" });
  await pill.click();
  const popover = page.getByRole("dialog").filter({ hasText: "Only on this computer" });
  await expect(popover.getByText(POPOVER_LINE)).toBeVisible();
  await expect(popover.getByText("Only on this computer")).toHaveCount(1);
  await page.screenshot({ path: shot("02-popover-admin") });

  await popover.getByRole("button", { name: "Connect to GitHub" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect to GitHub" });
  await expect(dialog.getByLabel("Repository name")).toHaveValue("client-ridgeline-plumbing");
  await expect(dialog.getByRole("heading", { name: "Connect to GitHub" })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: /Private/ })).toBeChecked();
  await page.screenshot({ path: shot("03-confirm") });

  // Name already taken: say so and offer a free one.
  await dialog.getByLabel("Repository name").fill("client-summit-solar");
  await dialog.getByRole("button", { name: "Create private repo and connect" }).click();
  await expect(page.getByText("northline already has a repository called client-summit-solar on GitHub.")).toBeVisible();
  await page.screenshot({ path: shot("04-name-taken") });
  await page.getByRole("button", { name: "Use client-summit-solar-2" }).click();
  await expect(page.getByLabel("Repository name")).toHaveValue("client-summit-solar-2");

  await page.getByRole("button", { name: "Create private repo and connect" }).click();
  await expect(page.getByRole("heading", { name: "Connecting to GitHub…" })).toBeVisible();
  await page.screenshot({ path: shot("05-working") });
  const done = page.getByRole("dialog", { name: "Connected to GitHub" });
  await expect(done).toBeVisible();
  await expect(done.getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute("href", "https://github.com/northline/client-summit-solar-2");
  await page.screenshot({ path: shot("06-success") });
  await done.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeFocused();
});

test("fallback: not logged in, copy the prompt, check again", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await as(page, "maya");
  await page.addInitScript(() => window.localStorage.setItem("selfhub.mock.gh", "logged-out"));
  await page.goto("/");
  await createRidgeline(page);
  await page.getByRole("button", { name: "Also connect to GitHub now" }).click();
  await expect(page.getByRole("heading", { name: "You're not logged in to GitHub on this computer" })).toBeVisible();
  await expect(page.getByRole("link", { name: /github.com\/signup/ })).toHaveAttribute("href", "https://github.com/signup");
  const prompt = page.getByLabel("Prompt for Claude or Codex");
  await expect(prompt).toHaveValue(/^The folder: \/Users\/maya\/SelfHub\/spaces\/ridgeline-plumbing$/m);
  await expect(prompt).toHaveValue(/Create a PRIVATE repository named client-ridgeline-plumbing in my own GitHub account/);
  for (const step of ["`gh --version`", "brew install git gh", "https://github.com/signup", "`gh auth login`", "git init", "--private --source . --remote origin --push", "ask me before changing it", 'click "Check again"'])
    await expect(prompt).toHaveValue(new RegExp(step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(prompt).toHaveJSProperty("readOnly", true);
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/Users/maya/SelfHub/spaces/ridgeline-plumbing");
  await page.screenshot({ path: shot("07-fallback-logged-out") });

  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Still not logged in. Finish the steps, then check again.")).toBeVisible();
  await page.screenshot({ path: shot("08-still-logged-out") });

  // They log in (with their AI's help), then check again.
  await page.evaluate(() => window.localStorage.removeItem("selfhub.mock.gh"));
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Connect to GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Create private repo and connect" }).click();
  await expect(page.getByRole("heading", { name: "Connected to GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/is on GitHub as northline\/client-ridgeline-plumbing/)).toBeVisible();
  await page.screenshot({ path: shot("09-create-done-connected") });
});

test("fallback: no GitHub CLI, and chosen by hand", async ({ page }) => {
  await as(page, "maya");
  await page.addInitScript(() => window.localStorage.setItem("selfhub.mock.gh", "gh-missing"));
  await page.goto("/");
  await createRidgeline(page);
  await page.getByRole("button", { name: "Also connect to GitHub now" }).click();
  await expect(page.getByRole("heading", { name: "The GitHub CLI (gh) isn't installed" })).toBeVisible();
  await page.screenshot({ path: shot("10-fallback-gh-missing") });
  await page.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("heading", { name: "Ridgeline Plumbing is ready" })).toBeVisible();

  await page.evaluate(() => window.localStorage.removeItem("selfhub.mock.gh"));
  await page.getByRole("button", { name: "Also connect to GitHub now" }).click();
  await page.getByRole("button", { name: "Do it with Claude or Codex instead" }).click();
  await expect(page.getByRole("heading", { name: "Do it with Claude or Codex" })).toBeVisible();
  await page.screenshot({ path: shot("11-fallback-chosen") });
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Connect to GitHub" })).toBeVisible();
});

test("popover: non-admins are told to ask an admin", async ({ page }) => {
  // Sam can view Northline Archive, which is only on Maya's computer.
  await as(page, "sam");
  await page.goto("/spaces/archive");
  await page.getByRole("button", { name: "Not connected to GitHub, sync status" }).click();
  await expect(page.getByText("Ask an admin to connect this space to GitHub.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to GitHub" })).toHaveCount(0);
  await page.screenshot({ path: shot("12-popover-non-admin") });
});

test("members page: admins can connect from the note", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/spaces/archive/members");
  await page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Connect to GitHub" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Connect to GitHub" })).toBeFocused();
});

test("fallback: the prompt is filled in even when the check itself fails", async ({ page, context }) => {
  // The bug: an API without the check (404) left the prompt empty and Copy disabled.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await as(page, "maya");
  await page.addInitScript(() => window.localStorage.setItem("selfhub.mock.gh", "check-fails"));
  await page.goto("/spaces/archive/members");
  await page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Couldn't connect to GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Do it with Claude or Codex instead" }).click();
  await expect(page.getByRole("heading", { name: "Do it with Claude or Codex" })).toBeVisible();
  const prompt = page.getByLabel("Prompt for Claude or Codex");
  await expect(prompt).toHaveValue(/^The folder: \/Users\/maya\/SelfHub\/spaces\/archive$/m);
  await expect(prompt).toHaveValue(/cd \/Users\/maya\/SelfHub\/spaces\/archive/);
  expect((await prompt.inputValue()).length).toBeGreaterThan(1500);
  // Tall enough to read a good part of it.
  expect((await prompt.boundingBox())!.height).toBeGreaterThan(250);
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("The folder: /Users/maya/SelfHub/spaces/archive");
  await page.screenshot({ path: shot("13-fallback-check-failed") });
});
