"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownToLine, Columns2, Copy, Eye, EyeOff, GitPullRequestArrow, Loader2, PencilLine } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { isApiError, errorText } from "@/lib/api/errors";
import type { FileDoc, Space } from "@/lib/api/types";
import { keys, useInvalidateSpace, usePeople, useSyncSpace } from "@/lib/queries";
import { diffLines } from "@/lib/diff";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppState } from "@/components/app-state";
import { FileContent, fileKind, fileKindLabel } from "@/components/common/file-content";
import { OpsView } from "@/components/common/diff-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addProposal } from "./proposals";
import { useModKey } from "@/lib/use-mod-key";

type Mode = "write" | "preview" | "split";

export function Editor({
  space,
  file,
  onClose,
}: {
  space: Space;
  file: FileDoc;
  onClose: () => void;
}) {
  // The editor owns its text. It reads `file` once, when it opens; refetches and syncs never
  // overwrite the draft. `original` is the version the draft started from, `baseSha` its id.
  const [draft, setDraft] = useState(file.content);
  const [original, setOriginal] = useState(file.content);
  const [message, setMessage] = useState("");
  const [baseSha, setBaseSha] = useState(file.sha);
  /** Someone else changed this file while you have unsaved changes (found by Sync now). */
  const [alsoChangedBy, setAlsoChangedBy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches ? "split" : "write",
  );
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ theirs: FileDoc; message: string; byName?: string | null } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const seeChangesRef = useRef<HTMLButtonElement>(null);
  const { setDirty, guard } = useAppState();
  const invalidate = useInvalidateSpace();
  const syncSpace = useSyncSpace();
  const [gettingLatest, setGettingLatest] = useState(false);
  const behind = space.sync.state === "behind";

  /**
   * Sync now from inside the editor. The draft is never replaced while it has unsaved changes:
   * - no edits yet: move the editor to the latest version;
   * - edits, and this file didn't change: keep the draft, still unsaved;
   * - edits, and this file changed too: keep the draft and say so; saving opens the conflict dialog.
   */
  async function syncNow() {
    setGettingLatest(true);
    const typed = draftRef.current;
    const hadEdits = typed !== original;
    try {
      await syncSpace.mutateAsync(space.id);
      const latest = await getApi().file(space.id, file.path);
      qc.setQueryData(keys.file(space.id, file.path), latest);
      const fileChanged = latest.sha !== baseSha;
      if (!hadEdits) {
        setDraft(latest.content);
        setOriginal(latest.content);
        setBaseSha(latest.sha);
        setAlsoChangedBy(null);
        toast.success("Got the latest changes", { description: `You're editing the latest version of ${fileName}.` });
      } else if (!fileChanged) {
        toast.success("Got the latest changes", { description: `They didn't touch ${fileName}. Your unsaved changes are still here.` });
      } else {
        const who = latest.lastCommit?.author.name ?? "Someone";
        setAlsoChangedBy(who);
        toast.info(`${who} also changed ${fileName}`, { description: "Your unsaved changes are still here. When you save, you'll choose what to keep." });
      }
    } catch (e) {
      toast.error("Couldn't sync", { description: errorText(e) });
    } finally {
      setGettingLatest(false);
    }
  }
  // A newer version arrived from elsewhere (a Sync from the popover, Home or sidebar refetches the
  // file). Never replace typed text: with edits, keep them and flag it; with none, move forward.
  const [seenSha, setSeenSha] = useState(file.sha);
  if (file.sha !== seenSha) {
    setSeenSha(file.sha);
    if (file.sha !== baseSha) {
      if (draft !== original) {
        setAlsoChangedBy(file.lastCommit?.author.name ?? "Someone");
      } else {
        setDraft(file.content);
        setOriginal(file.content);
        setBaseSha(file.sha);
      }
    }
  }

  // Read the latest typed text in async handlers without re-rendering on every keystroke.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const qc = useQueryClient();
  const textRef = useRef<HTMLTextAreaElement>(null);

  // An owner's change to a locked file in a connected space is reviewed too.
  const review = space.writePolicy === "pull-request" || file.saveMode === "review";
  const ownerReview = !!file.owned && review;
  const mod = useModKey();
  const people = usePeople();
  const approverNames = space.owners.map((o) => people.data?.people.find((p) => p.login === o)?.name ?? o);
  const approvers = approverNames.length ? new Intl.ListFormat("en", { type: "disjunction" }).format(approverNames) : "an approver";
  const fileName = file.path.split("/").pop()!;
  const changed = draft !== original;
  const dirty = changed;

  useEffect(() => {
    setDirty(changed);
  }, [changed, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  async function save(opts: { base?: string } = {}) {
    if (saving) return;
    if (!changed && !opts.base) {
      toast.info("Nothing to save", { description: "You haven't changed this file." });
      return;
    }
    setSaving(true);
    try {
      const result = await getApi().saveFile(space.id, {
        path: file.path,
        content: draft,
        message: message.trim() || `Edit ${fileName}`,
        baseSha: opts.base ?? baseSha,
      });
      setDirty(false);
      invalidate(space.id);
      if (result.outcome === "pull-request") {
        const prUrl = result.prUrl || null;
        addProposal(qc, space.id, { path: file.path, prUrl: prUrl ?? "", branch: result.branch, date: new Date().toISOString(), message: result.commit.message });
        const once = ownerReview ? "once you approve it on GitHub" : "once an approver accepts it";
        toast.success(`Change proposed in ${space.name}`, {
          description: prUrl
            ? `A review is open on GitHub. ${fileName} changes for everyone ${once}.`
            : `Saved for review. ${fileName} changes for everyone ${once}.`,
          action: prUrl ? { label: "Open review", onClick: () => window.open(prUrl, "_blank") } : undefined,
          duration: 8000,
        });
      } else {
        if (result.file) qc.setQueryData(keys.file(space.id, file.path), result.file);
        toast.success(
          result.pulled
            ? `Saved. Also brought in ${result.pulled} change${result.pulled === 1 ? "" : "s"}${result.pulledBy?.length ? ` from ${new Intl.ListFormat("en", { type: "conjunction" }).format(result.pulledBy.map((n) => n.split(" ")[0]))}` : ""}.`
            : space.repo
              ? `Saved to ${space.name} and synced to GitHub`
              : `Saved to ${space.name}`,
          { description: space.repo ? `${file.path} is up to date for everyone with access.` : `${file.path} is saved on this computer.` },
        );
      }
      onClose();
    } catch (e) {
      if (isApiError(e) && e.status === 422) {
        // Same content as what's saved: not an error.
        setDirty(false);
        toast.info("No changes to save", { description: `${fileName} already has this content.` });
        onClose();
      } else if (isApiError(e) && e.status === 409) {
        const theirs = await getApi().file(space.id, file.path);
        setShowDiff(false);
        setConflict({ theirs, message: e.message, byName: typeof e.details?.byName === "string" ? e.details.byName : null });
      } else if (isApiError(e) && e.status === 403) {
        toast.error(e.message, { description: e.hint ?? "Your changes are still here. Copy them before leaving." });
        invalidate(space.id);
      } else {
        toast.error("Couldn't save", {
          description: errorText(e),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  // ⌘S / Ctrl+S saves.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
  }, []);

  // What they changed relative to your draft: + their lines, − lines only you have.
  const conflictOps = useMemo(() => (conflict ? diffLines(draft, conflict.theirs.content) : []), [conflict, draft]);
  // Who saved the newer version: the API's 409 details, else the latest change's author.
  const theirName = conflict?.byName ?? conflict?.theirs.lastCommit?.author.name ?? null;
  const theirFirst = theirName ? theirName.split(" ")[0] : "them";

  return (
    <div data-editor-root className="flex h-full min-h-0 flex-col">
      {behind && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-warning/10 px-4 py-2.5 text-sm md:px-6">
          <ArrowDownToLine className="size-4 shrink-0 text-warning-text" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-medium">
              {space.sync.incomingBy?.length
                ? `${new Intl.ListFormat("en", { type: "conjunction" }).format(space.sync.incomingBy)} made ${space.sync.behind || 1} change${space.sync.behind === 1 ? "" : "s"} since you last synced.`
                : `There ${space.sync.behind === 1 ? "is 1 new change" : `are ${space.sync.behind || "some"} new changes`} on GitHub since you last synced.`}
            </span>{" "}
            <span className="text-muted-foreground">Sync now so you&apos;re editing the latest version.</span>
          </p>
          <Button size="sm" variant="outline" onClick={syncNow} disabled={gettingLatest}>
            {gettingLatest ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
            {gettingLatest ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      )}
      {alsoChangedBy && changed && (
        <div role="status" className="flex shrink-0 items-start gap-3 border-b bg-warning/10 px-4 py-2.5 text-sm md:px-6">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{alsoChangedBy} also changed this file.</span>{" "}
            <span className="text-muted-foreground">When you save, you&apos;ll choose what to keep.</span>
          </p>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/14 px-2 py-0.5 text-xs font-medium text-warning-text">
            <PencilLine className="size-3" aria-hidden /> Editing
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{file.path}</span>
          {changed && <span className="text-xs text-subtle-foreground">· Unsaved changes</span>}
        </div>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as Mode)}
          variant="outline"
          size="sm"
          aria-label="Editor layout"
        >
          <ToggleGroupItem value="write" aria-label="Write">
            <PencilLine /> <span className="hidden sm:inline">Write</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" aria-label="Preview">
            <Eye /> <span className="hidden sm:inline">Preview</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Side by side" className="hidden lg:inline-flex">
            <Columns2 /> <span className="hidden sm:inline">Split</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={cn("grid min-h-0 flex-1", mode === "split" ? "lg:grid-cols-2" : "grid-cols-1")}>
        {mode !== "preview" && (
          <label className="flex min-h-0 flex-col">
            <span className="sr-only">Content of {fileName} ({fileKindLabel[fileKind(file.path)]})</span>
            <textarea
              ref={textRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck
              className="scroll-thin min-h-[320px] flex-1 resize-none bg-surface px-4 py-5 font-mono text-[13.5px] leading-[22px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:px-6"
            />
          </label>
        )}
        {mode !== "write" && (
          <div className={cn("scroll-thin min-h-0 overflow-y-auto px-4 py-6 md:px-8", mode === "split" && "border-l bg-background")}>
            {mode === "split" && <p className="mb-4 text-[11px] font-medium tracking-[0.04em] text-subtle-foreground uppercase">Preview</p>}
            <FileContent path={file.path} content={draft} />
          </div>
        )}
      </div>

      <form
        className="flex shrink-0 flex-col gap-3 border-t bg-surface px-4 py-3 md:flex-row md:items-center md:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="commit-message" className="sr-only">
            Describe your change
          </label>
          <Input
            id="commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your change"
            className="h-8"
          />
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {review ? (
              <>
                <GitPullRequestArrow className="size-3.5 shrink-0" aria-hidden />
                {ownerReview
                  ? "You own this file. Saving opens a reviewed change on GitHub. It takes effect once you approve it."
                  : `Opens a review on GitHub. Nothing changes for others until ${approvers} accepts it.`}
              </>
            ) : file.owned && file.note ? (
              <>{file.note}</>
            ) : space.repo ? (
              <>Saves go straight to GitHub. Everyone with access to {space.name} sees the change.</>
            ) : (
              <>Saves are kept on this computer. {space.name} isn&apos;t connected to GitHub.</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => guard(onClose)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !dirty} className="min-w-32">
            {saving ? <Loader2 className="animate-spin" /> : review ? <GitPullRequestArrow /> : null}
            {saving ? (review ? "Proposing…" : "Saving…") : review ? "Propose change" : "Save & sync"}
            {!saving && (
              <Kbd className="ml-1 hidden h-4.5 bg-primary-foreground/15 text-[10px] text-primary-foreground md:inline-flex">
                {mod === "⌘" ? "⌘S" : "Ctrl S"}
              </Kbd>
            )}
          </Button>
        </div>
      </form>

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[720px]"
          // Default focus is the safe action: look before deciding.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            seeChangesRef.current?.focus();
          }}
        >
          {conflict && (
            <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
              <div className="flex gap-3 border-b p-5">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/14 text-warning-text">
                  <AlertTriangle className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="text-base font-semibold">
                    {theirName ? `${theirName} changed this file while you were editing` : "Someone else changed this file while you were editing"}
                  </DialogTitle>
                  <DialogDescription className="mt-1">Your edits are safe. Nothing has been saved yet.</DialogDescription>
                  {conflict.theirs.lastCommit && (
                    <p className="mt-1.5 text-xs text-subtle-foreground">
                      Their change: &ldquo;{conflict.theirs.lastCommit.message}&rdquo;, {timeAgo(conflict.theirs.lastCommit.date)}
                    </p>
                  )}
                </div>
              </div>
              <div className="px-5 pt-4">
                <Button
                  ref={seeChangesRef}
                  onClick={() => setShowDiff((v) => !v)}
                  aria-expanded={showDiff}
                  aria-controls="conflict-diff"
                >
                  {showDiff ? <EyeOff /> : <Eye />}
                  {showDiff ? `Hide what ${theirFirst} changed` : `See what ${theirFirst} changed`}
                </Button>
              </div>
              <div id="conflict-diff" className={cn("min-h-0 flex-1 overflow-hidden px-5 pt-3", !showDiff && "hidden")}>
                <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-mono text-success-text">+</span> in {theirFirst === "them" ? "their" : `${theirFirst}'s`} version
                  </span>
                  <span>
                    <span className="font-mono text-danger-text">−</span> only in yours
                  </span>
                </p>
                <OpsView ops={conflictOps} className="max-h-[40vh]" />
              </div>
              <div className="mt-4 flex flex-col gap-2 border-t bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                  onClick={() => {
                    navigator.clipboard?.writeText(draft);
                    toast.success("Your version is copied", { description: "Paste it anywhere to keep it." });
                  }}
                >
                  <Copy /> Copy my text
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(conflict.theirs.content);
                      setBaseSha(conflict.theirs.sha);
                      setOriginal(conflict.theirs.content);
                      setAlsoChangedBy(null);
                      qc.setQueryData(keys.file(space.id, file.path), conflict.theirs);
                      setConflict(null);
                      toast.info("Your edits were discarded", { description: `You're now editing ${theirFirst === "them" ? "the latest" : `${theirFirst}'s`} version.` });
                    }}
                  >
                    Discard my edits
                  </Button>
                  <Button
                    variant="outline"
                    className="border-danger/40 text-danger-text hover:bg-danger/8"
                    onClick={() => {
                      const base = conflict.theirs.sha;
                      setBaseSha(base);
                      setConflict(null);
                      save({ base });
                    }}
                  >
                    {theirFirst === "them" ? "Replace their changes with mine" : `Replace ${theirFirst}'s changes with mine`}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
