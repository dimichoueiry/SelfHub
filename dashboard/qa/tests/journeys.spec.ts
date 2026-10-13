import { expect, test } from "@playwright/test";
import { as, toast } from "./helpers";

const shot = (name: string) => `qa/screenshots/journeys/${name}.png`;

test("(a) Sam edits the Apex brief and saves & syncs", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/apex?path=brief.md");
  await expect(page.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByLabel("Content of brief.md (markdown)");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.pressSequentially("\n- Prefers photos from real Apex jobs\n");
  await page.getByLabel("Describe your change").fill("Note photo preference");
  await page.screenshot({ path: shot("a-1-editing") });
  await page.getByRole("button", { name: /Save & sync/ }).click();
  await expect(toast(page, "Saved to Apex Roofing and synced to GitHub")).toBeVisible();
  await expect(page.getByText("Prefers photos from real Apex jobs")).toBeVisible();
  await page.screenshot({ path: shot("a-2-saved-toast") });
});

test("(b) Sam opens a Northline locked file and sees why", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/northline?path=locked/compliance.md");
  await expect(page.getByRole("heading", { name: "Compliance rules" })).toBeVisible();
  await expect(page.getByRole("note").getByText("Locked. Only Maya Lindqvist can change this file, through review.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ask Maya Lindqvist for a change/ })).toBeVisible();
  await expect(page.getByText("Opens a GitHub issue")).toBeVisible();
  await expect(page.getByText("This file is locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "compliance.md, locked" })).toBeVisible();
  await page.screenshot({ path: shot("b-locked") });
  // Non-locked Northline files are editable, through review.
  await page.getByRole("treeitem", { name: "ad-review.md" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: /Propose change/ })).toBeVisible();
  await expect(page.getByText(/Opens a review on GitHub/)).toBeVisible();
  await page.screenshot({ path: shot("b-propose") });
});

test("(c) a conflict on save", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/apex?path=work/2026-10-12-spring-promo.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByLabel(/Content of .* \(markdown\)/);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.pressSequentially("\nSam: sending A and C to Dana first.\n");
  await page.keyboard.press("ControlOrMeta+s");
  const dialog = page.getByRole("dialog", { name: "Jordan Reyes changed this file while you were editing" });
  await expect(dialog).toBeVisible();
  // The safe action is the default: look at their change first.
  const see = dialog.getByRole("button", { name: "See what Jordan changed" });
  await expect(see).toBeFocused();
  await expect(dialog.getByText(/tightened the wording/)).toBeHidden();
  await page.screenshot({ path: shot("c-1-conflict") });
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(/tightened the wording before sending to the client/)).toBeVisible();
  await page.screenshot({ path: shot("c-1b-conflict-diff") });
  await expect(dialog.getByRole("button", { name: "Discard my edits" })).toBeVisible();
  await dialog.getByRole("button", { name: "Replace Jordan's changes with mine" }).click();
  await expect(toast(page, "Saved to Apex Roofing and synced to GitHub")).toBeVisible();
  await page.screenshot({ path: shot("c-2-resolved") });
});

test("(d) Sync now on a space that's behind", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/ads-team");
  const status = page.getByRole("button", { name: /^2 changes to get/ });
  await expect(status).toBeVisible();
  await status.click();
  await page.screenshot({ path: shot("d-1-behind") });
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Syncing with GitHub…")).toBeVisible();
  // The open popover shows the outcome itself; no duplicate toast.
  await expect(page.getByRole("status").filter({ hasText: "Got 2 changes from GitHub." })).toBeVisible();
  await expect(toast(page, "Ads Team is up to date")).toHaveCount(0);
  await page.screenshot({ path: shot("d-2-synced") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
});

test("(e1) Add space: create a new space", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  await page.getByRole("button", { name: "Add space" }).first().click();
  await page.getByRole("button", { name: /Create a new space/ }).click();
  await page.getByRole("button", { name: "Create space" }).click();
  await expect(page.getByText("Give the space a name.")).toBeVisible();
  await page.getByLabel("Name").fill("Apex Roofing");
  await expect(page.getByText("A space called Apex Roofing already exists.")).toBeVisible();
  await page.getByLabel("Name").fill("Ridgeline Plumbing");
  await page.getByRole("radio", { name: /Client/ }).click();
  await page.getByLabel(/Description/).fill("Residential plumbing in Fort Collins.");
  await page.getByRole("combobox", { name: "Approvers" }).click();
  await page.getByRole("option", { name: /Priya Natarajan/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Chosen" }).getByText("Priya Natarajan")).toBeVisible();
  await page.screenshot({ path: shot("e1-1-form") });
  await page.getByRole("button", { name: "Create space" }).click();
  await expect(page.getByRole("dialog").locator("ol").getByText("Creating the folder on this computer")).toBeVisible();
  await page.screenshot({ path: shot("e1-2-creating") });
  await expect(page.getByRole("heading", { name: "Ridgeline Plumbing is ready" })).toBeVisible();
  await page.screenshot({ path: shot("e1-3-ready") });
  await page.getByRole("button", { name: "Open Ridgeline Plumbing" }).click();
  await expect(page).toHaveURL(/\/spaces\/ridgeline-plumbing/);
  await expect(page.getByRole("heading", { name: "Ridgeline Plumbing: client brief" })).toBeVisible();
});

test("(e2) Add space: connect an existing GitHub repo", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  await page.getByRole("button", { name: "Add space" }).first().click();
  await page.getByRole("button", { name: /Connect an existing GitHub repository/ }).click();
  await page.getByLabel("GitHub repository", { exact: true }).fill("not a repo");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/doesn't look like a GitHub repo/)).toBeVisible();
  await page.getByRole("button", { name: /northline\/client-summit-solar/ }).click();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveValue("github.com/northline/client-summit-solar");
  await expect(page.getByText(/doesn't look like a GitHub repo/)).toHaveCount(0);
  await page.screenshot({ path: shot("e2-1-pick") });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Summit Solar is ready" })).toBeVisible();
  await page.getByRole("button", { name: "Open Summit Solar" }).click();
  await expect(page).toHaveURL(/\/spaces\/summit-solar/);
});

test("(f) Maya changes Leo's role and invites someone", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People & access" })).toBeVisible();
  await page.getByRole("button", { name: /^Leo Brandt/ }).click();
  const drawer = page.getByRole("dialog", { name: "Leo Brandt" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("combobox", { name: "Leo Brandt's access to Ads Team" }).click();
  await page.getByRole("option", { name: /^Can edit/ }).click();
  await expect(toast(page, "Leo can now edit Ads Team")).toBeVisible();
  await page.screenshot({ path: shot("f-1-role-changed") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /Leo Brandt/ }).getByText("Can edit")).toBeVisible();

  await page.goto("/spaces/apex/members");
  await page.getByLabel("Invite by GitHub username").fill("ghost");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("There's no GitHub user called @ghost.")).toBeVisible();
  await page.getByLabel("Invite by GitHub username").fill("dana-ruiz");
  await page.getByRole("combobox", { name: "Role for the new member" }).click();
  await page.getByRole("option", { name: /^Can view/ }).click();
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(toast(page, "Added @dana-ruiz to Apex Roofing as Can view")).toBeVisible();
  await expect(page.getByRole("list", { name: "Members of Apex Roofing" }).getByText("@dana-ruiz")).toBeVisible();
  await page.screenshot({ path: shot("f-2-invited") });
});

test("(f2) Sam sees access as read-only with a reason", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/apex/members");
  await expect(page.getByText(/Only admins of Apex Roofing can change access/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await page.goto("/spaces/bolt");
  await expect(page.getByRole("heading", { name: "You don't have access to Bolt HVAC" })).toBeVisible();
  await page.screenshot({ path: shot("f2-no-access") });
});

test("(g) Sam approves a pending rule", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/rules");
  const card = page.locator("article").filter({ hasText: "license number in the first two lines" });
  await expect(card).toBeVisible();
  const apex = page.locator("article").filter({ hasText: "Never use urgency phrasing" });
  await expect(apex.getByText("Only approvers of Apex Roofing can decide: Priya Natarajan, Jordan Reyes")).toBeVisible();
  await page.screenshot({ path: shot("g-1-pending") });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(toast(page, "Rule approved")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole("tab", { name: /Active/ }).click();
  await expect(page.locator("article").filter({ hasText: "license number in the first two lines" }).getByText(/approved by Sam/)).toBeVisible();
  await page.screenshot({ path: shot("g-2-active") });
});

test("(h) ⌘K search opens a file", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Sam/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search files, spaces and actions…");
  await expect(input).toBeFocused();
  await input.fill("urgency");
  await expect(page.getByRole("option", { name: /Apex Roofing: client brief/ })).toBeVisible();
  await page.screenshot({ path: shot("h-1-search") });
  await page.getByRole("option", { name: /Apex Roofing: client brief/ }).click();
  await expect(page).toHaveURL(/\/spaces\/apex\?path=brief\.md/);
  await expect(page.getByRole("heading", { name: "Apex Roofing: client brief" })).toBeVisible();
  // Bolt HVAC is never searched for Sam.
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("kevin osei");
  await expect(page.getByText(/No results for/)).toBeVisible();
});

test("unsaved-changes guard and tree keyboard navigation", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/spaces/apex?path=brief.md");
  await page.getByRole("treeitem", { name: "rules" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("treeitem", { name: "rules" })).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("treeitem", { name: "work" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: "2026-08-storm-season.md" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/path=work%2F2026-08-storm-season\.md/);
  await page.goto("/spaces/apex?path=brief.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Content of brief.md (markdown)").pressSequentially("x");
  await page.getByRole("link", { name: /^Home$/ }).click();
  await expect(page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/spaces\/apex/);
});

test("(P0-2) removing access from the person drawer asks first, and Undo restores it", async ({ page }) => {
  await as(page, "maya");
  await page.goto("/people");
  await page.getByRole("button", { name: /^Leo Brandt/ }).click();
  const drawer = page.getByRole("dialog", { name: "Leo Brandt" });
  await drawer.getByRole("combobox", { name: "Leo Brandt's access to Northline", exact: true }).click();
  await page.getByRole("option", { name: /^No access/ }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove Leo Brandt from Northline?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/They lose access on GitHub/)).toBeVisible();
  await page.screenshot({ path: shot("p0-2-confirm") });
  await confirm.getByRole("button", { name: "Remove" }).click();
  const t = toast(page, "Leo no longer has access to Northline");
  await expect(t).toBeVisible();
  await t.getByRole("button", { name: "Undo" }).click();
  await expect(toast(page, /Undone. Leo is back to Can view in Northline/)).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Leo Brandt's access to Northline", exact: true })).toHaveText(/Can view/);
});

test("(P0-3) a conflict names the other person and opens the file in the editor", async ({ page }) => {
  await as(page, "sam");
  await page.goto("/");
  const row = page.locator("li").filter({ hasText: "Content Team: conflict needs attention" });
  await expect(row.getByRole("link", { name: "Resolve" })).toBeVisible();
  await page.goto("/spaces/content");
  await page.getByRole("button", { name: /^Conflict needs attention/ }).click();
  await expect(page.getByText("Ask Priya Natarajan which version to keep.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await page.screenshot({ path: shot("p0-3-conflict-popover") });
  await page.getByRole("link", { name: "Open content-calendar.md" }).click();
  await expect(page.getByLabel("Content of content-calendar.md (markdown)")).toBeVisible();
});
