import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request, test, type Page } from "@playwright/test";
import { as, toast } from "../tests/helpers";

// Journeys (a)-(h) against the live selfhub-api (demo seed). Run through qa/live/run.sh.

const API = process.env.QA_API_URL ?? "http://localhost:8788/api";
const shot = (name: string) => `qa/screenshots-live/journeys/${name}.png`;

/** Talk to the API directly, as a given demo user (used to make a teammate's change). */
async function api(user: "sam-okafor" | "maya-chen") {
  return request.newContext({ baseURL: API + "/", extraHTTPHeaders: { "X-SelfHub-User": user } });
}

/** Data-shape smoke check: nothing on screen should leak a raw value. */
async function noLeaks(page: Page) {
  await expect(page.locator("body")).not.toContainText(/\[object Object\]|Invalid Date|\bNaN\b|\bundefined\b|\bnull\b/);
}

async function typeAtEnd(page: Page, text: string) {
  const editor = page.getByLabel(/Content of .* \(markdown\)/);
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await editor.pressSequentially(text);
}

test.describe.serial("live journeys", () => {
  test("(b) Sam opens a Northline locked file and sees who can change it", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/northline?path=locked/compliance.md");
    await expect(page.getByRole("note").getByText("Locked. Only Maya Chen or Marcus Bell can change this file. Ask them to make the change.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Ask Maya Chen or Marcus Bell for a change/ })).toBeVisible();
    await expect(page.getByText("This file is locked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "compliance.md, locked" })).toBeVisible();
    await noLeaks(page);
    await page.screenshot({ path: shot("b-locked") });
  });

  test("no access: Bolt HVAC lands on the no-access state, even by direct link", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/bolt-hvac");
    await expect(page.getByRole("heading", { name: "You don't have access to Bolt HVAC" })).toBeVisible();
    await page.goto("/spaces/bolt-hvac/history");
    await expect(page.getByRole("heading", { name: "You don't have access to Bolt HVAC" })).toBeVisible();
  });

  test("(a) Sam edits the Apex brief and saves & syncs", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing?path=brief.md");
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText("Apex Roofing");
    await expect(page.getByText(/Last edited by Priya Nair/)).toBeVisible();
    await noLeaks(page);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await typeAtEnd(page, "\n- Prefers photos from real Apex jobs (live QA)\n");
    await page.getByLabel("Describe your change").fill("Note photo preference");
    await page.getByRole("button", { name: /Save & sync/ }).click();
    await expect(toast(page, "Saved to Apex Roofing and synced to GitHub")).toBeVisible();
    await page.screenshot({ path: shot("a-saved-toast") });
    await page.reload();
    await expect(page.getByText("Prefers photos from real Apex jobs (live QA)")).toBeVisible();
    await expect(page.getByText(/Last edited by Sam Okafor/)).toBeVisible();
    const sam = await api("sam-okafor");
    const file = await (await sam.get("spaces/apex-roofing/file?path=brief.md")).json();
    expect(file.content).toContain("Prefers photos from real Apex jobs (live QA)");
    expect(file.lastCommit.message).toBe("Note photo preference");
  });

  test("(c) conflict: Maya saves first, Sam's stale save gets a conflict and keeps his version", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing?path=offers.md");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await typeAtEnd(page, "\nSam: offer copy approved by Dana.\n");

    // Maya changes the same file through the API while Sam is editing.
    const maya = await api("maya-chen");
    const theirs = await (await maya.get("spaces/apex-roofing/file?path=offers.md")).json();
    const put = await maya.put("spaces/apex-roofing/file", {
      data: { path: "offers.md", content: theirs.content + "\nMaya: double-check the end date.\n", message: "Maya: end date note", baseSha: theirs.sha },
    });
    expect(put.status()).toBe(200);

    await page.keyboard.press("ControlOrMeta+s");
    const dialog = page.getByRole("dialog", { name: "Maya Chen changed this file while you were editing" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "See what Maya changed" })).toBeFocused();
    await dialog.getByRole("button", { name: "See what Maya changed" }).click();
    await expect(dialog.getByText("Maya: double-check the end date.")).toBeVisible();
    await noLeaks(page);
    await page.screenshot({ path: shot("c-conflict") });
    await dialog.getByRole("button", { name: "Replace Maya's changes with mine" }).click();
    await expect(toast(page, "Saved to Apex Roofing and synced to GitHub")).toBeVisible();
    const after = await (await maya.get("spaces/apex-roofing/file?path=offers.md")).json();
    expect(after.content).toContain("Sam: offer copy approved by Dana.");
  });

  test("(c2) 422 no-change shows a calm 'No changes to save'", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing?path=offers.md");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const maya = await api("maya-chen");
    const theirs = await (await maya.get("spaces/apex-roofing/file?path=offers.md")).json();
    // Maya saves exactly what Sam is about to save.
    const line = "\nBoth: free inspection runs through Nov 30.\n";
    await maya.put("spaces/apex-roofing/file", {
      data: { path: "offers.md", content: theirs.content + line, message: "Same edit", baseSha: theirs.sha },
    });
    await typeAtEnd(page, line);
    await page.getByRole("button", { name: /Save & sync/ }).click();
    await page.getByRole("dialog", { name: /changed this file while you were editing/ }).getByRole("button", { name: /^Replace .* changes with mine$/ }).click();
    await expect(toast(page, "No changes to save")).toBeVisible();
    await expect(page.locator("[data-sonner-toast][data-type=error]")).toHaveCount(0);
    await page.screenshot({ path: shot("c2-no-change") });
  });

  test("P0 (overlap): Sync now while editing keeps the draft and says who also changed the file", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/ads-team?path=sops/facebook-ads.md");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const notice = page.getByRole("status").filter({ hasText: /made 2 changes since you last synced/ });
    await expect(notice).toBeVisible();
    const editor = page.getByLabel("Content of facebook-ads.md (markdown)");
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await editor.pressSequentially("QA TOP LINE\n");
    await expect(page.getByText("· Unsaved changes")).toBeVisible();
    await page.screenshot({ path: shot("p0-before-sync") });
    await notice.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /also changed this file\. When you save, you'll choose what to keep\./ })).toBeVisible();
    await expect(editor).toHaveValue(/^QA TOP LINE\n/);
    await expect(page.getByText("· Unsaved changes")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /Your edits are still here/ })).toHaveCount(0);
    await noLeaks(page);
    await page.screenshot({ path: shot("p0-after-sync-overlap") });
    await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  });

  test("P0: Apex Roofing's unsaved edits are listed and saved", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing");
    await page.getByRole("button", { name: /^Not on GitHub yet/ }).click();
    const list = page.getByRole("list", { name: "Edited on this computer" });
    await expect(list.getByRole("listitem").first()).toBeVisible();
    await noLeaks(page);
    await page.screenshot({ path: shot("p0-local-changes") });
    await page.getByLabel(/Describe these changes/).fill("Save work in progress");
    await page.getByRole("button", { name: "Save these changes" }).click();
    await expect(toast(page, /Saved \d+ files? (to GitHub|on this computer)/)).toBeVisible();
    const sam = await api("sam-okafor");
    const space = await (await sam.get("spaces/apex-roofing")).json();
    expect(space.sync.changedPaths ?? []).toEqual([]);
  });

  test("P0 (no overlap): a sync while editing keeps the draft and the unsaved state", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing?path=brief.md");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByLabel("Content of brief.md (markdown)");
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await editor.pressSequentially("QA TOP LINE\n");
    // A teammate changes a different file meanwhile.
    const maya = await api("maya-chen");
    const other = await (await maya.get("spaces/apex-roofing/file?path=offers.md")).json();
    await maya.put("spaces/apex-roofing/file", { data: { path: "offers.md", content: other.content + "\nMaya: checked.\n", message: "Check offers", baseSha: other.sha } });
    await page.getByRole("button", { name: /sync status$/ }).click();
    const syncNow = page.getByRole("button", { name: "Sync now" });
    if (await syncNow.count()) await syncNow.click();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveValue(/^QA TOP LINE\n/);
    await expect(page.getByText("· Unsaved changes")).toBeVisible();
    await expect(page.getByText(/also changed this file/)).toHaveCount(0);
    await page.screenshot({ path: shot("p0-after-sync-no-overlap") });
    // Leave without saving.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Discard changes" }).click().catch(() => {});
  });

  test("1: rename is one change, with no false 'isn't in' toast", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/apex-roofing?path=work/README.md");
    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Rename or move" }).click();
    await page.getByLabel("New name").fill("work/how-we-use-this-folder.md");
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(toast(page, "Renamed to how-we-use-this-folder.md")).toBeVisible();
    await expect(page).toHaveURL(/how-we-use-this-folder\.md/);
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /isn't in/ })).toHaveCount(0);
    const sam = await api("sam-okafor");
    const history = await (await sam.get("spaces/apex-roofing/history?limit=3")).json();
    expect(history.filter((h: { message: string }) => /how-we-use-this-folder/.test(h.message)).length).toBe(1);
  });

  test.skip("(d) Sync now on Ads Team from the popover (live seed has one behind state; the P0 test uses it)", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/spaces/ads-team");
    const status = page.getByRole("button", { name: /^2 changes to get/ });
    // GET /api/spaces takes ~1.3s and one run saw it stall past 15s; allow more here.
    await expect(status).toBeVisible({ timeout: 30_000 });
    await status.click();
    await expect(page.getByText("Jordan Reyes made 2 changes on GitHub.")).toBeVisible();
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Got 2 changes from GitHub/ })).toBeVisible();
    await expect(toast(page, "Ads Team is up to date")).toHaveCount(0);
    await page.screenshot({ path: shot("d-synced") });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  });

  test("pull-request outcome: Maya's Northline edit is proposed, with no fake review link", async ({ page }) => {
    await as(page, "maya");
    await page.goto("/spaces/northline?path=sops/creative-review.md");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText(/Opens a review on GitHub/)).toBeVisible();
    await typeAtEnd(page, "\n- Check alt text on every image.\n");
    await page.getByRole("button", { name: /Propose change/ }).click();
    const t = toast(page, "Change proposed in Northline");
    await expect(t).toBeVisible();
    await expect(t).toContainText("Saved for review");
    await expect(t).not.toContainText(/selfhub\/|branch/);
    await expect(t.getByRole("button", { name: "Open review" })).toHaveCount(0);
    await expect(page.getByText(/You proposed a change/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open review" })).toHaveCount(0);
    await page.screenshot({ path: shot("pr-proposed") });
  });

  test("(e1) Add space: create a new client space", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/");
    await page.getByRole("button", { name: "Add space" }).first().click();
    await page.getByRole("button", { name: /Create a new space/ }).click();
    await page.getByLabel("Name").fill("Apex Roofing");
    await page.getByRole("button", { name: "Create space" }).click();
    await expect(page.getByText("A space called Apex Roofing already exists.")).toBeVisible();
    await page.getByLabel("Name").fill("Summit Solar");
    await page.getByRole("radio", { name: /Client/ }).click();
    await page.getByLabel(/Description/).fill("Boulder solar installer.");
    await page.getByRole("button", { name: "Create space" }).click();
    await expect(page.getByRole("heading", { name: "Summit Solar is ready" })).toBeVisible();
    await noLeaks(page);
    await page.screenshot({ path: shot("e1-ready") });
    await page.getByRole("button", { name: "Open Summit Solar" }).click();
    await expect(page).toHaveURL(/\/spaces\/summit-solar/);
    await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
  });

  test("(e2) Add space: connect an existing git repo by path", async ({ page }) => {
    const dir = join(process.env.QA_EXTRA_DIR ?? "/tmp", "ridgeline");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "brief.md"), "# Ridgeline Plumbing: client brief\n\nResidential plumbing in Fort Collins.\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q", "-b", "main");
    git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "add", ".");
    git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "commit", "-q", "-m", "Add brief");

    await as(page, "sam");
    await page.goto("/");
    await page.getByRole("button", { name: "Add space" }).first().click();
    await page.getByRole("button", { name: /Connect an existing GitHub repository/ }).click();
    await expect(page.getByText("Repos you can access")).toHaveCount(0);
    await page.getByLabel("GitHub repository link or folder on this computer").fill("not a repo");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText(/Use a GitHub link .* a git URL, or a folder path/)).toBeVisible();
    await page.getByLabel("GitHub repository link or folder on this computer").fill(dir);
    await page.getByLabel(/Display name/).fill("Ridgeline Plumbing");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    // A plain repo isn't a space yet: the API says so, and the dialog shows it as-is.
    await expect(page.getByRole("alert").filter({ hasText: "This folder isn't a SelfHub space yet." })).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText(/selfhub space create|API is running/);
    await page.screenshot({ path: shot("e2-not-a-space") });

    mkdirSync(join(dir, ".selfhub"), { recursive: true });
    writeFileSync(
      join(dir, ".selfhub", "space.json"),
      JSON.stringify({ name: "Ridgeline Plumbing", kind: "client", aliases: ["ridgeline"], locked: [], always_load: ["brief.md"], owners: ["@sam-okafor"], write_policy: "direct", learn_policy: "propose", policies: [] }, null, 2),
    );
    git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "add", ".");
    git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "commit", "-q", "-m", "Make it a SelfHub space");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ridgeline Plumbing is ready" })).toBeVisible();
    await page.getByRole("button", { name: "Open Ridgeline Plumbing" }).click();
    await expect(page).toHaveURL(/\/spaces\/ridgeline-plumbing/);
    await expect(page.getByRole("heading", { name: "Ridgeline Plumbing: client brief" })).toBeVisible();
  });

  test("(f) Maya changes Leo's role, sees team grants as read-only, and invites someone", async ({ page }) => {
    await as(page, "maya");
    await page.goto("/people");
    await page.getByRole("button", { name: /^Leo Park/ }).click();
    const drawer = page.getByRole("dialog", { name: "Leo Park" });
    await drawer.getByRole("combobox", { name: "Leo Park's access to Ads Team" }).click();
    await page.getByRole("option", { name: /^Can edit/ }).click();
    await expect(toast(page, "Leo can now edit Ads Team")).toBeVisible();
    await noLeaks(page);
    await page.screenshot({ path: shot("f-role-changed") });
    await page.keyboard.press("Escape");

    // Sam's Ads Team access comes from the Ads team: no control, an explanation instead.
    await page.getByRole("button", { name: /^Sam Okafor/ }).click();
    const samDrawer = page.getByRole("dialog", { name: "Sam Okafor" });
    await expect(samDrawer.getByText("Via the Ads team. Change it on the team in GitHub.").first()).toBeVisible();
    await expect(samDrawer.getByRole("combobox", { name: "Sam Okafor's access to Ads Team" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/spaces/apex-roofing/members");
    const list = page.getByRole("list", { name: "Members of Apex Roofing" });
    await expect(list.getByText("via the Ads team").first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Role for Sam Okafor" })).toHaveCount(0);
    await page.getByLabel("Invite by GitHub username").fill("leo-park");
    await page.getByRole("combobox", { name: "Role for the new member" }).click();
    await page.getByRole("option", { name: /^Can view/ }).click();
    await page.getByRole("button", { name: "Invite" }).click();
    await expect(toast(page, "Added Leo Park to Apex Roofing as Can view")).toBeVisible();
    await expect(list.getByText("Leo Park")).toBeVisible();
    await page.screenshot({ path: shot("f-invited") });
  });

  test("(g) the demo switch refetches; Maya approves a pending rule", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/rules");
    const apex = page.locator("article").filter({ hasText: "Never use urgency phrasing" });
    await expect(apex.getByText("Only approvers of Apex Roofing can decide: Jordan Reyes, Priya Nair")).toBeVisible();
    await expect(apex.getByText(/Proposed by Sam (today|yesterday|\d+ days ago|[A-Z][a-z]{2} \d+)/)).toBeVisible();
    await noLeaks(page);

    // Switch to Maya from the user menu: everything refetches with her access, no reload.
    await page.getByRole("button", { name: /^Sam Okafor @sam-okafor/ }).click();
    await page.getByRole("menuitemradio", { name: /Maya/ }).click();
    await expect(page.getByRole("button", { name: /^Maya Chen @maya-chen/ })).toBeVisible();
    // The switch lands on Home; go back with in-app navigation (a full reload would rerun
    // this test's init script, which pins Sam).
    await expect(page.getByRole("link", { name: "Bolt HVAC" }).first()).toBeVisible();
    await page.getByRole("link", { name: /^Rules/ }).first().click();
    const ads = page.locator("article").filter({ hasText: "tracked ca" });
    await expect(ads.getByRole("button", { name: "Approve" })).toBeVisible();
    await page.screenshot({ path: shot("g-pending-maya") });
    await ads.getByRole("button", { name: "Approve" }).click();
    await expect(toast(page, "Rule approved")).toBeVisible();
    await page.getByRole("tab", { name: /Active/ }).click();
    await expect(page.locator("article").filter({ hasText: "tracked ca" }).getByText(/approved by Maya/)).toBeVisible();
    await page.screenshot({ path: shot("g-approved") });
  });

  test("(h) ⌘K search opens a file; Bolt HVAC is never searched for Sam", async ({ page }) => {
    await as(page, "sam");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Sam/ })).toBeVisible();
    await expect(page.getByText(/(needs? you|Nothing needs you) · \d+ spaces?/)).toBeVisible();
    const activity = page.locator("section").filter({ hasText: "Recent activity" });
    await expect(activity.locator("li").first()).toBeVisible();
    await expect(activity).not.toContainText(/sam-okafor|maya-chen|apex-roofing|ads-team/);
    await noLeaks(page);
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder("Search files, spaces and actions…");
    await input.fill("urgency");
    const hit = page.getByRole("option", { name: /Apex Roofing — client brief/ });
    await expect(hit).toBeVisible();
    await page.screenshot({ path: shot("h-search") });
    await hit.click();
    await expect(page).toHaveURL(/\/spaces\/apex-roofing\?path=brief\.md/);
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("furnace");
    await expect(page.getByText(/No results for/)).toBeVisible();
  });
});
