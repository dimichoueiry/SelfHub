"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { errorText } from "@/lib/api/errors";
import type { FileDoc, Space } from "@/lib/api/types";
import { forgetFile, settleFileChange, useInvalidateSpace } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function pathError(path: string, existing: string[]) {
  const p = path.trim().replace(/^\/+/, "");
  if (!p) return "Give the file a name.";
  if (p.endsWith("/") || p.split("/").some((s) => !s || s === "." || s === "..")) return "That name isn't valid. Use something like notes/kickoff.md.";
  if (/[?#%\\:*"<>|]/.test(p)) return "Leave out ? # % \\ : * \" < > |. Letters, numbers, hyphens and underscores work everywhere.";
  if (/\s/.test(p)) return "Use hyphens instead of spaces, like spring-promo.md.";
  if (!/\.(md|markdown|txt|csv|json|ya?ml)$/i.test(p)) return "Use a .md file so agents and the reader can use it.";
  if (existing.includes(p)) return `${p} already exists.`;
  return undefined;
}

function ErrorLine({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-xs text-danger-text">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

export function NewFileDialog({
  open,
  onOpenChange,
  space,
  folder,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  space: Space;
  folder: string;
  existing: string[];
  onCreated: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateSpace();
  const qc = useQueryClient();
  const review = space.writePolicy === "pull-request";
  const value = path || (folder ? `${folder}/` : "");
  const error = pathError(value, existing);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (error) return;
    const clean = value.trim().replace(/^\/+/, "");
    const title = clean.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    setSaving(true);
    try {
      const res = await getApi().createFile(space.id, {
        path: clean,
        content: `# ${title.charAt(0).toUpperCase() + title.slice(1)}\n\n`,
        message: `Add ${clean.split("/").pop()}`,
      });
      if (res.outcome !== "pull-request") await settleFileChange(qc, space.id, { added: clean, file: res.file });
      invalidate(space.id);
      onOpenChange(false);
      setPath("");
      setSubmitted(false);
      if (res.outcome === "pull-request") {
        toast.success(`New file proposed in ${space.name}`, { description: "It appears once an approver accepts the review on GitHub." });
      } else {
        toast.success(`Added ${clean.split("/").pop()} to ${space.name}`, { description: "Saved to GitHub." });
        onCreated(clean);
      }
    } catch (err) {
      toast.error("Couldn't add the file", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New file in {space.name}</DialogTitle>
            <DialogDescription>
              {review ? "This opens a review on GitHub. The file appears once it's approved." : "The file is added and synced to GitHub."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="new-file-path">File name</Label>
            <Input
              id="new-file-path"
              autoFocus
              value={value}
              onChange={(e) => setPath(e.target.value)}
              placeholder="notes/kickoff-call.md"
              className="mt-1.5 font-mono text-sm"
              aria-invalid={submitted && !!error}
              aria-describedby={submitted && error ? "new-file-error" : "new-file-help"}
            />
            <ErrorLine id="new-file-error">{submitted && error}</ErrorLine>
            {!(submitted && error) && (
              <p id="new-file-help" className="mt-1.5 text-xs text-muted-foreground">
                Use slashes for folders, like <span className="font-mono">work/spring-promo.md</span>.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {review ? "Propose file" : "Create file"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameFileDialog({
  open,
  onOpenChange,
  space,
  file,
  existing,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  space: Space;
  file: FileDoc;
  existing: string[];
  onRenamed: (path: string) => void;
}) {
  const [path, setPath] = useState(file.path);
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateSpace();
  const qc = useQueryClient();
  const unchanged = path.trim() === file.path;
  const error = unchanged ? undefined : pathError(path, existing);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (error || unchanged) return;
    const next = path.trim().replace(/^\/+/, "");
    setSaving(true);
    try {
      // One change: one history entry, one activity item.
      const moved = await getApi().moveFile(space.id, { from: file.path, to: next, message: `Rename ${file.path.split("/").pop()} to ${next.split("/").pop()}` });
      // Settle caches before navigating, so the new path is known and the old one isn't refetched.
      await settleFileChange(qc, space.id, { removed: file.path, added: next, file: moved.file });
      onOpenChange(false);
      toast.success(`Renamed to ${next.split("/").pop()}`, { description: "Saved to GitHub. Earlier versions stay in the space's history." });
      onRenamed(next);
      forgetFile(qc, space.id, file.path);
      setTimeout(() => invalidate(space.id, { except: file.path }), 0);
    } catch (err) {
      toast.error("Couldn't rename the file", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename or move</DialogTitle>
            <DialogDescription>Links in other files that point to the old name won&apos;t update.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="rename-path">New name</Label>
            <Input
              id="rename-path"
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="mt-1.5 font-mono text-sm"
              aria-invalid={!!error}
              aria-describedby={error ? "rename-error" : undefined}
            />
            <ErrorLine id="rename-error">{error}</ErrorLine>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || unchanged || !!error}>
              {saving && <Loader2 className="animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFileDialog({
  open,
  onOpenChange,
  space,
  path,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  space: Space;
  path: string;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateSpace();
  const qc = useQueryClient();
  const name = path.split("/").pop();

  async function run() {
    setSaving(true);
    try {
      await getApi().deleteFile(space.id, path, `Delete ${name}`);
      await settleFileChange(qc, space.id, { removed: path });
      onOpenChange(false);
      toast.success(`Deleted ${name}`, { description: `Removed from ${space.name} for everyone.` });
      onDeleted();
      forgetFile(qc, space.id, path);
      setTimeout(() => invalidate(space.id, { except: path }), 0);
    } catch (err) {
      toast.error("Couldn't delete the file", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It&apos;s removed from {space.name} for everyone, and agents stop using it. The old version stays in the space&apos;s history on
            GitHub.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button variant="danger" onClick={run} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Delete file
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
