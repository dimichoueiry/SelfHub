"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { errorText } from "@/lib/api/errors";
import { keys, usePeople, useSpace } from "@/lib/queries";
import { kindLabel, policyLabel, syncInfo } from "@/lib/labels";
import { fullDate, plural, timeAgo } from "@/lib/format";
import { KindGlyph } from "@/components/space/kind-glyph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function Row({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">
        {children}
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </dd>
    </div>
  );
}

export default function SpaceSettingsPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { data: space } = useSpace(spaceId);
  const people = usePeople();
  const nameOf = (login: string) => people.data?.people.find((p) => p.login === login)?.name ?? login;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  if (!space) return null;
  const isAdmin = space.myAccess === "admin";

  async function remove() {
    if (!space) return;
    setBusy(true);
    try {
      await getApi().deleteSpace(space.id);
      await qc.invalidateQueries({ queryKey: keys.spaces });
      toast.success(`Removed ${space.name} from SelfHub`, {
        description: space.repo && space.sync.state !== "no-remote" ? "Its files stay on GitHub." : "Its files are still on this computer.",
      });
      router.push("/");
    } catch (e) {
      toast.error("Couldn't remove the space", { description: errorText(e) });
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[1120px] space-y-8 px-5 py-6 md:px-8 md:py-8">
      <section>
        <h2 className="text-base font-semibold">About this space</h2>
        <p className="mt-1 text-sm text-muted-foreground">How this space works. Approvers change these through review.</p>
        <dl className="mt-4 divide-y rounded-xl border bg-surface">
          <Row label="Name">{space.name}</Row>
          <Row label="Kind">
            <span className="inline-flex items-center gap-2">
              <KindGlyph kind={space.kind} size="xs" label={false} />
              {kindLabel[space.kind]}
            </span>
          </Row>
          <Row label="Description">{space.description || <span className="text-muted-foreground">None</span>}</Row>
          <Row
            label="How changes save"
            help={
              space.writePolicy === "pull-request"
                ? "Every change is proposed for review on GitHub and applies once an approver accepts it."
                : space.writePolicy === "direct"
                  ? "Saved changes reach everyone right away."
                  : "Nobody can save here from SelfHub."
            }
          >
            {policyLabel[space.writePolicy]}
          </Row>
          <Row label="Approvers" help="Approve rules and locked files.">
            {space.owners.length ? space.owners.map(nameOf).join(", ") : "None yet"}
          </Row>
          <Row label="Locked files" help={space.lockedPaths.filter((p) => !p.startsWith(".")).length ? "Loaded on every task. Only approvers can change them, through review." : undefined}>
            {space.lockedPaths.filter((p) => !p.startsWith(".")).length ? (
              <span className="inline-flex flex-wrap gap-1.5">
                {space.lockedPaths.filter((p) => !p.startsWith(".")).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    <Lock className="size-3" aria-hidden /> {p}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Row>
          <Row label="On GitHub">
            {space.repo && space.sync.state !== "no-remote" ? (
              <a href={space.repo.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-primary hover:underline">
                {space.repo.owner}/{space.repo.name}
              </a>
            ) : (
              <span className="text-muted-foreground">Not connected. This space only exists on this computer.</span>
            )}
          </Row>
          <Row label="Sync" help={space.sync.lastSyncAt ? `Last synced ${fullDate(space.sync.lastSyncAt)}` : undefined}>
            {syncInfo(space, timeAgo(space.sync.lastSyncAt)).label}
          </Row>
          <Row label="Size">
            {plural(space.fileCount, "file")} · {plural(space.memberCount, "member")}
          </Row>
        </dl>
      </section>

      <section>
        <h2 className="text-base font-semibold">Remove from SelfHub</h2>
        <div className="mt-4 flex flex-col gap-4 rounded-xl border border-danger/25 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Stops SelfHub and agents from using this space. Its files and history stay on GitHub."
              : `Only admins of ${space.name} can remove it.`}
          </p>
          <Button variant="outline" className="shrink-0 border-danger/30 text-danger-text hover:bg-danger/8" disabled={!isAdmin} onClick={() => setConfirmOpen(true)}>
            Remove space
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !busy && (setConfirmOpen(o), setTyped(""))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {space.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone loses it in SelfHub and agents stop loading it. Its files stay on GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="confirm-name" className="text-sm">
              Type <span className="font-semibold">{space.name}</span> to confirm
            </Label>
            <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1.5" autoComplete="off" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="danger" disabled={typed !== space.name || busy} onClick={remove}>
              {busy && <Loader2 className="animate-spin" />}
              Remove space
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
