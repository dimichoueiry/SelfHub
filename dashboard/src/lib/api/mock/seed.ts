import type { Person, Role, RuleStatus, SpaceKind, SyncState, WritePolicy } from "../types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const minutes = (n: number) => n * MIN;
export const hours = (n: number) => n * HOUR;
export const days = (n: number) => n * DAY;

export const people: Person[] = [
  { login: "maya", name: "Maya Lindqvist", avatarUrl: "", title: "Owner" },
  { login: "sam", name: "Sam Okafor", avatarUrl: "", title: "Ads specialist" },
  { login: "jordan", name: "Jordan Reyes", avatarUrl: "", title: "Strategist" },
  { login: "priya", name: "Priya Natarajan", avatarUrl: "", title: "Account manager" },
  { login: "leo", name: "Leo Brandt", avatarUrl: "", title: "Ads specialist (new)" },
];

export interface AclEntry {
  role: Role;
  via: "direct" | "team";
  team?: string;
}

export interface SeedSpace {
  id: string;
  name: string;
  kind: SpaceKind;
  description: string;
  repo: { owner: string; name: string } | null;
  writePolicy: WritePolicy;
  owners: string[];
  lockedPaths: string[];
  /** Listed to every org member, even without access (so people know it exists). */
  listed: boolean;
  personalOf?: string;
  sync: {
    state: SyncState;
    ahead: number;
    behind: number;
    lastSyncMinutesAgo: number | null;
    message: string | null;
    /** Files edited on this computer but not saved (state local-changes). */
    changedPaths?: string[];
    /** The file both sides changed (state diverged). */
    conflict?: { path: string; byLogin: string } | null;
    /** Who made the changes waiting on GitHub (state behind). */
    behindBy?: string | null;
  };
  acl: Record<string, AclEntry>;
}

const staff = "northline/staff";
const adsTeam = "northline/ads";

export const seedSpaces: SeedSpace[] = [
  {
    id: "northline",
    name: "Northline",
    kind: "org",
    description: "Company SOPs, brand voice and compliance rules. Loaded on every task.",
    repo: { owner: "northline", name: "brain" },
    writePolicy: "pull-request",
    owners: ["maya"],
    lockedPaths: ["locked/"],
    listed: true,
    sync: { state: "synced", ahead: 0, behind: 0, lastSyncMinutesAgo: 3, message: null },
    acl: {
      maya: { role: "admin", via: "direct" },
      jordan: { role: "write", via: "team", team: staff },
      sam: { role: "write", via: "team", team: staff },
      priya: { role: "write", via: "team", team: staff },
      leo: { role: "read", via: "direct" },
    },
  },
  {
    id: "ads-team",
    name: "Ads Team",
    kind: "team",
    description: "How the ads team builds, tests and reviews paid social and search ads.",
    repo: { owner: "northline", name: "ads-team" },
    writePolicy: "direct",
    owners: ["jordan", "sam"],
    lockedPaths: [],
    listed: true,
    sync: { state: "behind", ahead: 0, behind: 2, lastSyncMinutesAgo: 95, message: "Jordan made 2 changes.", behindBy: "jordan" },
    acl: {
      maya: { role: "admin", via: "direct" },
      jordan: { role: "admin", via: "direct" },
      sam: { role: "write", via: "team", team: adsTeam },
      leo: { role: "read", via: "direct" },
    },
  },
  {
    id: "apex",
    name: "Apex Roofing",
    kind: "client",
    description: "Family roofer in Denver. Brief, campaigns and Apex-specific rules.",
    repo: { owner: "northline", name: "client-apex" },
    writePolicy: "direct",
    owners: ["priya", "jordan"],
    lockedPaths: [],
    listed: true,
    sync: { state: "synced", ahead: 0, behind: 0, lastSyncMinutesAgo: 12, message: null },
    acl: {
      maya: { role: "admin", via: "direct" },
      priya: { role: "admin", via: "direct" },
      jordan: { role: "write", via: "direct" },
      sam: { role: "write", via: "direct" },
    },
  },
  {
    id: "bolt",
    name: "Bolt HVAC",
    kind: "client",
    description: "Heating and cooling in Aurora.",
    repo: { owner: "northline", name: "client-bolt" },
    writePolicy: "direct",
    owners: ["priya"],
    lockedPaths: [],
    listed: true,
    sync: { state: "synced", ahead: 0, behind: 0, lastSyncMinutesAgo: 40, message: null },
    acl: {
      maya: { role: "admin", via: "direct" },
      priya: { role: "admin", via: "direct" },
      jordan: { role: "write", via: "direct" },
    },
  },
  {
    id: "content",
    name: "Content Team",
    kind: "team",
    description: "Blog and email content for clients, and the shared calendar.",
    repo: { owner: "northline", name: "content-team" },
    writePolicy: "direct",
    owners: ["priya"],
    lockedPaths: [],
    listed: true,
    sync: {
      state: "diverged",
      ahead: 1,
      behind: 1,
      lastSyncMinutesAgo: 26 * 60,
      message: "You and Priya both changed content-calendar.md.",
      conflict: { path: "content-calendar.md", byLogin: "priya" },
    },
    acl: {
      maya: { role: "admin", via: "direct" },
      priya: { role: "write", via: "direct" },
      sam: { role: "write", via: "direct" },
      leo: { role: "read", via: "direct" },
    },
  },
  {
    id: "personal-sam",
    name: "Sam Okafor",
    kind: "personal",
    description: "Sam's own SOPs, preferences and notes.",
    repo: { owner: "northline", name: "selfhub-sam" },
    writePolicy: "direct",
    owners: ["sam"],
    lockedPaths: [],
    listed: false,
    personalOf: "sam",
    sync: {
      state: "local-changes",
      ahead: 0,
      behind: 0,
      lastSyncMinutesAgo: 60 * 5,
      message: "Uncommitted changes in this clone.",
      changedPaths: ["notes/2026-10-11.md", "sops/ads.md"],
    },
    acl: { sam: { role: "admin", via: "direct" } },
  },
  {
    id: "personal-maya",
    name: "Maya Lindqvist",
    kind: "personal",
    description: "Maya's own preferences and planning notes.",
    repo: { owner: "northline", name: "selfhub-maya" },
    writePolicy: "direct",
    owners: ["maya"],
    lockedPaths: [],
    listed: false,
    personalOf: "maya",
    sync: { state: "synced", ahead: 0, behind: 0, lastSyncMinutesAgo: 8, message: null },
    acl: { maya: { role: "admin", via: "direct" } },
  },
  {
    id: "archive",
    name: "Northline Archive",
    kind: "org",
    description: "Client work from before SelfHub. Kept for reference.",
    repo: null,
    writePolicy: "read-only",
    owners: ["maya"],
    lockedPaths: [],
    listed: false,
    sync: { state: "no-remote", ahead: 0, behind: 0, lastSyncMinutesAgo: null, message: "This space only exists on Maya's computer." },
    acl: { maya: { role: "admin", via: "direct" }, priya: { role: "read", via: "direct" } },
  },
];

/** Who first wrote each file, and how long ago. Default: first owner, 90 days. */
export const fileOrigins: Record<string, Record<string, { author: string; daysAgo: number }>> = {
  northline: {
    "README.md": { author: "maya", daysAgo: 160 },
    "locked/compliance.md": { author: "maya", daysAgo: 150 },
    "locked/brand-voice.md": { author: "maya", daysAgo: 148 },
    "sops/onboarding-a-client.md": { author: "priya", daysAgo: 120 },
    "sops/ad-review.md": { author: "jordan", daysAgo: 100 },
    "brand/tone-examples.md": { author: "jordan", daysAgo: 90 },
    "rules/learned.md": { author: "maya", daysAgo: 60 },
  },
  "ads-team": { "sops/facebook-ads.md": { author: "jordan", daysAgo: 80 } },
  apex: {
    "brief.md": { author: "priya", daysAgo: 130 },
    "work/2026-10-12-spring-promo.md": { author: "sam", daysAgo: 1 },
    "work/2026-08-storm-season.md": { author: "sam", daysAgo: 50 },
  },
  "personal-sam": { "notes/2026-10-11.md": { author: "sam", daysAgo: 1 } },
};

/** Later edits, applied newest-last. `from` is what the text was before the edit. */
export const fileRevisions: Record<
  string,
  Record<string, { author: string; ago: number; message: string; from: string; to: string }[]>
> = {
  northline: {
    "locked/compliance.md": [
      {
        author: "maya",
        ago: days(40),
        message: "Require license numbers in contractor ads",
        from: "2. Never claim a contractor is licensed unless the brief says so.",
        to: `2. Never claim a contractor is "licensed", "bonded" or "insured" unless the license number\n   is in the client brief. Include the number in the ad.`,
      },
    ],
    "rules/learned.md": [
      {
        author: "maya",
        ago: days(24),
        message: "Approve rule: one clear next step per ad",
        from: "",
        to: `- **Every ad ends with one clear next step.** Why: ads with two calls to action\n  underperformed. Approved by Maya, 2026-09-18.\n`,
      },
    ],
  },
  apex: {
    "brief.md": [
      {
        author: "priya",
        ago: days(30),
        message: "Add hail inspection offer",
        from: "No offer running right now.",
        to: "Free hail-damage inspection with photos, through **November 30, 2026**.",
      },
      {
        author: "jordan",
        ago: hours(26),
        message: "Note that Apex dislikes urgency language",
        from: `Calm and neighborly. Dana's words: "We're the roofer your dad trusted."`,
        to: `Calm and neighborly. Dana's words: "We're the roofer your dad trusted." Apex hates\nurgency and countdown language.`,
      },
    ],
    "work/2026-10-12-spring-promo.md": [
      {
        author: "sam",
        ago: hours(3),
        message: "Rewrite variant B without urgency",
        from: "> 612 Denver homeowners gave us 4.9 stars. Book now, spots are limited!",
        to: "> 612 Denver homeowners gave us 4.9 stars. Book a free hail inspection when it suits you.",
      },
    ],
  },
  "ads-team": {
    "sops/facebook-ads.md": [
      {
        author: "jordan",
        ago: days(9),
        message: "Add image size table",
        from: "",
        to: `## Image notes\n\n| Format | Size | Notes |\n|---|---|---|\n| Feed | 1080 × 1350 | Real job photos beat stock |\n| Stories | 1080 × 1920 | Keep text in the middle 60% |\n`,
      },
    ],
  },
  "personal-sam": {
    "sops/ads.md": [
      {
        author: "sam",
        ago: hours(5),
        message: "Add hooks that have worked",
        from: "",
        to: `## Hooks that have worked\n\n- A photo of real damage with a plain caption\n- "Not sure if…" questions\n- Star rating plus review count\n`,
      },
    ],
  },
};

/** Changes waiting on GitHub for spaces that are behind. Applied on "Sync now". */
export const remoteChanges: Record<string, { author: string; path: string; message: string; append: string }[]> = {
  "ads-team": [
    {
      author: "jordan",
      path: "sops/facebook-ads.md",
      message: "Add creative testing cadence",
      append: "\n## Creative testing cadence\n\nRotate in one new hook every week. Retire a hook after two weeks without a win.\n",
    },
    {
      author: "jordan",
      path: "rules/learned.md",
      message: "Approve rule: hooks under 90 characters",
      append:
        "- **Keep hooks under 90 characters.** Why: longer hooks get cut off on mobile.\n  Approved by Jordan, 2026-10-12.\n",
    },
  ],
};

export interface SeedRule {
  id: string;
  spaceId: string;
  text: string;
  why: string;
  source: string;
  proposedBy: string;
  proposedAgo: number;
  approvedBy?: string;
  status: RuleStatus;
  prUrl?: string;
}

export const seedRules: SeedRule[] = [
  {
    id: "R-20261012-3f9a",
    spaceId: "apex",
    text: "Never use urgency phrasing ('act now', 'limited time', 'spots are filling up').",
    why: "Jordan on variant 2 of the spring promo: \"Too pushy. Apex hates urgency language.\"",
    source: "work/2026-10-12-spring-promo.md",
    proposedBy: "jordan",
    proposedAgo: hours(2),
    status: "pending",
  },
  {
    id: "R-20261011-a2c4",
    spaceId: "ads-team",
    text: "Put the client's license number in the first two lines of every home-services ad.",
    why: "Ads with the license up top had a 22% lower cost per lead in September.",
    source: "sops/facebook-ads.md",
    proposedBy: "priya",
    proposedAgo: hours(20),
    status: "pending",
  },
  {
    id: "R-20261010-77be",
    spaceId: "northline",
    text: "Never name a competitor in ad copy, even in a comparison.",
    why: "A client received a cease-and-desist letter over a comparison ad in September.",
    source: "sops/ad-review.md",
    proposedBy: "priya",
    proposedAgo: days(2),
    status: "pending",
    prUrl: "https://github.com/northline/brain/pull/41",
  },
  {
    id: "R-20261009-c0d1",
    spaceId: "content",
    text: "Blog posts link to the client's booking page, never the home page.",
    why: "Home-page links converted at half the rate in Q3.",
    source: "sops/blog-posts.md",
    proposedBy: "sam",
    proposedAgo: days(3),
    status: "pending",
  },
  {
    id: "R-20260830-1b7e",
    spaceId: "apex",
    text: "Lead with the inspection, never with insurance.",
    why: "Insurance-first ads had 3x the cost per booking.",
    source: "work/2026-08-storm-season.md",
    proposedBy: "sam",
    proposedAgo: days(44),
    approvedBy: "priya",
    status: "active",
  },
  {
    id: "R-20260614-0c2d",
    spaceId: "apex",
    text: "Always mention \"family-owned since 1998\".",
    why: "Dana asked for it on the kickoff call.",
    source: "brief.md",
    proposedBy: "priya",
    proposedAgo: days(120),
    approvedBy: "priya",
    status: "active",
  },
  {
    id: "R-20260902-9e41",
    spaceId: "northline",
    text: "Never use all caps for emphasis in ad copy.",
    why: "Reads as shouting. Flagged by Jordan on three clients.",
    source: "sops/ad-review.md",
    proposedBy: "jordan",
    proposedAgo: days(41),
    approvedBy: "maya",
    status: "active",
    prUrl: "https://github.com/northline/brain/pull/33",
  },
  {
    id: "R-20260821-5aa0",
    spaceId: "ads-team",
    text: "Write three variants that differ only in the hook.",
    why: "Keeps test results readable.",
    source: "sops/facebook-ads.md",
    proposedBy: "sam",
    proposedAgo: days(52),
    approvedBy: "jordan",
    status: "active",
  },
  {
    id: "R-20260915-d3f8",
    spaceId: "apex",
    text: "Always offer a discount in the first line.",
    why: "Agent suggestion after one high-CTR variant.",
    source: "work/2026-08-storm-season.md",
    proposedBy: "sam",
    proposedAgo: days(27),
    approvedBy: "priya",
    status: "rejected",
  },
  {
    id: "R-20260922-71c9",
    spaceId: "ads-team",
    text: "Use an emoji in every Instagram hook.",
    why: "Two posts with emoji got more saves.",
    source: "sops/facebook-ads.md",
    proposedBy: "leo",
    proposedAgo: days(20),
    approvedBy: "jordan",
    status: "rejected",
  },
];

export const connectableRepos = [
  { fullName: "northline/client-ridgeline", description: "Ridgeline Plumbing: brief and campaigns", private: true, updatedDaysAgo: 2 },
  { fullName: "northline/client-summit-solar", description: "Summit Solar: onboarding notes", private: true, updatedDaysAgo: 6 },
  { fullName: "northline/sales-playbook", description: "How we pitch and price new clients", private: true, updatedDaysAgo: 14 },
  { fullName: "northline/brain", description: "Northline company brain", private: true, updatedDaysAgo: 0 },
  { fullName: "northline/client-apex", description: "Apex Roofing", private: true, updatedDaysAgo: 0 },
];
