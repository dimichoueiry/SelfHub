"use client";

import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApi } from "@/lib/api/client";
import { canApproveRule } from "@/lib/permissions";
import type { FileDoc, Member, Role, RuleStatus, Space, SyncResult } from "@/lib/api/types";

export const keys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  tree: (id: string) => ["tree", id] as const,
  file: (id: string, path: string) => ["file", id, path] as const,
  history: (id: string, path?: string) => ["history", id, path ?? ""] as const,
  diff: (id: string, sha: string) => ["diff", id, sha] as const,
  search: (q: string, space?: string) => ["search", q, space ?? ""] as const,
  members: (id: string) => ["members", id] as const,
  people: ["people"] as const,
  rules: (status?: RuleStatus, space?: string) => ["rules", status ?? "", space ?? ""] as const,
  activity: ["activity"] as const,
  repos: ["repos"] as const,
};

const api = () => getApi();

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api().me() });
export const useSpaces = () => useQuery({ queryKey: keys.spaces, queryFn: () => api().spaces() });

export function useSpace(id: string) {
  const q = useSpaces();
  return { ...q, data: q.data?.find((s) => s.id === id) };
}

export const useTree = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.tree(id), queryFn: () => api().tree(id), enabled });

/**
 * Paths this person just renamed away or deleted. Nothing fetches them again, and the Explorer
 * doesn't report them as missing. A path leaves the list when a file is added there again.
 */
let removedPaths: ReadonlyMap<string, number> = new Map();
const removedListeners = new Set<() => void>();
const removedKey = (spaceId: string, path: string) => `${spaceId}\n${path}`;
function setRemoved(spaceId: string, path: string, removed: boolean) {
  const key = removedKey(spaceId, path);
  if (!removed && !removedPaths.has(key)) return;
  const next = new Map(removedPaths);
  if (removed) next.set(key, Date.now());
  else next.delete(key);
  removedPaths = next;
  removedListeners.forEach((l) => l());
}
export const unmarkRemoved = (spaceId: string, path: string) => setRemoved(spaceId, path, false);
/** When this person removed the path (ms), or undefined. */
export function useRemovedAt(spaceId: string | undefined, path: string | null) {
  const map = useSyncExternalStore(
    (l) => {
      removedListeners.add(l);
      return () => removedListeners.delete(l);
    },
    () => removedPaths,
    () => removedPaths,
  );
  return spaceId && path ? map.get(removedKey(spaceId, path)) : undefined;
}

export function useFile(id: string, path: string | null) {
  const removed = useRemovedAt(id, path) !== undefined;
  return useQuery({ queryKey: keys.file(id, path ?? ""), queryFn: () => api().file(id, path!), enabled: !!path && !removed });
}

export const useHistory = (id: string, path?: string, enabled = true) =>
  useQuery({ queryKey: keys.history(id, path), queryFn: () => api().history(id, { path, limit: 50 }), enabled });

export const useDiff = (id: string, sha: string | null) =>
  useQuery({ queryKey: keys.diff(id, sha ?? ""), queryFn: () => api().diff(id, sha!), enabled: !!sha });

export const useSearch = (q: string, space?: string) =>
  useQuery({
    queryKey: keys.search(q, space),
    queryFn: () => api().search(q, space),
    enabled: q.trim().length > 1,
    placeholderData: (prev) => prev,
  });

export const useMembers = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.members(id), queryFn: () => api().members(id), enabled });

export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: () => api().people() });

export const useRules = (status?: RuleStatus, space?: string) =>
  useQuery({ queryKey: keys.rules(status, space), queryFn: () => api().rules({ status, space }) });

export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api().activity() });

export const useConnectableRepos = (enabled: boolean) =>
  useQuery({ queryKey: keys.repos, queryFn: () => api().connectableRepos(), enabled });

/** Invalidate everything derived from a space's files. */
export function useInvalidateSpace() {
  const qc = useQueryClient();
  return (id: string, opts: { except?: string } = {}) => {
    qc.invalidateQueries({ queryKey: keys.spaces });
    qc.invalidateQueries({ queryKey: ["tree", id] });
    // `except`: a path that was just removed; never refetch it.
    qc.invalidateQueries({ queryKey: ["file", id], predicate: (q) => !opts.except || q.queryKey[2] !== opts.except });
    qc.invalidateQueries({ queryKey: ["history", id] });
    qc.invalidateQueries({ queryKey: keys.activity });
    qc.invalidateQueries({ queryKey: ["search"] });
  };
}

export function useSyncSpace() {
  const qc = useQueryClient();
  const invalidate = useInvalidateSpace();
  return useMutation({
    mutationFn: (id: string) => api().syncSpace(id),
    onSuccess: (result: SyncResult) => {
      qc.setQueryData<Space[]>(keys.spaces, (prev) => prev?.map((s) => (s.id === result.space.id ? result.space : s)));
      invalidate(result.space.id);
    },
  });
}

export function useMemberMutations(spaceId: string) {
  const qc = useQueryClient();
  // Every member change returns the full, updated list: use it directly.
  const done = (list: Member[]) => {
    if (Array.isArray(list)) qc.setQueryData(keys.members(spaceId), list);
    else qc.invalidateQueries({ queryKey: keys.members(spaceId) });
    qc.invalidateQueries({ queryKey: keys.people });
    qc.invalidateQueries({ queryKey: keys.spaces });
    qc.invalidateQueries({ queryKey: keys.activity });
  };
  return {
    add: useMutation({ mutationFn: (v: { login: string; role: Role }) => api().addMember(spaceId, v), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { login: string; role: Role }) => api().updateMember(spaceId, v.login, v.role), onSuccess: done }),
    remove: useMutation({ mutationFn: (login: string) => api().removeMember(spaceId, login), onSuccess: done }),
  };
}

/** Pending rules the signed-in user can approve or reject (badge, Home, "Waiting for you"). */
export function useActionableRules() {
  const pending = useRules("pending");
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const data = pending.data?.filter((r) => canApproveRule(r, spaces?.find((s) => s.id === r.spaceId), me));
  return { ...pending, data: me && spaces ? data : undefined };
}

/**
 * After a file is added, moved or deleted: drop the old path's cached file (so nothing refetches
 * a path that no longer exists), seed the new one, and wait for the tree to include it before
 * anyone navigates there.
 */
export async function settleFileChange(
  qc: ReturnType<typeof useQueryClient>,
  spaceId: string,
  change: { removed?: string; added?: string; file?: FileDoc },
) {
  // Mark first, so no render between here and navigation treats the old path as "missing".
  if (change.removed) setRemoved(spaceId, change.removed, true);
  if (change.added) setRemoved(spaceId, change.added, false);
  if (change.removed) await qc.cancelQueries({ queryKey: keys.file(spaceId, change.removed), exact: true });
  if (change.added && change.file) qc.setQueryData(keys.file(spaceId, change.added), change.file);
  await qc.refetchQueries({ queryKey: keys.tree(spaceId), exact: true });
}

/**
 * Call after navigating away from a path that no longer exists. Doing this before navigating
 * makes the still-mounted reader refetch the old path (a 404).
 */
export function forgetFile(qc: ReturnType<typeof useQueryClient>, spaceId: string, path: string) {
  setTimeout(() => qc.removeQueries({ queryKey: keys.file(spaceId, path), exact: true }), 0);
}
