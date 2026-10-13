import type {
  Activity,
  ConnectableRepo,
  CreateSpaceInput,
  Diff,
  FileDoc,
  HistoryEntry,
  Me,
  Member,
  PeopleMatrix,
  Role,
  Rule,
  RuleStatus,
  SaveFileInput,
  SaveFileResult,
  SaveLocalResult,
  SearchHit,
  Space,
  SyncResult,
  TreeEntry,
} from "./types";
import { createHttpAdapter } from "./http";
import { createMockAdapter } from "./mock/adapter";

export interface SelfHubApi {
  readonly kind: "mock" | "http";
  me(): Promise<Me>;
  spaces(): Promise<Space[]>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  deleteSpace(id: string): Promise<void>;
  syncSpace(id: string): Promise<SyncResult>;
  tree(id: string): Promise<TreeEntry[]>;
  file(id: string, path: string): Promise<FileDoc>;
  saveFile(id: string, input: SaveFileInput): Promise<SaveFileResult>;
  /** Save every file edited on this computer (sync.changedPaths) as one change. */
  saveLocal(id: string, message?: string): Promise<SaveLocalResult>;
  /** Rename or move one file, as one change. */
  moveFile(id: string, input: { from: string; to: string; message?: string }): Promise<SaveFileResult>;
  createFile(id: string, input: { path: string; content: string; message: string }): Promise<SaveFileResult>;
  deleteFile(id: string, path: string, message: string): Promise<void>;
  history(id: string, opts?: { path?: string; limit?: number }): Promise<HistoryEntry[]>;
  diff(id: string, sha: string, path?: string): Promise<Diff>;
  search(q: string, space?: string): Promise<SearchHit[]>;
  members(id: string): Promise<Member[]>;
  /** Member changes return the space's full, updated member list. */
  addMember(id: string, input: { login: string; role: Role }): Promise<Member[]>;
  updateMember(id: string, login: string, role: Role): Promise<Member[]>;
  removeMember(id: string, login: string): Promise<Member[]>;
  people(): Promise<PeopleMatrix>;
  rules(opts?: { status?: RuleStatus; space?: string }): Promise<Rule[]>;
  approveRule(id: string): Promise<Rule>;
  rejectRule(id: string, reason?: string): Promise<Rule>;
  activity(): Promise<Activity[]>;
  /** Not in the contract. Lists repos the user can connect; http adapter returns []. */
  connectableRepos(): Promise<ConnectableRepo[]>;
}

const mode = process.env.NEXT_PUBLIC_SELFHUB_API === "http" ? "http" : "mock";

let instance: SelfHubApi | null = null;

export function getApi(): SelfHubApi {
  if (!instance) {
    instance =
      mode === "http"
        ? // Same-origin path, proxied to NEXT_PUBLIC_SELFHUB_API_URL by next.config.ts (no CORS needed).
          createHttpAdapter("/selfhub-api")
        : createMockAdapter();
  }
  return instance;
}

export const apiMode = mode;
