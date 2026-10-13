"use client";

import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getApi } from "@/lib/api/client";
import type { Space, SyncResult } from "@/lib/api/types";
import { errorText } from "@/lib/api/errors";
import { keys, useInvalidateSpace, useSyncSpace } from "@/lib/queries";
import { needsSync } from "@/lib/labels";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** What a sync did, in plain words, from the counts and the state after it. */
export function describeResult(r: SyncResult): { title: string; body?: string; tone: "success" | "warning" | "danger" } {
  const name = r.space.name;
  // "Up to date" is only true if nothing is left on this computer either.
  if (r.space.sync.state === "local-changes") {
    return {
      title: `${name} has edits that aren't saved to GitHub`,
      body: "Sync only sends saved changes. Save these edits first, then they'll go to GitHub.",
      tone: "warning",
    };
  }
  switch (r.result) {
    case "up-to-date":
      return { title: `${name} is up to date`, body: "Nothing new on GitHub, nothing to send.", tone: "success" };
    case "pulled":
      return { title: `${name} is up to date`, body: `Got ${plural(r.pulled || 1, "change")} from GitHub.`, tone: "success" };
    case "pushed":
      return {
        title: `${name} is up to date`,
        body: r.pulled ? `Got ${plural(r.pulled, "change")} and sent ${plural(r.pushed || 1, "change")}.` : `Sent ${plural(r.pushed || 1, "change")} to GitHub.`,
        tone: "success",
      };
    case "conflict":
      return {
        title: `${name} needs attention`,
        body: r.space.sync.conflict
          ? `You and ${r.space.sync.conflict.byName ?? "someone else"} both changed ${r.space.sync.conflict.path}. Nothing was changed.`
          : "Your changes and changes on GitHub overlap. Nothing was changed.",
        tone: "warning",
      };
    case "error":
      return { title: `Couldn't sync ${name}`, body: r.message, tone: "danger" };
    case "local-changes":
      return {
        title: `${name} has files that aren't on GitHub yet`,
        body: "Sync only sends saved changes. Use Save these changes first, then they'll go to GitHub.",
        tone: "warning",
      };
    case "saved":
      return { title: "Saved on this computer", body: r.message || "It couldn't be sent to GitHub yet. Sync again later.", tone: "warning" };
    case "pull-request":
      return { title: `Changes proposed in ${name}`, body: "They apply once an approver accepts the review.", tone: "success" };
  }
}

/** Sync one space with progress, outcome and a toast that says what happened. */
export function useSyncAction() {
  const mutation = useSyncSpace();
  /**
   * `quiet()` is checked when the sync finishes: when the caller is already showing the
   * outcome (the open sync popover), it returns true and no toast is shown.
   */
  async function sync(space: Space, opts: { quiet?: () => boolean } = {}) {
    try {
      const result = await mutation.mutateAsync(space.id);
      if (!opts.quiet?.()) {
        const d = describeResult(result);
        const fn = d.tone === "success" ? toast.success : d.tone === "warning" ? toast.warning : toast.error;
        fn(d.title, { description: d.body });
      }
      return result;
    } catch (e) {
      if (!opts.quiet?.()) {
        toast.error(`Couldn't sync ${space.name}`, {
          description: errorText(e),
        });
      }
      throw e;
    }
  }
  return { sync, isPending: mutation.isPending, pendingId: mutation.isPending ? mutation.variables : undefined, last: mutation.data, reset: mutation.reset };
}

/** Sync every space that has something to sync. */
/** What still needs this person after a sync, in plain words, or null if the space matches GitHub. */
function leftover(s: Space, failed: boolean): string | null {
  const { state, ahead, changedPaths } = s.sync;
  if (failed || state === "error") return `${s.name} couldn't sync`;
  switch (state) {
    case "local-changes": {
      const n = changedPaths?.length ?? 0;
      return n ? `${s.name} has ${plural(n, "file")} that ${n === 1 ? "isn't" : "aren't"} on GitHub yet` : `${s.name} has changes that aren't on GitHub yet`;
    }
    case "ahead":
      return `${s.name} has ${plural(ahead || 1, "saved change")} that ${ahead === 1 ? "isn't" : "aren't"} on GitHub yet`;
    case "diverged":
      return `${s.name} has a conflict to resolve`;
    case "behind":
      return `${s.name} still has changes to get`;
    default:
      return null;
  }
}

export function useSyncAll() {
  const qc = useQueryClient();
  const router = useRouter();
  const invalidate = useInvalidateSpace();
  const [running, setRunning] = useState(false);

  async function syncAll() {
    // Clicked before the list loaded: load it, rather than calling an empty list "up to date".
    const all = await qc.ensureQueryData({ queryKey: keys.spaces, queryFn: () => getApi().spaces() }).catch(() => null);
    if (!all) {
      toast.error("Couldn't check your spaces", { description: "Try again in a moment." });
      return;
    }
    const mine = all.filter((s) => s.myAccess !== "none" && s.repo);
    const spaces = mine.filter((s) => needsSync(s.sync.state));
    if (spaces.length === 0) {
      toast.success("Everything is up to date", { description: "All your spaces match GitHub." });
      return;
    }
    setRunning(true);
    const id = toast.loading(`Syncing ${plural(spaces.length, "space")}…`);
    const results = await Promise.all(spaces.map((s) => getApi().syncSpace(s.id).catch(() => null)));
    for (const r of results) if (r) invalidate(r.space.id);
    qc.setQueryData<Space[]>(keys.spaces, (prev) =>
      prev?.map((s) => results.find((r) => r?.space.id === s.id)?.space ?? s),
    );
    // Judge from each space's state after the sync, not from whether the calls succeeded.
    await qc.refetchQueries({ queryKey: keys.spaces, exact: true }).catch(() => undefined);
    setRunning(false);
    const after = new Map((qc.getQueryData<Space[]>(keys.spaces) ?? []).map((s) => [s.id, s]));
    const failedIds = new Set(spaces.filter((_, i) => !results[i] || results[i]!.result === "error").map((s) => s.id));
    const issues = mine
      .map((s) => after.get(s.id) ?? s)
      .map((s) => ({ space: s, text: leftover(s, failedIds.has(s.id)) }))
      .filter((x): x is { space: Space; text: string } => !!x.text);
    const synced = spaces.length - failedIds.size;
    const lead = synced > 0 ? `Synced ${plural(synced, "space")}.` : "Sync didn't finish.";

    if (issues.length === 0) {
      toast.success("Everything is up to date", { id, description: `Synced ${plural(synced, "space")} with GitHub.` });
      return;
    }
    const first = issues[0].space;
    toast.warning(issues.length === 1 ? `${lead} ${issues[0].text}.` : `${lead} ${issues.length} spaces need attention.`, {
      id,
      description: issues.length === 1 ? undefined : issues.map((x) => `${x.text}.`).join(" "),
      action: { label: `Open ${first.name}`, onClick: () => router.push(`/spaces/${first.id}`) },
      duration: 10000,
    });
  }
  return { syncAll, running };
}
