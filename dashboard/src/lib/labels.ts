import type { Access, Role, Space, SpaceKind, SyncState, WritePolicy } from "@/lib/api/types";

export const kindLabel: Record<SpaceKind, string> = {
  org: "Company",
  team: "Team",
  client: "Client",
  personal: "Personal",
};

export const kindGroupLabel: Record<SpaceKind, string> = {
  org: "Company",
  team: "Teams",
  client: "Clients",
  personal: "Personal",
};

export const kindOrder: SpaceKind[] = ["org", "team", "client", "personal"];

export const kindBlurb: Record<SpaceKind, string> = {
  org: "Company-wide SOPs, brand and compliance. Loaded on every task.",
  team: "One team's shared workflows. Loaded for people who connect it.",
  client: "One client's brief, work and rules. Loaded only when a task names the client.",
  personal: "Your own workflows and preferences. Only you can see it.",
};

export const roleLabel: Record<Role | "none", string> = {
  admin: "Admin",
  write: "Can edit",
  read: "Can view",
  none: "No access",
};

/** What each role lets you do (role options, tooltips). No GitHub role names here. */
export const roleHelp: Record<Role | "none", string> = {
  admin: "Can edit files and manage who has access.",
  write: "Can view and edit files.",
  read: "Can open and read files, not change them.",
  none: "Can't open this space.",
};
/** @deprecated kept as an alias while callers move to roleHelp. */
export const roleGithub = roleHelp;

/** "Leo can now edit Ads Team" style phrasing for toasts. */
export const rolePhrase: Record<Role, string> = {
  admin: "is now an admin of",
  write: "can now edit",
  read: "can now view",
};

/** Your access to a space, in the same terms used everywhere: Admin / Can edit / Can view. */
export const accessSentence: Record<Access, string> = {
  admin: "Admin",
  write: "Can edit",
  read: "Can view",
  none: "No access",
};

export const policyLabel: Record<WritePolicy, string> = {
  direct: "Saves go straight to GitHub",
  "pull-request": "Changes go through review",
  "read-only": "Nobody can save here",
};

export interface SyncInfo {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  detail: string;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Status in plain words. The API's `sync.message` is written in git terms ("2 new commits on
 * the remote"), so known states use our own copy; only errors show the API's text.
 */
export function syncInfo(space: Pick<Space, "sync" | "repo">, ago: string): SyncInfo {
  const { state, ahead, behind, message } = space.sync;
  const conflict = space.sync.conflict;
  const by = space.sync.incomingBy?.length ? new Intl.ListFormat("en", { type: "conjunction" }).format(space.sync.incomingBy) : null;
  switch (state) {
    case "synced":
      return { label: "Synced", tone: "success", detail: `Updated ${ago}` };
    case "behind":
      return {
        label: `${plural(behind || 1, "change")} to get`,
        tone: "warning",
        detail: by ? `${by} made ${plural(behind || 1, "change")} on GitHub.` : `${plural(behind || 1, "new change")} on GitHub.`,
      };
    case "ahead":
      return {
        label: "Not on GitHub yet",
        tone: "warning",
        detail: /never/i.test(message ?? "")
          ? "This space hasn't been sent to GitHub yet."
          : `${plural(ahead || 1, "saved change")} ${ahead === 1 ? "hasn't" : "haven't"} reached GitHub yet.`,
      };
    case "local-changes":
      return {
        label: "Not on GitHub yet",
        tone: "warning",
        detail: space.sync.changedPaths?.length
          ? `${plural(space.sync.changedPaths.length, "file")} changed on this computer and not on GitHub yet.`
          : "Files changed on this computer aren't on GitHub yet.",
      };
    case "diverged":
      return {
        label: "Conflict needs attention",
        tone: "danger",
        detail: conflict
          ? `You and ${conflict.byName ?? "someone else"} both changed ${conflict.path}.`
          : (message ?? "Your changes and changes on GitHub overlap."),
      };
    case "no-remote":
      return { label: "Not connected to GitHub", tone: "neutral", detail: "Only on this computer. Connect it to GitHub to share it." };
    case "error":
      return { label: "Sync failed", tone: "danger", detail: message ?? "GitHub didn't respond." };
  }
}

export function needsSync(state: SyncState) {
  return state !== "synced" && state !== "no-remote";
}
