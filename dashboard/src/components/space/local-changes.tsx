"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileMinus2, FilePen, FilePlus2, Loader2 } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { errorText, isApiError } from "@/lib/api/errors";
import type { SaveLocalResult, Space } from "@/lib/api/types";
import { keys, useInvalidateSpace } from "@/lib/queries";
import { canEditSpace } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const statusWord = { added: "New", modified: "Edited", deleted: "Deleted" } as const;
const statusIcon = { added: FilePlus2, modified: FilePen, deleted: FileMinus2 } as const;

const names = (list: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(list.map((n) => n.split(" ")[0]));

/** What save-local did, in plain words. */
export function describeSaveLocal(r: SaveLocalResult) {
  const files = `${r.saved.length} file${r.saved.length === 1 ? "" : "s"}`;
  const brought = r.pulled ? ` Also brought in ${r.pulled} change${r.pulled === 1 ? "" : "s"}${r.pulledBy?.length ? ` from ${names(r.pulledBy)}` : ""}.` : "";
  if (r.result === "pull-request" || r.outcome === "pull-request")
    return { tone: "success" as const, title: `Sent ${files} for review`, body: `They apply once an approver accepts them.${brought}` };
  if (r.result === "saved")
    return { tone: "warning" as const, title: `Saved ${files} on this computer`, body: `They couldn't be sent to GitHub yet. Sync again later.${brought}` };
  return { tone: "success" as const, title: `Saved ${files} to GitHub`, body: `Everyone with access to ${r.space.name} sees them now.${brought}` };
}

/**
 * Files edited on this computer but not saved (sync.changedPaths), each linked, with one
 * "Save these changes" action. Used by the sync popover and Home.
 */
export function LocalChangesPanel({ space, onSaved }: { space: Space; onSaved?: (r: SaveLocalResult) => void }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const invalidate = useInvalidateSpace();
  const changes = space.sync.changes?.length
    ? space.sync.changes
    : (space.sync.changedPaths ?? []).map((path) => ({ path, status: "modified" as const }));
  const canSave = canEditSpace(space);

  async function save() {
    setSaving(true);
    try {
      const r = await getApi().saveLocal(space.id, message.trim() || undefined);
      qc.setQueryData<Space[]>(keys.spaces, (prev) => prev?.map((s) => (s.id === r.space.id ? r.space : s)));
      invalidate(space.id);
      const d = describeSaveLocal(r);
      (d.tone === "success" ? toast.success : toast.warning)(d.title, { description: d.body });
      setMessage("");
      onSaved?.(r);
      // The button that had focus is gone now: land on the status heading instead of <body>.
      requestAnimationFrame(() =>
        (document.querySelector<HTMLElement>("[data-sync-title]") ?? document.getElementById("needs-you-heading"))?.focus(),
      );
    } catch (e) {
      if (isApiError(e) && e.status === 422) {
        toast.info("Nothing to save", { description: "Every edit on this computer is already saved." });
        invalidate(space.id);
      } else {
        toast.error("Couldn't save these changes", { description: errorText(e) });
      }
    } finally {
      setSaving(false);
    }
  }

  if (!changes.length) {
    return <p className="text-sm text-muted-foreground">Files changed on this computer aren&apos;t on GitHub yet. Open the space to find them.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border bg-surface" aria-label="Edited on this computer">
        {changes.map((c) => {
          const Icon = statusIcon[c.status];
          return (
            <li key={c.path} className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {c.status === "deleted" ? (
                <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">{c.path}</span>
              ) : (
                <Link href={`/spaces/${space.id}?path=${encodeURIComponent(c.path)}`} className="min-w-0 flex-1 truncate text-primary hover:underline">
                  {c.path}
                </Link>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{statusWord[c.status]}</span>
            </li>
          );
        })}
      </ul>
      {canSave ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor={`local-message-${space.id}`} className="text-xs font-medium text-muted-foreground">
            Describe these changes <span className="font-normal">(optional)</span>
          </label>
          <Input
            id={`local-message-${space.id}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Notes from the Apex call"
          />
          <Button type="submit" className="w-full" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? "Saving…" : space.writePolicy === "pull-request" ? "Propose these changes" : "Save these changes"}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">You can view this space, so you can&apos;t save these edits. Ask an admin of the space.</p>
      )}
    </div>
  );
}
