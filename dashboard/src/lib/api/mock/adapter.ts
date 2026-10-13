// In-browser mock of the SelfHub API. Holds Northline's spaces, files, history, members and
// rules in memory, and behaves like the real API: latency, writes, 403s and 409 conflicts.

import type { SelfHubApi } from "../client";
import { ApiError } from "../errors";
import type {
  Access,
  Activity,
  CommitRef,
  FileDoc,
  HistoryEntry,
  Member,
  Role,
  Rule,
  SaveFileResult,
  SearchHit,
  Space,
  SpaceKind,
  SyncResult,
  TreeEntry,
} from "../types";
import { getDemoUser } from "@/lib/demo-user";
import { countChanges, diffLines, unifiedPatch } from "@/lib/diff";
import { files as seedFiles } from "./content";
import {
  ago,
  connectableRepos,
  days,
  fileOrigins,
  fileRevisions,
  hours,
  minutes,
  people as seedPeople,
  remoteChanges,
  seedRules,
  seedSpaces,
  type SeedSpace,
} from "./seed";

interface Commit {
  sha: string;
  author: string;
  date: string;
  message: string;
  path: string;
  before: string;
  after: string;
}

interface State {
  spaces: SeedSpace[];
  files: Record<string, Record<string, string>>;
  commits: Record<string, Commit[]>;
  rules: Rule[];
  activity: Activity[];
  people: typeof seedPeople;
  pending: Record<string, typeof remoteChanges[string]>;
  lastSync: Record<string, string | null>;
  updatedAt: Record<string, string>;
  /** Files where a teammate will have saved a newer version the next time you save. */
  conflictOnce: Set<string>;
  prCounter: number;
}

/** Demo control: the next save anywhere returns a conflict. */
let forceConflict = false;
export function simulateConflictOnNextSave() {
  forceConflict = true;
}

let shaCounter = 0x3a91c;
function nextSha() {
  shaCounter += 0x1f3d7;
  const hex = (shaCounter * 2654435761).toString(16).replace("-", "");
  return (hex + "a7c3e19b05d2f4860b").slice(0, 40);
}

function buildState(): State {
  const commits: Record<string, Commit[]> = {};
  const updatedAt: Record<string, string> = {};
  for (const space of seedSpaces) {
    const list: Commit[] = [];
    const spaceFiles = seedFiles[space.id] ?? {};
    for (const [path, content] of Object.entries(spaceFiles)) {
      const revisions = fileRevisions[space.id]?.[path] ?? [];
      // Walk back from the current text to the first version.
      const versions = [content];
      for (let i = revisions.length - 1; i >= 0; i--) {
        versions.unshift(versions[0].replace(revisions[i].to, revisions[i].from));
      }
      const origin = fileOrigins[space.id]?.[path] ?? { author: space.owners[0], daysAgo: 90 };
      list.push({
        sha: nextSha(),
        author: origin.author,
        date: ago(days(origin.daysAgo)),
        message: `Add ${path.split("/").pop()}`,
        path,
        before: "",
        after: versions[0],
      });
      revisions.forEach((rev, i) => {
        list.push({
          sha: nextSha(),
          author: rev.author,
          date: ago(rev.ago),
          message: rev.message,
          path,
          before: versions[i],
          after: versions[i + 1],
        });
      });
    }
    list.sort((a, b) => b.date.localeCompare(a.date));
    commits[space.id] = list;
    updatedAt[space.id] = list[0]?.date ?? ago(days(30));
  }

  const lastSync: Record<string, string | null> = {};
  for (const s of seedSpaces) {
    lastSync[s.id] = s.sync.lastSyncMinutesAgo === null ? null : ago(minutes(s.sync.lastSyncMinutesAgo));
  }

  const activity: Activity[] = [
    { id: "a1", type: "rule-proposed", actor: "jordan", spaceId: "apex", path: "work/2026-10-12-spring-promo.md", summary: "proposed a rule: never use urgency phrasing", date: ago(hours(2)) },
    { id: "a2", type: "edit", actor: "sam", spaceId: "apex", path: "work/2026-10-12-spring-promo.md", summary: "rewrote variant B without urgency", date: ago(hours(3)) },
    { id: "a3", type: "edit", actor: "jordan", spaceId: "ads-team", path: "sops/google-ads.md", summary: "added a Performance Max note", date: ago(minutes(95)) },
    { id: "a4", type: "edit", actor: "sam", spaceId: "personal-sam", path: "sops/ads.md", summary: "added hooks that have worked", date: ago(hours(5)) },
    { id: "a5", type: "rule-proposed", actor: "priya", spaceId: "ads-team", path: "sops/facebook-ads.md", summary: "proposed a rule: license number in the first two lines", date: ago(hours(20)) },
    { id: "a6", type: "edit", actor: "jordan", spaceId: "apex", path: "brief.md", summary: "noted that Apex dislikes urgency language", date: ago(hours(26)) },
    { id: "a7", type: "edit", actor: "priya", spaceId: "content", path: "content-calendar.md", summary: "moved the Bolt post to Oct 19", date: ago(hours(27)) },
    { id: "a8", type: "rule-proposed", actor: "priya", spaceId: "northline", path: "sops/ad-review.md", summary: "proposed a rule: never name a competitor", date: ago(days(2)) },
    { id: "a9", type: "member", actor: "maya", spaceId: "northline", summary: "gave Leo view access", date: ago(days(4)) },
    { id: "a10", type: "edit", actor: "priya", spaceId: "bolt", path: "brief.md", summary: "updated the furnace tune-up offer", date: ago(days(5)) },
  ];

  const now = Date.now();
  return {
    spaces: structuredClone(seedSpaces),
    files: structuredClone(seedFiles),
    commits,
    rules: seedRules.map((r) => ({
      id: r.id,
      spaceId: r.spaceId,
      text: r.text,
      why: r.why,
      source: r.source,
      proposedBy: r.proposedBy,
      proposedAt: new Date(now - r.proposedAgo).toISOString(),
      approvedBy: r.approvedBy,
      status: r.status,
      prUrl: r.prUrl,
    })),
    activity,
    people: structuredClone(seedPeople),
    pending: structuredClone(remoteChanges),
    lastSync,
    updatedAt,
    conflictOnce: new Set(["apex:work/2026-10-12-spring-promo.md"]),
    prCounter: 42,
  };
}

const ONLY_HERE = "This space is only on this computer. It isn't connected to GitHub.";

/** Sample mode stand-in for gh: set localStorage "selfhub.mock.gh" to "gh-missing" or "logged-out". */
function mockGhProblem(): "gh-missing" | "logged-out" | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem("selfhub.mock.gh");
  return v === "gh-missing" || v === "logged-out" ? v : null;
}

const wait = (min: number, max: number) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const read = () => wait(180, 480);
const write = () => wait(550, 950);

export function createMockAdapter(): SelfHubApi {
  const state = buildState();

  const me = (): string => getDemoUser();
  const person = (login: string) =>
    state.people.find((p) => p.login === login) ?? { login, name: login, avatarUrl: "", title: undefined };

  function accessOf(space: SeedSpace, login = me()): Access {
    return space.acl[login]?.role ?? "none";
  }

  function visible(space: SeedSpace, login = me()) {
    if (space.personalOf) return space.personalOf === login;
    return space.listed || accessOf(space, login) !== "none";
  }

  function findSpace(id: string) {
    const space = state.spaces.find((s) => s.id === id);
    if (!space || !visible(space)) {
      throw new ApiError(404, "not-found", "This space doesn't exist, or it was removed.");
    }
    return space;
  }

  function requireAccess(space: SeedSpace, need: "read" | "write" | "admin") {
    const access = accessOf(space);
    const rank = { none: 0, read: 1, write: 2, admin: 3 } as const;
    if (rank[access] < rank[need]) {
      if (access === "none") {
        throw new ApiError(403, "no-access", `You don't have access to ${space.name}.`, `Ask an admin (${space.owners.map((o) => "@" + o).join(", ")}) to add you.`);
      }
      if (need === "admin") {
        throw new ApiError(403, "not-admin", `Only admins of ${space.name} can do that.`, "Ask Maya or a space admin.");
      }
      throw new ApiError(403, "read-only", `You can view ${space.name} but not change it.`, `Ask ${space.owners.map((o) => "@" + o).join(", ")} for edit access.`);
    }
  }

  function toSpace(s: SeedSpace): Space {
    const filesHere = state.files[s.id] ?? {};
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      repo: s.repo ? { ...s.repo, url: `https://github.com/${s.repo.owner}/${s.repo.name}` } : null,
      writePolicy: s.writePolicy,
      defaultBranch: "main",
      sync: {
        state: s.sync.state,
        ahead: s.sync.ahead,
        behind: s.sync.behind,
        lastSyncAt: state.lastSync[s.id] ?? null,
        message: s.sync.message,
        changedPaths: s.sync.state === "local-changes" ? [...(s.sync.changedPaths ?? [])] : [],
        conflict:
          s.sync.state === "diverged" && s.sync.conflict
            ? { path: s.sync.conflict.path, byLogin: s.sync.conflict.byLogin, byName: person(s.sync.conflict.byLogin).name }
            : null,
        changes: s.sync.state === "local-changes" ? (s.sync.changedPaths ?? []).map((path) => ({ path, status: "modified" as const })) : [],
        incomingBy: s.sync.state === "behind" && s.sync.behindBy ? [person(s.sync.behindBy).name] : [],
      },
      myAccess: accessOf(s),
      owners: [...s.owners],
      lockedPaths: [...s.lockedPaths],
      fileCount: Object.keys(filesHere).length,
      memberCount: Object.keys(s.acl).length,
      updatedAt: state.updatedAt[s.id],
    };
  }

  function isLocked(s: SeedSpace, path: string) {
    return s.lockedPaths.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"));
  }

  function editability(s: SeedSpace, path: string): { editable: boolean; reason?: string } {
    const access = accessOf(s);
    if (access === "none") return { editable: false, reason: `You don't have access to ${s.name}.` };
    if (s.writePolicy === "read-only") return { editable: false, reason: "This space is read-only." };
    if (access === "read") return { editable: false, reason: "You can view this space." };
    if (isLocked(s, path)) {
      const names = s.owners.map((o) => person(o).name);
      const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
      return { editable: false, reason: `Locked. Only ${who} can change this file, through review.` };
    }
    return { editable: true };
  }

  function lastCommitFor(spaceId: string, path: string): Commit | undefined {
    return state.commits[spaceId].find((c) => c.path === path);
  }

  function commitRef(c: Commit): CommitRef {
    const p = person(c.author);
    return { sha: c.sha, author: { login: p.login, name: p.name, avatarUrl: p.avatarUrl }, date: c.date, message: c.message };
  }

  function fileDoc(s: SeedSpace, path: string): FileDoc {
    const content = state.files[s.id]?.[path];
    if (content === undefined) throw new ApiError(404, "not-found", `${path} doesn't exist in ${s.name}.`, "It may have been renamed or deleted. Pick another file.");
    const c = lastCommitFor(s.id, path)!;
    return { path, content, locked: isLocked(s, path), ...editability(s, path), sha: c.sha, lastCommit: commitRef(c), format: formatOf(path) };
  }

  function commit(s: SeedSpace, path: string, before: string, after: string, message: string, author = me()): Commit {
    const c: Commit = { sha: nextSha(), author, date: new Date().toISOString(), message, path, before, after };
    state.commits[s.id].unshift(c);
    state.updatedAt[s.id] = c.date;
    return c;
  }

  function log(type: Activity["type"], spaceId: string, summary: string, path?: string) {
    state.activity.unshift({ id: `a${Date.now()}${Math.random()}`, type, actor: me(), spaceId, path, summary, date: new Date().toISOString() });
  }

  function markPushed(s: SeedSpace) {
    if (!s.repo) return;
    if (s.sync.state === "synced" || s.sync.state === "local-changes" || s.sync.state === "ahead") {
      s.sync = { ...s.sync, state: "synced", ahead: 0, message: null };
      state.lastSync[s.id] = new Date().toISOString();
    }
  }

  function validPath(path: string) {
    const clean = path.trim().replace(/^\/+/, "");
    if (!clean || clean.endsWith("/") || clean.split("/").some((p) => p === "" || p === "." || p === "..")) {
      throw new ApiError(400, "invalid-path", "That file name isn't valid.", "Use a name like notes/kickoff.md.");
    }
    return clean;
  }

  function rulesVisible() {
    return state.rules.filter((r) => {
      const s = state.spaces.find((x) => x.id === r.spaceId);
      return s && visible(s) && accessOf(s) !== "none";
    });
  }

  function canApprove(rule: Rule) {
    const s = state.spaces.find((x) => x.id === rule.spaceId)!;
    return s.owners.includes(me()) || accessOf(s) === "admin";
  }

  function toMember(s: SeedSpace, login: string): Member {
    const p = person(login);
    const entry = s.acl[login];
    return {
      login,
      name: p.name,
      avatarUrl: p.avatarUrl,
      role: entry.role,
      via: entry.via,
      team: entry.team,
      isOwner: s.owners.includes(login),
      pending: invited.has(`${s.id}:${login}`),
    };
  }

  /** People invited who haven't accepted yet (demo: everyone added who wasn't already in the org). */
  const invited = new Set<string>();

  /** Get what's waiting on GitHub (state behind). Saves do this first, like the real API. */
  function pullPending(s: SeedSpace) {
    if (s.sync.state !== "behind") return { pulled: 0, pulledBy: [] as string[] };
    const incoming = state.pending[s.id] ?? [];
    for (const change of incoming) {
      const before = state.files[s.id][change.path] ?? "";
      const after = before + change.append;
      state.files[s.id][change.path] = after;
      commit(s, change.path, before, after, change.message, change.author);
    }
    state.pending[s.id] = [];
    const pulled = incoming.length || s.sync.behind;
    const pulledBy = [...new Set(incoming.map((c) => person(c.author).name))];
    s.sync = { ...s.sync, state: "synced", behind: 0, message: null, behindBy: null };
    state.lastSync[s.id] = new Date().toISOString();
    return { pulled, pulledBy };
  }

  /** Text the demo pretends was typed on this computer and never saved. */
  const localEdits: Record<string, string> = {
    "personal-sam:notes/2026-10-11.md": "- Follow up with Dana about the hail photos.\n",
    "personal-sam:sops/ads.md": "\n6. Note which hook won in the client's work folder.\n",
  };

  const formatOf = (path: string): FileDoc["format"] =>
    /\.(md|markdown)$/i.test(path) ? "markdown" : /\.csv$/i.test(path) ? "csv" : /\.json$/i.test(path) ? "json" : "text";

  function memberList(s: SeedSpace): Member[] {
    const rank = { admin: 0, write: 1, read: 2 };
    return Object.keys(s.acl)
      .map((login) => toMember(s, login))
      .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  }

  const clone = <T,>(v: T): T => structuredClone(v);

  return {
    kind: "mock",

    async me() {
      await read();
      const p = person(me());
      return { login: p.login, name: p.name, avatarUrl: p.avatarUrl, mode: "demo", org: { name: "Northline", avatarUrl: "" } };
    },

    async spaces() {
      await read();
      return state.spaces.filter((s) => visible(s)).map(toSpace);
    },

    async createSpace(input) {
      await wait(1400, 2000);
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (input.action === "connect") {
        const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(input.source.trim()) ??
          /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(input.source.trim());
        if (!m) throw new ApiError(400, "invalid-source", "That doesn't look like a GitHub repo.", "Paste a link like github.com/northline/client-apex.");
        const fullName = `${m[1]}/${m[2]}`;
        const existing = state.spaces.find((s) => s.repo && `${s.repo.owner}/${s.repo.name}` === fullName);
        if (existing) throw new ApiError(409, "already-connected", `${fullName} is already connected as ${existing.name}.`, "Open it from the sidebar.");
        const known = connectableRepos.find((r) => r.fullName === fullName);
        if (!known) throw new ApiError(404, "repo-not-found", `Couldn't find ${fullName}, or your GitHub account can't see it.`, "Check the name, or ask an admin to give you access on GitHub.");
        const name = input.name?.trim() || known.description.split(":")[0];
        const id = slug(m[2].replace(/^client-/, "")) || `space-${Date.now()}`;
        const space: SeedSpace = {
          id: state.spaces.some((s) => s.id === id) ? `${id}-${Date.now() % 1000}` : id,
          name,
          kind: m[2].startsWith("client-") ? "client" : "team",
          description: known.description,
          repo: { owner: m[1], name: m[2] },
          writePolicy: "direct",
          owners: [me()],
          lockedPaths: [],
          listed: true,
          sync: { state: "synced", ahead: 0, behind: 0, lastSyncMinutesAgo: 0, message: null },
          acl: { [me()]: { role: "admin", via: "direct" }, ...(me() !== "maya" ? { maya: { role: "admin" as const, via: "direct" as const } } : {}) },
        };
        state.spaces.push(space);
        state.files[space.id] = {
          "brief.md": `# ${name}: client brief\n\n${known.description}.\n\n## Services\n\n- \n\n## Tone\n\n`,
          "rules/learned.md": `# Learned rules: ${name}\n\nNo rules yet.\n`,
        };
        state.commits[space.id] = [];
        for (const [p, c] of Object.entries(state.files[space.id])) commit(space, p, "", c, `Add ${p}`, space.owners[0]);
        state.lastSync[space.id] = new Date().toISOString();
        log("space", space.id, `connected ${fullName}`);
        return toSpace(space);
      }

      const name = input.name.trim();
      if (!name) throw new ApiError(400, "invalid-name", "Give the space a name.");
      if (state.spaces.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        throw new ApiError(409, "name-taken", `A space called ${name} already exists.`, "Pick a different name, or open the existing space.");
      }
      const id = slug(name) || `space-${Date.now()}`;
      const kind: SpaceKind = input.kind;
      const templates: Record<SpaceKind, Record<string, string>> = {
        client: {
          "brief.md": `# ${name}: client brief\n\n${input.description ?? ""}\n\n## Services\n\n- \n\n## License and proof\n\n- \n\n## Current offer\n\nNone yet.\n\n## Tone\n\n`,
          "work/README.md": `# Work\n\nDrafts and finished deliverables for ${name}.\n`,
          "rules/learned.md": `# Learned rules: ${name}\n\nNo rules yet. Rules approved from review feedback land here.\n`,
        },
        team: {
          "README.md": `# ${name}\n\n${input.description ?? ""}\n`,
          "sops/README.md": `# SOPs\n\nHow ${name} does recurring work.\n`,
          "rules/learned.md": `# Learned rules: ${name}\n\nNo rules yet.\n`,
        },
        org: {
          "README.md": `# ${name}\n\n${input.description ?? ""}\n`,
          "locked/compliance.md": `# Compliance rules\n\nAdd rules every deliverable must follow.\n`,
          "rules/learned.md": `# Learned rules: ${name}\n\nNo rules yet.\n`,
        },
        personal: {
          "preferences.md": `# Preferences\n\n- \n`,
          "sops/README.md": `# My SOPs\n\n`,
        },
      };
      const owners = (input.owners ?? []).map((o) => o.replace(/^@/, "")).filter(Boolean);
      const space: SeedSpace = {
        id: state.spaces.some((s) => s.id === id) ? `${id}-${Date.now() % 1000}` : id,
        name,
        kind,
        description: input.description?.trim() || "",
        repo: null,
        writePolicy: input.writePolicy ?? (kind === "org" ? "pull-request" : "direct"),
        owners: owners.length ? owners : [me()],
        lockedPaths: kind === "org" ? ["locked/"] : [],
        listed: kind !== "personal",
        personalOf: kind === "personal" ? me() : undefined,
        // Like the real API: a new space starts on this computer, not on GitHub.
        sync: { state: "no-remote", ahead: 0, behind: 0, lastSyncMinutesAgo: null, message: ONLY_HERE },
        acl: { [me()]: { role: "admin", via: "direct" } },
      };
      for (const o of space.owners) if (!space.acl[o]) space.acl[o] = { role: "admin", via: "direct" };
      state.spaces.push(space);
      state.files[space.id] = templates[kind];
      state.commits[space.id] = [];
      for (const [p, c] of Object.entries(templates[kind])) commit(space, p, "", c, `Add ${p}`);
      log("space", space.id, `created ${name}`);
      return toSpace(space);
    },

    async githubCheck(id) {
      await wait(500, 900);
      const s = findSpace(id);
      requireAccess(s, "admin");
      if (s.repo) throw new ApiError(409, "already-connected", `${s.name} is already connected to GitHub.`, "Use Sync now to send your latest changes.");
      const problem = mockGhProblem();
      return {
        ready: !problem,
        problem,
        login: problem ? null : me(),
        owners: problem ? [] : [{ login: me(), kind: "user" as const }, { login: "northline", kind: "org" as const }],
        defaultOwner: problem ? null : "northline",
        suggestedName: s.kind === "client" ? `client-${s.id}` : s.id,
        path: `/Users/${me()}/SelfHub/spaces/${s.id}`,
      };
    },

    async connectGitHub(id, { owner, name, visibility }) {
      await wait(1800, 2600);
      const s = findSpace(id);
      requireAccess(s, "admin");
      if (s.repo) throw new ApiError(409, "already-connected", `${s.name} is already connected to GitHub.`, "Use Sync now to send your latest changes.");
      const problem = mockGhProblem();
      if (problem === "gh-missing") throw new ApiError(503, "gh-missing", "The GitHub CLI (gh) isn't installed on this computer.", "Install it, log in, then choose Check again.", { problem });
      if (problem) throw new ApiError(401, "logged-out", "You're not logged in to GitHub on this computer.", "Log in with the GitHub CLI (gh), then choose Check again.", { problem });
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === "..") {
        throw new ApiError(400, "invalid-name", "Repository names can only use letters, numbers, hyphens (-), underscores (_) and dots.");
      }
      if (visibility !== "private" && visibility !== "public") throw new ApiError(400, "invalid-visibility", "Choose Private or Public.");
      const taken = new Set([
        ...state.spaces.filter((x) => x.repo).map((x) => `${x.repo!.owner}/${x.repo!.name}`),
        ...connectableRepos.map((r) => r.fullName),
      ]);
      if (taken.has(`${owner}/${name}`)) {
        const other = [2, 3, 4, 5, 6].map((n) => `${name}-${n}`).find((n) => !taken.has(`${owner}/${n}`));
        throw new ApiError(409, "name-taken", `${owner} already has a repository called ${name} on GitHub.`, other ? `Try ${other}, or pick another name.` : "Pick another name.", other ? { suggestion: other } : undefined);
      }
      s.repo = { owner, name };
      s.sync = { ...s.sync, state: "synced", ahead: 0, behind: 0, message: null };
      state.lastSync[s.id] = new Date().toISOString();
      log("space", s.id, `connected ${s.name} to GitHub as ${owner}/${name}`);
      return { space: toSpace(s), repo: { owner, name, url: `https://github.com/${owner}/${name}` } };
    },

    async deleteSpace(id) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "admin");
      state.spaces = state.spaces.filter((x) => x.id !== id);
    },

    async syncSpace(id) {
      await wait(1100, 1700);
      const s = findSpace(id);
      requireAccess(s, "read");
      const result = (r: SyncResult["result"], message: string, pulled = 0, pushed = 0): SyncResult => ({
        space: toSpace(s),
        result: r,
        message,
        pulled,
        pushed,
      });
      switch (s.sync.state) {
        case "no-remote":
          return result("error", "This space isn't connected to GitHub, so there's nothing to sync with.");
        case "diverged":
          return result("conflict", s.sync.message ?? "Your changes and GitHub's changes touch the same lines.");
        case "error":
          return result("error", s.sync.message ?? "GitHub didn't respond.");
        case "behind": {
          const { pulled, pulledBy } = pullPending(s);
          return { ...result("pulled", `Got ${pulled} update${pulled === 1 ? "" : "s"}.`, pulled, 0), pulledBy };
        }
        case "local-changes":
          // Like the real API: sync can't send edits that were never saved, and says so.
          state.lastSync[s.id] = new Date().toISOString();
          return result("local-changes", "Edits on this computer aren't saved yet.");
        case "ahead": {
          const n = Math.max(1, s.sync.ahead);
          s.sync = { ...s.sync, state: "synced", ahead: 0, message: null };
          state.lastSync[s.id] = new Date().toISOString();
          return result("pushed", `Sent ${n} change${n === 1 ? "" : "s"} to GitHub.`, 0, n);
        }
        default:
          state.lastSync[s.id] = new Date().toISOString();
          return result("up-to-date", "Already up to date.");
      }
    },

    async tree(id) {
      await read();
      const s = findSpace(id);
      requireAccess(s, "read");
      const entries: TreeEntry[] = [];
      const dirs = new Set<string>();
      for (const path of Object.keys(state.files[s.id] ?? {})) {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
        const c = lastCommitFor(s.id, path);
        entries.push({
          path,
          name: parts[parts.length - 1],
          type: "file",
          locked: isLocked(s, path),
          ...editability(s, path),
          size: new Blob([state.files[s.id][path]]).size,
          updatedAt: c?.date,
          updatedBy: c?.author,
          system: parts.some((seg) => seg.startsWith(".")) || undefined,
        });
      }
      for (const dir of dirs) {
        entries.push({ path: dir, name: dir.split("/").pop()!, type: "dir", locked: isLocked(s, dir + "/"), ...editability(s, dir + "/x") });
      }
      return entries.sort((a, b) => a.path.localeCompare(b.path));
    },

    async file(id, path) {
      await read();
      const s = findSpace(id);
      requireAccess(s, "read");
      return fileDoc(s, path);
    },

    async saveFile(id, input) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "read");
      const doc = fileDoc(s, input.path);
      if (!doc.editable) {
        const code = doc.locked ? "locked" : s.writePolicy === "read-only" ? "read-only" : "read-only";
        throw new ApiError(403, code, doc.reason ?? "You can't change this file.", doc.locked ? "Suggest the change to an owner instead." : undefined);
      }
      const { pulled, pulledBy } = pullPending(s);
      const key = `${s.id}:${input.path}`;
      if (forceConflict || state.conflictOnce.has(key)) {
        // A teammate saved a newer version while you were editing.
        forceConflict = false;
        state.conflictOnce.delete(key);
        const before = state.files[s.id][input.path];
        const teammate = me() === "jordan" ? "priya" : "jordan";
        const after = before.trimEnd() + `\n\n> ${person(teammate).name.split(" ")[0]}: tightened the wording before sending to the client.\n`;
        state.files[s.id][input.path] = after;
        commit(s, input.path, before, after, "Tighten wording before client review", teammate);
      }
      const current = fileDoc(s, input.path);
      if (current.sha !== input.baseSha) {
        throw new ApiError(
          409,
          "conflict",
          `${(current.lastCommit?.author.name ?? "Someone").split(" ")[0]} saved a newer version of this file while you were editing.`,
          "Compare the versions, then keep yours or start from theirs.",
          { path: input.path, byName: current.lastCommit?.author.name ?? null, byLogin: current.lastCommit?.author.login ?? null },
        );
      }
      const before = state.files[s.id][input.path];
      const message = input.message.trim() || `Update ${input.path.split("/").pop()}`;
      if (s.writePolicy === "pull-request") {
        const pr = state.prCounter++;
        const c: Commit = { sha: nextSha(), author: me(), date: new Date().toISOString(), message, path: input.path, before, after: input.content };
        log("edit", s.id, `proposed a change to ${input.path.split("/").pop()}`, input.path);
        return {
          outcome: "pull-request",
          commit: commitRef(c),
          prUrl: `https://github.com/${s.repo?.owner}/${s.repo?.name}/pull/${pr}`,
          file: current,
          pulled,
          pulledBy,
          space: toSpace(s),
        } satisfies SaveFileResult;
      }
      state.files[s.id][input.path] = input.content;
      const c = commit(s, input.path, before, input.content, message);
      markPushed(s);
      log("edit", s.id, message.charAt(0).toLowerCase() + message.slice(1), input.path);
      return { outcome: "committed", commit: commitRef(c), file: fileDoc(s, input.path), pulled, pulledBy, space: toSpace(s) };
    },

    async saveLocal(id, message) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "write");
      const paths = s.sync.state === "local-changes" ? (s.sync.changedPaths ?? []) : [];
      if (!paths.length) throw new ApiError(422, "no-change", "There's nothing to save.", "Every edit on this computer is already saved.");
      const locked = paths.find((p) => isLocked(s, p));
      if (locked) throw new ApiError(403, "locked", `${locked} is locked, so these changes can't be saved together.`, undefined, { path: locked });
      const text = message?.trim() || `Save ${paths.length} edited file${paths.length === 1 ? "" : "s"}`;
      let last: Commit | undefined;
      for (const p of paths) {
        const before = state.files[s.id][p] ?? "";
        const after = before + (localEdits[`${s.id}:${p}`] ?? "");
        state.files[s.id][p] = after;
        last = commit(s, p, before, after, text);
      }
      const review = s.writePolicy === "pull-request";
      s.sync = { ...s.sync, state: s.repo ? "synced" : "no-remote", ahead: 0, message: null, changedPaths: [] };
      state.lastSync[s.id] = new Date().toISOString();
      log("edit", s.id, `saved ${paths.length} edited file${paths.length === 1 ? "" : "s"}`);
      return {
        space: toSpace(s),
        result: review ? "pull-request" : s.repo ? "pushed" : "saved",
        message: review ? "Sent for review." : s.repo ? "Saved and sent to GitHub." : "Saved on this computer.",
        pulled: 0,
        pushed: s.repo ? 1 : 0,
        pulledBy: [],
        saved: paths,
        outcome: review ? "pull-request" : "committed",
        commit: last ? commitRef(last) : null,
        branch: null,
        prUrl: null,
      };
    },

    async moveFile(id, input) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "write");
      const from = validPath(input.from);
      const to = validPath(input.to);
      if (state.files[s.id][from] === undefined) throw new ApiError(404, "not-found", `${from} doesn't exist in ${s.name}.`);
      if (state.files[s.id][to] !== undefined) throw new ApiError(409, "exists", `${to} already exists.`, "Pick a different name.");
      for (const p of [from, to]) {
        const ed = editability(s, p);
        if (!ed.editable) throw new ApiError(403, isLocked(s, p) ? "locked" : "read-only", ed.reason ?? "You can't change this file.");
      }
      const { pulled, pulledBy } = pullPending(s);
      const content = state.files[s.id][from];
      delete state.files[s.id][from];
      state.files[s.id][to] = content;
      const c = commit(s, to, content, content, input.message?.trim() || `Rename ${from.split("/").pop()} to ${to.split("/").pop()}`);
      markPushed(s);
      log("edit", s.id, `renamed ${from.split("/").pop()} to ${to.split("/").pop()}`, to);
      return { outcome: "committed", commit: commitRef(c), file: fileDoc(s, to), pulled, pulledBy, space: toSpace(s) };
    },

    async createFile(id, input) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "write");
      const path = validPath(input.path);
      if (state.files[s.id][path] !== undefined) throw new ApiError(409, "exists", `${path} already exists.`, "Pick a different name.");
      const ed = editability(s, path);
      if (!ed.editable) throw new ApiError(403, isLocked(s, path) ? "locked" : "read-only", ed.reason ?? "You can't add files here.");
      const message = input.message.trim() || `Add ${path.split("/").pop()}`;
      if (s.writePolicy === "pull-request") {
        const pr = state.prCounter++;
        const c: Commit = { sha: nextSha(), author: me(), date: new Date().toISOString(), message, path, before: "", after: input.content };
        return {
          outcome: "pull-request",
          commit: commitRef(c),
          prUrl: `https://github.com/${s.repo?.owner}/${s.repo?.name}/pull/${pr}`,
          file: { path, content: input.content, locked: false, editable: true, sha: c.sha, lastCommit: commitRef(c) },
        };
      }
      state.files[s.id][path] = input.content;
      const c = commit(s, path, "", input.content, message);
      markPushed(s);
      log("create", s.id, `added ${path.split("/").pop()}`, path);
      return { outcome: "committed", commit: commitRef(c), file: fileDoc(s, path) };
    },

    async deleteFile(id, path, message) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "write");
      const doc = fileDoc(s, path);
      if (!doc.editable) throw new ApiError(403, doc.locked ? "locked" : "read-only", doc.reason ?? "You can't delete this file.");
      const before = state.files[s.id][path];
      delete state.files[s.id][path];
      commit(s, path, before, "", message.trim() || `Delete ${path.split("/").pop()}`);
      markPushed(s);
      log("delete", s.id, `deleted ${path.split("/").pop()}`, path);
    },

    async history(id, opts = {}) {
      await read();
      const s = findSpace(id);
      requireAccess(s, "read");
      const list = state.commits[s.id].filter((c) => !opts.path || c.path === opts.path).slice(0, opts.limit ?? 50);
      return list.map<HistoryEntry>((c) => {
        const { additions, deletions } = countChanges(diffLines(c.before, c.after));
        const p = person(c.author);
        return {
          sha: c.sha,
          author: { login: p.login, name: p.name, avatarUrl: p.avatarUrl },
          date: c.date,
          message: c.message,
          additions: c.before === "" ? c.after.split("\n").length : additions,
          deletions: c.after === "" ? c.before.split("\n").length : deletions,
          path: c.path,
        };
      });
    },

    async diff(id, sha) {
      await read();
      const s = findSpace(id);
      requireAccess(s, "read");
      const c = state.commits[s.id].find((x) => x.sha === sha);
      if (!c) throw new ApiError(404, "not-found", "That change isn't in this space's history.");
      return { sha, patch: unifiedPatch(c.path, c.before, c.after) };
    },

    async search(q, spaceId) {
      await wait(120, 300);
      const query = q.trim().toLowerCase();
      if (!query) return [];
      const terms = query.split(/\s+/);
      const hits: SearchHit[] = [];
      for (const s of state.spaces) {
        if (!visible(s) || accessOf(s) === "none") continue;
        if (spaceId && s.id !== spaceId) continue;
        for (const [path, content] of Object.entries(state.files[s.id] ?? {})) {
          const lower = content.toLowerCase();
          const pathLower = path.toLowerCase();
          let score = 0;
          for (const t of terms) {
            const inBody = lower.split(t).length - 1;
            if (inBody === 0 && !pathLower.includes(t)) {
              score = 0;
              break;
            }
            score += inBody + (pathLower.includes(t) ? 5 : 0);
          }
          if (score === 0) continue;
          const title = /^#\s+(.+)$/m.exec(content)?.[1] ?? path.split("/").pop()!;
          const idx = Math.max(0, lower.indexOf(terms[0]));
          const start = Math.max(0, idx - 60);
          const raw = content.slice(start, idx + 120).replace(/[#>*`|]/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim();
          hits.push({ spaceId: s.id, path, title, snippet: (start > 0 ? "…" : "") + raw + "…", score });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, 20);
    },

    async members(id) {
      await read();
      const s = findSpace(id);
      requireAccess(s, "read");
      return memberList(s);
    },

    async addMember(id, input) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "admin");
      const login = input.login.trim().replace(/^@/, "");
      if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) {
        throw new ApiError(400, "invalid-login", "That isn't a valid GitHub username.", "Usernames use letters, numbers and single hyphens.");
      }
      if (login.toLowerCase() === "ghost") throw new ApiError(404, "user-not-found", `There's no GitHub user called @${login}.`, "Check the spelling with them.");
      if (s.acl[login]) throw new ApiError(409, "already-member", `@${login} already has access to ${s.name}.`, "Change their role in the list instead.");
      if (!state.people.some((p) => p.login === login)) {
        state.people.push({ login, name: login, avatarUrl: "", title: "Invited" });
      }
      s.acl[login] = { role: input.role, via: "direct" };
      if (!seedPeople.some((p) => p.login === login)) invited.add(`${s.id}:${login}`);
      log("member", s.id, `gave @${login} ${input.role === "admin" ? "admin" : input.role === "write" ? "edit" : "view"} access`);
      return memberList(s);
    },

    async updateMember(id, login, role) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "admin");
      const entry = s.acl[login];
      if (!entry) throw new ApiError(404, "not-member", `@${login} isn't a member of ${s.name}.`);
      if (entry.via === "team") {
        throw new ApiError(409, "managed-by-team", `${person(login).name.split(" ")[0]}'s access comes from the ${entry.team} team on GitHub.`, "Change it on the team in GitHub, or add them directly.");
      }
      s.acl[login] = { ...entry, role };
      log("member", s.id, `changed @${login} to ${role === "admin" ? "Admin" : role === "write" ? "Can edit" : "Can view"}`);
      return memberList(s);
    },

    async removeMember(id, login) {
      await write();
      const s = findSpace(id);
      requireAccess(s, "admin");
      const entry = s.acl[login];
      if (!entry) throw new ApiError(404, "not-member", `@${login} isn't a member of ${s.name}.`);
      if (entry.via === "team") throw new ApiError(409, "managed-by-team", `${person(login).name.split(" ")[0]}'s access comes from the ${entry.team} team on GitHub.`, "Remove them from that team in GitHub.");
      if (s.owners.includes(login) && s.owners.length === 1) {
        throw new ApiError(409, "last-owner", `${person(login).name.split(" ")[0]} is the only owner of ${s.name}.`, "Make someone else an owner first.");
      }
      delete s.acl[login];
      log("member", s.id, `removed @${login}`);
      return memberList(s);
    },

    async people() {
      await read();
      const spaces = state.spaces.filter((s) => !s.personalOf && visible(s));
      const access: Record<string, Record<string, Role | "none">> = {};
      for (const p of state.people) {
        access[p.login] = {};
        for (const s of spaces) access[p.login][s.id] = s.acl[p.login]?.role ?? "none";
      }
      return { people: clone(state.people), spaces: spaces.map(toSpace), access };
    },

    async rules(opts = {}) {
      await read();
      return clone(
        rulesVisible()
          .filter((r) => (!opts.status || r.status === opts.status) && (!opts.space || r.spaceId === opts.space))
          .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)),
      );
    },

    async approveRule(id) {
      await write();
      const rule = rulesVisible().find((r) => r.id === id);
      if (!rule) throw new ApiError(404, "not-found", "That rule no longer exists.");
      if (rule.status !== "pending") throw new ApiError(409, "not-pending", "Someone already decided on this rule.", "Refresh to see where it went.");
      if (!canApprove(rule)) {
        const s = state.spaces.find((x) => x.id === rule.spaceId)!;
        throw new ApiError(403, "not-owner", `Only owners of ${s.name} can approve its rules.`, `Ask ${s.owners.map((o) => "@" + o).join(" or ")}.`);
      }
      rule.status = "active";
      rule.approvedBy = me();
      const s = state.spaces.find((x) => x.id === rule.spaceId)!;
      const path = "rules/learned.md";
      if (s.writePolicy !== "pull-request" && state.files[s.id][path] !== undefined) {
        const before = state.files[s.id][path];
        const today = new Date().toISOString().slice(0, 10);
        const after = before.trimEnd() + `\n- **${rule.text}** Why: ${rule.why} Approved by ${person(me()).name.split(" ")[0]}, ${today}.\n`;
        state.files[s.id][path] = after;
        commit(s, path, before, after, `Approve rule ${rule.id}`);
        markPushed(s);
      }
      log("rule-approved", s.id, `approved a rule: ${rule.text.slice(0, 48)}${rule.text.length > 48 ? "…" : ""}`);
      return clone(rule);
    },

    async rejectRule(id, reason) {
      await write();
      const rule = rulesVisible().find((r) => r.id === id);
      if (!rule) throw new ApiError(404, "not-found", "That rule no longer exists.");
      if (rule.status !== "pending") throw new ApiError(409, "not-pending", "Someone already decided on this rule.");
      if (!canApprove(rule)) {
        const s = state.spaces.find((x) => x.id === rule.spaceId)!;
        throw new ApiError(403, "not-owner", `Only owners of ${s.name} can reject its rules.`);
      }
      rule.status = "rejected";
      rule.approvedBy = me();
      rule.rejectedBy = me();
      rule.rejectReason = reason?.trim() || null;
      log("rule-rejected", rule.spaceId, `rejected a rule: ${rule.text.slice(0, 48)}${rule.text.length > 48 ? "…" : ""}`);
      return clone(rule);
    },

    async activity() {
      await read();
      return clone(
        state.activity.filter((a) => {
          const s = state.spaces.find((x) => x.id === a.spaceId);
          return s && visible(s) && accessOf(s) !== "none";
        }),
      ).slice(0, 30);
    },

    async connectableRepos() {
      await read();
      const connected = new Set(state.spaces.filter((s) => s.repo).map((s) => `${s.repo!.owner}/${s.repo!.name}`));
      return connectableRepos.map((r) => ({
        fullName: r.fullName,
        url: `https://github.com/${r.fullName}`,
        description: r.description,
        private: r.private,
        updatedAt: ago(days(r.updatedDaysAgo)),
        connected: connected.has(r.fullName),
      }));
    },
  };
}
