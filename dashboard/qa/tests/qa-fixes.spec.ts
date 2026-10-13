import { expect, test } from "@playwright/test";
import { as, toast } from "./helpers";

// Regression tests for the independent QA round (items 1, 2, 3, 5, 10 and the P0 path).
const shot = (name: string) => `qa/screenshots/qa-fixes/${name}.png`;

test("1: rename shows no false 'isn't in' toast and lands on the new file", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=templates/ad-brief.md");
  await expect(page.getByRole("heading", { name: "Ad brief template" })).toBeVisible();
  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "Rename or move" }).click();
  const input = page.getByLabel("New name");
  await input.fill("templates/fb brief?.md");
  await expect(page.getByText(/Leave out \?|Use hyphens instead of spaces/)).toBeVisible();
  await input.fill("templates/facebook-ad-brief.md");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(toast(page, "Renamed to facebook-ad-brief.md")).toBeVisible();
  await expect(page).toHaveURL(/path=templates%2Ffacebook-ad-brief\.md/);
  await expect(page.getByRole("heading", { name: "Ad brief template" })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /isn't in/ })).toHaveCount(0);
  await page.screenshot({ path: shot("1-renamed") });
});

test("2a: Enter on 'No access' in the person drawer opens the confirm, and nothing else", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/people");
  await page.getByRole("button", { name: /^Leo Brandt/ }).click();
  const select = page.getByRole("combobox", { name: "Leo Brandt's access to Northline", exact: true });
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: /^No access/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Remove Leo Brandt from Northline?" });
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(300);
  await expect(confirm).toBeVisible(); // not cancelled by the same keypress
  await expect(confirm).toBeFocused();
  // Nothing changed yet (the drawer is hidden from the accessibility tree while the dialog is open).
  await expect(page.locator(`[role="combobox"][aria-label="Leo Brandt's access to Northline"]`)).toHaveText(/Can view/);
  await page.screenshot({ path: shot("2a-drawer-confirm") });
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(select).toBeFocused();
});

test("2b: Enter on 'No access' in Members opens the confirm; Escape returns focus", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/spaces/apex/members");
  const select = page.getByRole("combobox", { name: "Role for Sam Okafor" });
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: /^No access/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Remove Sam Okafor from Apex Roofing?" });
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(300);
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();
});

test("3: focus returns after ⌘K, the drawer, ⌘S, and tree Enter", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/people");
  // ⌘K opened from the Search button → Escape → back on the button.
  const search = page.getByRole("button", { name: /^Search/ }).first();
  await search.click();
  await expect(page.getByPlaceholder("Search files, spaces and actions…")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  // Person drawer → Escape → back on the row.
  const row = page.getByRole("button", { name: /^Leo Brandt/ });
  await row.click();
  await expect(page.getByRole("dialog", { name: "Leo Brandt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();

  // ⌘S save → focus on the Edit button, not <body>.
  await page.goto("/spaces/apex?path=brief.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByLabel("Content of brief.md (markdown)");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.pressSequentially("\n- Focus check\n");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toast(page, /Saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();

  // Tree: Enter opens the file and focus stays on that row.
  const item = page.getByRole("treeitem", { name: "2026-08-storm-season.md" });
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/storm-season/);
  await page.waitForTimeout(500);
  await expect(item).toBeFocused();
});

test("5: CSV renders as a table; the reader region is focusable and labelled", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=templates/campaign-naming.csv");
  const region = page.getByRole("region", { name: "Contents of campaign-naming.csv" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("columnheader", { name: "field" })).toBeVisible();
  await expect(region.getByRole("cell", { name: "{city}_{age_range}" })).toBeVisible();
  await region.focus();
  await expect(region).toBeFocused();
  await page.screenshot({ path: shot("5-csv-table") });
});

async function typeAtTop(page: import("@playwright/test").Page, label: RegExp | string, text: string) {
  const editor = page.getByLabel(label);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await editor.pressSequentially(text);
  return editor;
}

test("P0a: Sync now while editing keeps the draft when the changes don't touch this file", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=templates/ad-brief.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "Jordan Reyes made 2 changes since you last synced." });
  await expect(notice).toBeVisible();
  const editor = await typeAtTop(page, "Content of ad-brief.md (markdown)", "QA TOP LINE\n");
  await expect(page.getByText("· Unsaved changes")).toBeVisible();
  await notice.getByRole("button", { name: "Sync now" }).click();
  await expect(toast(page, "Got the latest changes")).toBeVisible();
  await expect(toast(page, "Got the latest changes")).toContainText("Your unsaved changes are still here");
  await expect(editor).toHaveValue(/^QA TOP LINE\n# Ad brief template/);
  await expect(page.getByText("· Unsaved changes")).toBeVisible();
  await expect(page.getByText(/also changed this file/)).toHaveCount(0);
  await page.screenshot({ path: shot("p0a-sync-no-overlap") });
});

test("P0b: Sync now while editing keeps the draft and flags it when the changes touch this file", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=sops/facebook-ads.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = await typeAtTop(page, "Content of facebook-ads.md (markdown)", "QA TOP LINE\n");
  await page.getByRole("status").filter({ hasText: /made 2 changes since you last synced/ }).getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Jordan Reyes also changed this file. When you save, you'll choose what to keep." })).toBeVisible();
  await expect(editor).toHaveValue(/^QA TOP LINE\n# Facebook and Instagram ads/);
  await expect(page.getByText("· Unsaved changes")).toBeVisible();
  await page.screenshot({ path: shot("p0b-sync-overlap") });
  // Saving goes through the conflict dialog, safe action first.
  await page.getByRole("button", { name: /Save & sync/ }).click();
  const dialog = page.getByRole("dialog", { name: "Jordan Reyes changed this file while you were editing" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "See what Jordan changed" }).click();
  await expect(dialog.getByText(/Creative testing cadence/)).toBeVisible();
});

test("10b: a save that brought in changes says so", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=templates/ad-brief.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByLabel("Content of ad-brief.md (markdown)");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.pressSequentially("\n- **Deadline:**\n");
  await page.getByRole("button", { name: /Save & sync/ }).click();
  await expect(toast(page, "Saved. Also brought in 2 changes from Jordan.")).toBeVisible();
});

test("P0: unsaved edits on this computer are listed and can be saved", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  const row = page.locator("li").filter({ hasText: "Sam Okafor: not on GitHub yet" });
  await expect(row).toBeVisible();
  await page.goto("/spaces/personal-sam");
  await page.getByRole("button", { name: /^Not on GitHub yet/ }).click();
  const list = page.getByRole("list", { name: "Edited on this computer" });
  await expect(list.getByRole("link", { name: "notes/2026-10-11.md" })).toBeVisible();
  await expect(list.getByRole("link", { name: "sops/ads.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await page.getByLabel(/Describe these changes/).fill("Notes from today");
  await page.screenshot({ path: shot("p0-local-changes-popover") });
  await page.getByRole("button", { name: "Save these changes" }).click();
  await expect(toast(page, "Saved 2 files to GitHub")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
});

test("B1: delete shows no false 'isn't in' toast and lands on the main file", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team?path=templates/ad-brief.md");
  await expect(page.getByRole("heading", { name: "Ad brief template" })).toBeVisible();
  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete file" }).click();
  await expect(toast(page, "Deleted ad-brief.md")).toBeVisible();
  await expect(page).not.toHaveURL(/path=templates%2Fad-brief\.md/);
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /isn't in/ })).toHaveCount(0);
  // A genuinely missing path still gets the notice.
  await page.goto("/spaces/ads-team?path=templates/never-existed.md");
  await expect(toast(page, "templates/never-existed.md isn't in Ads Team")).toBeVisible();
});

test("B2: Sync all spaces now names what's still not on GitHub and opens it", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  await page.getByRole("button", { name: "Sync all spaces now" }).click();
  const result = page.locator("[data-sonner-toast]").filter({ hasText: /^Synced \d+ spaces?\./ });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Sam Okafor has 2 files that aren't on GitHub yet.");
  await expect(result).toContainText("Content Team has a conflict to resolve.");
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Everything is up to date" })).toHaveCount(0);
  await page.screenshot({ path: shot("B2-sync-all") });
  await result.getByRole("button", { name: "Open Content Team" }).click();
  await expect(page).toHaveURL(/\/spaces\/content(\?|$)/);
});
