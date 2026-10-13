import type { SelfHubApi } from "./client";
import { getDemoUser } from "@/lib/demo-user";
import { ApiError } from "./errors";
import type { ApiErrorBody, Author, CommitRef, FileDoc, PeopleMatrix, SaveFileResult, Space } from "./types";

/** Demo-user logins in the selfhub-api seed (SELFHUB_DEMO=1). */
export const DEMO_LOGINS = { sam: "sam-okafor", maya: "maya-chen" } as const;

// --- Normalizers: tolerate the small ways the live API differs from the original contract.

function author(a: unknown): Author {
  if (a && typeof a === "object") {
    const o = a as Partial<Author>;
    return { login: o.login ?? "unknown", name: o.name ?? o.login ?? "Unknown", avatarUrl: o.avatarUrl ?? "" };
  }
  const login = typeof a === "string" ? a : "unknown";
  return { login, name: login, avatarUrl: "" };
}

function commit(c: unknown): CommitRef | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  return { sha: String(o.sha ?? ""), author: author(o.author), date: String(o.date ?? ""), message: String(o.message ?? "") };
}

function file(f: FileDoc): FileDoc {
  return { ...f, lastCommit: commit(f.lastCommit) };
}

function saveResult(r: SaveFileResult): SaveFileResult {
  return { ...r, commit: commit(r.commit) ?? { sha: "", author: author(null), date: "", message: "" }, file: r.file ? file(r.file) : undefined };
}

export function createHttpAdapter(baseUrl: string): SelfHubApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          // Demo backends act as this user (ignored outside demo mode). See docs/dashboard-api-contract.md.
          "X-SelfHub-User": DEMO_LOGINS[getDemoUser()],
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new ApiError(0, "network", "Can't reach SelfHub.", "Check that the SelfHub API is running, then try again.");
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (!err && res.status >= 500) {
        throw new ApiError(res.status, "unavailable", "SelfHub isn't responding.", "Check that the SelfHub API is running, then try again.");
      }
      throw new ApiError(
        res.status,
        err?.code ?? "unknown",
        err?.message ?? (res.status === 404 ? "SelfHub couldn't find that." : `SelfHub couldn't finish that request (error ${res.status}).`),
        // The API answered, so it is running: only add our own hint when it sent no error body.
        err ? (err.hint ?? undefined) : res.status === 404 ? "It may have been moved or removed. Go back and pick it again." : "Try again in a moment.",
        err?.details,
      );
    }
    return data as T;
  }

  // encodeURIComponent, not URLSearchParams: a space must travel as %20, never "+".
  const q = (params: Record<string, string | number | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  const id = encodeURIComponent;

  return {
    kind: "http",
    me: () => request("GET", "/api/me"),
    spaces: () => request("GET", "/api/spaces"),
    createSpace: (input) => request("POST", "/api/spaces", input),
    deleteSpace: (spaceId) => request("DELETE", `/api/spaces/${id(spaceId)}`),
    syncSpace: (spaceId) => request("POST", `/api/spaces/${id(spaceId)}/sync`),
    tree: (spaceId) => request("GET", `/api/spaces/${id(spaceId)}/tree`),
    file: async (spaceId, path) => file(await request<FileDoc>("GET", `/api/spaces/${id(spaceId)}/file${q({ path })}`)),
    saveFile: async (spaceId, input) => saveResult(await request<SaveFileResult>("PUT", `/api/spaces/${id(spaceId)}/file`, input)),
    saveLocal: (spaceId, message) => request("POST", `/api/spaces/${id(spaceId)}/save-local`, message ? { message } : {}),
    moveFile: async (spaceId, input) => saveResult(await request<SaveFileResult>("POST", `/api/spaces/${id(spaceId)}/move`, input)),
    createFile: async (spaceId, input) => saveResult(await request<SaveFileResult>("POST", `/api/spaces/${id(spaceId)}/files`, input)),
    deleteFile: (spaceId, path, message) => request("DELETE", `/api/spaces/${id(spaceId)}/file${q({ path, message })}`),
    history: (spaceId, opts = {}) =>
      request("GET", `/api/spaces/${id(spaceId)}/history${q({ path: opts.path, limit: opts.limit })}`),
    diff: (spaceId, sha, path) => request("GET", `/api/spaces/${id(spaceId)}/diff${q({ sha, path })}`),
    search: (query, space) => request("GET", `/api/search${q({ q: query, space })}`),
    members: (spaceId) => request("GET", `/api/spaces/${id(spaceId)}/members`),
    addMember: (spaceId, input) => request("POST", `/api/spaces/${id(spaceId)}/members`, input),
    updateMember: (spaceId, login, role) => request("PUT", `/api/spaces/${id(spaceId)}/members/${id(login)}`, { role }),
    removeMember: (spaceId, login) => request("DELETE", `/api/spaces/${id(spaceId)}/members/${id(login)}`),
    // /api/people spaces carry {id, name, kind, myAccess, owners}: everything the matrix and
    // the person drawer need, so no second request.
    people: async () => {
      const matrix = await request<PeopleMatrix>("GET", "/api/people");
      return {
        ...matrix,
        spaces: matrix.spaces.map((s) => ({ ...s, myAccess: s.myAccess ?? "none", owners: s.owners ?? [] }) as Space),
      };
    },
    rules: (opts = {}) => request("GET", `/api/rules${q({ status: opts.status, space: opts.space })}`),
    approveRule: (ruleId) => request("POST", `/api/rules/${id(ruleId)}/approve`),
    rejectRule: (ruleId, reason) => request("POST", `/api/rules/${id(ruleId)}/reject`, reason ? { reason } : undefined),
    activity: () => request("GET", "/api/activity?limit=30"),
    connectableRepos: async () => [],
  };
}
