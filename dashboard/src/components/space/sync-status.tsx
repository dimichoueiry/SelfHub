"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  TriangleAlert,
  ArrowUpFromLine,
  CheckCircle2,
  CloudOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import Link from "next/link";
import { errorText } from "@/lib/api/errors";
import { resolveHref } from "@/lib/sync-help";
import { LocalChangesPanel } from "./local-changes";
import { cn } from "@/lib/utils";
import type { Space, SyncState } from "@/lib/api/types";
import { syncInfo, type SyncInfo } from "@/lib/labels";
import { fullDate, timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeResult, useSyncAction } from "./use-sync";
import { ConnectGitHubDialog } from "./connect-github";

export const syncIcon: Record<SyncState, LucideIcon> = {
  synced: CheckCircle2,
  behind: ArrowDownToLine,
  ahead: ArrowUpFromLine,
  "local-changes": ArrowUpFromLine,
  diverged: AlertTriangle,
  "no-remote": CloudOff,
  error: AlertCircle,
};

const toneText: Record<SyncInfo["tone"], string> = {
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
  neutral: "text-muted-foreground",
};
const toneDot: Record<SyncInfo["tone"], string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle-foreground/60",
};

/** Icon-only status for dense lists (sidebar). Never colour alone: each state has its own icon. */
export function SyncIcon({ space, className, badge = false }: { space: Space; className?: string; badge?: boolean }) {
  const info = syncInfo(space, timeAgo(space.sync.lastSyncAt));
  const Icon = space.sync.state === "synced" ? Check : space.sync.state === "diverged" ? TriangleAlert : syncIcon[space.sync.state];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        badge ? "size-4 rounded-full bg-sidebar ring-1 ring-sidebar" : "size-4",
        className,
      )}
      title={info.label}
    >
      <Icon className={cn("size-3", toneText[info.tone])} strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{info.label}</span>
    </span>
  );
}

/** Tiny dot for dense lists. Always pair with text or an accessible label. */
export function SyncDot({ space, className }: { space: Space; className?: string }) {
  const info = syncInfo(space, timeAgo(space.sync.lastSyncAt));
  return (
    <span className={cn("relative inline-flex size-4 items-center justify-center", className)} title={info.label}>
      <span className={cn("size-1.5 rounded-full", toneDot[info.tone])} />
      <span className="sr-only">{info.label}</span>
    </span>
  );
}

/** Icon + text status, for cards and tables. */
export function SyncBadge({ space, showDetail = true, className }: { space: Space; showDetail?: boolean; className?: string }) {
  const info = syncInfo(space, timeAgo(space.sync.lastSyncAt));
  const Icon = syncIcon[space.sync.state];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <Icon className={cn("size-3.5 shrink-0", toneText[info.tone])} aria-hidden />
      <span className={cn("font-medium whitespace-nowrap", toneText[info.tone])}>{info.label}</span>
      {showDetail && space.sync.state === "synced" && (
        <span className="truncate text-muted-foreground">· {info.detail}</span>
      )}
    </span>
  );
}

/** Header button: shows status, opens details with Sync now, progress and outcome. */
export function SyncButton({ space, className }: { space: Space; className?: string }) {
  const { sync, isPending } = useSyncAction();
  const [outcome, setOutcome] = useState<{ title: string; body?: string; tone: "success" | "warning" | "danger" } | null>(null);
  const openRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const info = syncInfo(space, timeAgo(space.sync.lastSyncAt));
  const Icon = isPending ? Loader2 : syncIcon[space.sync.state];
  const canSync = space.myAccess !== "none" && !!space.repo && space.sync.state !== "no-remote";
  const conflict = space.sync.state === "diverged";
  const file = space.sync.conflict?.path ?? null;
  const otherName = space.sync.conflict?.byName ?? null;
  const local = space.sync.state === "local-changes";
  const onlyHere = space.sync.state === "no-remote";

  async function run() {
    setOutcome(null);
    try {
      // The popover shows the outcome itself, so no toast while it's open.
      const r = await sync(space, { quiet: () => openRef.current });
      setOutcome(describeResult(r));
    } catch (e) {
      setOutcome({
        title: `Couldn't sync ${space.name}`,
        body: errorText(e),
        tone: "danger",
      });
    }
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          openRef.current = o;
          setOpen(o);
          if (!o) setOutcome(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button ref={triggerRef} variant="outline" size="sm" className={cn("gap-1.5 font-normal", className)} aria-label={`${isPending ? "Syncing…" : info.label}${!isPending && space.sync.state === "synced" ? ` · ${timeAgo(space.sync.lastSyncAt)}` : ""}, sync status`}>
            <Icon className={cn("size-3.5", isPending ? "animate-spin text-muted-foreground" : toneText[info.tone])} />
            <span className={cn("font-medium", isPending ? "text-muted-foreground" : toneText[info.tone])}>
              {isPending ? "Syncing…" : info.label}
            </span>
            {!isPending && space.sync.state === "synced" && (
              <span className="hidden text-muted-foreground lg:inline">· {timeAgo(space.sync.lastSyncAt)}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={cn("max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-1rem)] overflow-y-auto p-0", local ? "w-[380px]" : "w-[340px]")}>
          {onlyHere ? (
            <OnlyHere
              space={space}
              onConnect={() => {
                setOpen(false);
                openRef.current = false;
                setConnecting(true);
              }}
            />
          ) : (
            <>
              <div className="p-4">
                <div className="flex items-start gap-2.5">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", isPending ? "animate-spin text-muted-foreground" : toneText[info.tone])} />
                  <div className="min-w-0">
                    <p data-sync-title tabIndex={-1} className="text-sm font-medium outline-none">
                      {isPending ? "Syncing with GitHub…" : info.label}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{isPending ? "Getting new changes and sending yours." : info.detail}</p>
                  </div>
                </div>
                {/* Always mounted, so screen readers hear the outcome when it arrives. */}
                <div role="status" aria-live="polite">
                  {outcome && (
                    <div
                      className={cn(
                        "mt-3 rounded-lg border px-3 py-2 text-sm",
                        outcome.tone === "success" && "border-success/25 bg-success/8",
                        outcome.tone === "warning" && "border-warning/30 bg-warning/10",
                        outcome.tone === "danger" && "border-danger/25 bg-danger/8",
                      )}
                    >
                      <p className="font-medium">{outcome.title}</p>
                      {outcome.body && <p className="mt-0.5 text-muted-foreground">{outcome.body}</p>}
                    </div>
                  )}
                </div>
                {conflict ? (
                  <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">What to do</p>
                    <ol className="list-decimal space-y-1 pl-4">
                      <li>{otherName ? `Ask ${otherName} which version to keep.` : "Ask whoever else changed it which version to keep."}</li>
                      <li>Open {file ?? "the file"}, make it match, then Save &amp; sync.</li>
                    </ol>
                  </div>
                ) : local ? (
                  <div className="mt-3">
                    <LocalChangesPanel space={space} />
                  </div>
                ) : (
                  <RecoveryHelp space={space} />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-4 py-2.5">
                {conflict ? (
                  <>
                    <div className="flex items-center gap-1">
                      {canSync && (
                        <Button size="sm" variant="ghost" onClick={run} disabled={isPending} className="text-muted-foreground">
                          {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          {isPending ? "Syncing" : "Try again"}
                        </Button>
                      )}
                      {space.myAccess === "admin" && space.repo?.url && (
                        <Button size="sm" variant="ghost" asChild className="text-muted-foreground">
                          <a href={space.repo.url} target="_blank" rel="noreferrer">
                            Open on GitHub <ExternalLink aria-hidden />
                          </a>
                        </Button>
                      )}
                    </div>
                    <Button size="sm" asChild>
                      <Link href={resolveHref(space)}>Open {file ?? "files"}</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="truncate text-[11px] text-subtle-foreground" title={space.sync.lastSyncAt ? fullDate(space.sync.lastSyncAt) : undefined}>
                      {space.repo && <span className="font-mono">{space.repo.owner}/{space.repo.name}</span>}
                    </p>
                    {canSync && !local && (
                      <Button size="sm" variant={space.sync.state === "synced" ? "outline" : "default"} onClick={run} disabled={isPending}>
                        {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {isPending ? "Syncing" : "Sync now"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      {/* Stays mounted after the space connects, so the success step can show. */}
      {(onlyHere || connecting) && <ConnectGitHubDialog space={space} open={connecting} onOpenChange={setConnecting} returnFocus={triggerRef} />}
    </>
  );
}

/** Popover body for a space that isn't on GitHub yet. */
function OnlyHere({ space, onConnect }: { space: Space; onConnect: () => void }) {
  const admin = space.myAccess === "admin";
  return (
    <div className="p-4">
      <div className="flex items-start gap-2.5">
        <CloudOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p data-sync-title tabIndex={-1} className="text-sm font-medium outline-none">
            Only on this computer
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connect it to GitHub to back it up and share it with your team. GitHub is a free service that stores your files online.
          </p>
        </div>
      </div>
      {admin ? (
        <Button className="mt-4 w-full" onClick={onConnect}>
          Connect to GitHub
        </Button>
      ) : (
        <p className="mt-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Ask an admin to connect this space to GitHub.</p>
      )}
    </div>
  );
}

function RecoveryHelp({ space }: { space: Space }) {
  const s = space.sync.state;
  if (s === "error") {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Check your internet connection and that your GitHub sign-in is still valid, then try again.
      </p>
    );
  }
  return null;
}
