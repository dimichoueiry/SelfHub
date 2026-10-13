// Types mirror the SelfHub API contract (docs/dashboard-design-brief.md, "Data").

export type SpaceKind = "org" | "team" | "client" | "personal";
export type WritePolicy = "direct" | "pull-request" | "read-only";
export type SyncState =
  | "synced"
  | "ahead"
  | "behind"
  | "diverged"
  | "local-changes"
  | "no-remote"
  | "error";
export type Access = "admin" | "write" | "read" | "none";
export type Role = "admin" | "write" | "read";

export interface Me {
  login: string;
  name: string;
  avatarUrl: string;
  title?: string | null;
  mode: "demo" | "local" | "hosted" | string;
  org: { name: string; avatarUrl: string };
}

export interface SpaceSync {
  state: SyncState;
  ahead: number;
  behind: number;
  lastSyncAt: string | null;
  message: string | null;
  /** Files edited on this computer and not saved yet. */
  changedPaths?: string[];
  /** The same files, with what happened to each. */
  changes?: { path: string; status: "added" | "modified" | "deleted" }[];
  /** Display names of people whose updates are on GitHub but not here yet, newest first. */
  incomingBy?: string[];
  /** A file edited here that someone else also changed on GitHub. */
  conflict?: { path: string; byName?: string | null; byLogin?: string | null } | null;
}

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
  description: string;
  repo: { owner: string; name: string; url: string } | null;
  writePolicy: WritePolicy;
  defaultBranch: string;
  sync: SpaceSync;
  myAccess: Access;
  owners: string[];
  lockedPaths: string[];
  fileCount: number;
  memberCount: number;
  updatedAt: string;
}

export type CreateSpaceInput =
  | { action: "connect"; source: string; name?: string }
  | {
      action: "create";
      name: string;
      kind: SpaceKind;
      description?: string;
      owners?: string[];
      writePolicy?: WritePolicy;
    };

/** GET /spaces/{id}/github: can this computer put the space on GitHub? */
export interface GitHubCheck {
  ready: boolean;
  /** Why not: the GitHub CLI (gh) isn't installed, or it isn't logged in. */
  problem: "gh-missing" | "logged-out" | null;
  login: string | null;
  /** Your GitHub account first, then the organizations you belong to. */
  owners: { login: string; kind: "user" | "org" }[];
  defaultOwner: string | null;
  suggestedName: string;
  /** Absolute path of the space's folder on this computer. */
  path: string;
}

export type RepoVisibility = "private" | "public";

export interface ConnectGitHubResult {
  space: Space;
  repo: { owner: string; name: string; url: string };
}

export type SyncResultKind = "up-to-date" | "pulled" | "pushed" | "conflict" | "error" | "local-changes" | "saved" | "pull-request";

export interface SyncResult {
  space: Space;
  result: SyncResultKind;
  message: string;
  pulled: number;
  pushed: number;
  pulledBy?: string[];
}

/** POST /save-local: a SyncResult plus what was saved and where it went. */
export interface SaveLocalResult extends SyncResult {
  saved: string[];
  outcome: "committed" | "pull-request";
  commit?: CommitRef | null;
  branch?: string | null;
  prUrl?: string | null;
}

export interface TreeEntry {
  path: string;
  name: string;
  type: "file" | "dir";
  locked: boolean;
  editable: boolean;
  reason?: string;
  size?: number;
  updatedAt?: string;
  updatedBy?: string;
  /** Dot-folders (.selfhub/, .github/): hidden by default. */
  system?: boolean;
}

export interface Author {
  login: string;
  name: string;
  avatarUrl: string;
}

export interface CommitRef {
  sha: string;
  author: Author;
  date: string;
  /** Display text (no git noise, no rule ids). */
  message: string;
  rawMessage?: string;
  ruleId?: string;
}

export interface FileDoc {
  path: string;
  content: string;
  locked: boolean;
  editable: boolean;
  reason?: string;
  sha: string;
  /** null for a file that was never committed. */
  lastCommit: CommitRef | null;
  /** (extra) Non-UTF-8 file: content is "" and it isn't editable. */
  binary?: boolean;
  format?: "markdown" | "csv" | "json" | "text" | "binary";
}

export interface SaveFileInput {
  path: string;
  content: string;
  message: string;
  baseSha: string;
}

export interface SaveFileResult {
  outcome: "committed" | "pull-request";
  commit: CommitRef;
  /** null in the demo: no PR is really opened. */
  prUrl?: string | null;
  /** (extra) Branch the commit landed on. */
  branch?: string;
  /** (extra) Human note: PR status, push failures. */
  message?: string;
  file?: FileDoc;
  /** Updates fetched from GitHub before saving, and who made them. */
  pulled?: number;
  pulledBy?: string[];
  /** The space after the save. */
  space?: Space;
}

export interface HistoryEntry {
  sha: string;
  author: Author;
  date: string;
  message: string;
  additions: number;
  deletions: number;
  /** Not in the contract's minimum shape; the mock includes it for space-level history. */
  path?: string;
}

export interface Diff {
  sha: string;
  patch: string;
}

export interface SearchHit {
  spaceId: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface Member {
  login: string;
  name: string;
  avatarUrl: string;
  role: Role;
  via: "direct" | "team";
  team?: string | null;
  isOwner: boolean;
  /** Invited and hasn't accepted yet (demo). */
  pending?: boolean;
}

export interface Person {
  login: string;
  name: string;
  avatarUrl: string;
  title?: string | null;
}

export interface PeopleMatrix {
  people: Person[];
  spaces: Space[];
  access: Record<string, Record<string, Role | "none">>;
}

export type RuleStatus = "pending" | "active" | "rejected";

export interface Rule {
  id: string;
  spaceId: string;
  text: string;
  why: string;
  source: string;
  proposedBy: string;
  /** ISO date-only in the API ("2026-10-11"); full timestamps are also accepted. */
  proposedAt: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  title?: string | null;
  status: RuleStatus;
  prUrl?: string | null;
  /** (extra) Where an approval went in pull-request spaces. */
  message?: string | null;
  rejectReason?: string | null;
}

export interface Activity {
  id: string;
  /** API: edit | sync | rule | access | space. The mock uses a few finer-grained values. */
  type: string;
  actor: string;
  spaceId: string;
  path?: string | null;
  /** A full sentence in the API ("Maya Chen gave…"); a predicate in the mock ("gave…"). */
  summary: string;
  date: string;
  sha?: string;
  ruleId?: string;
}

/** A repo the signed-in user can see on GitHub. Not part of the contract (see brief). */
export interface ConnectableRepo {
  fullName: string;
  url: string;
  description: string;
  private: boolean;
  updatedAt: string;
  connected: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; hint?: string | null; details?: Record<string, unknown> };
}
