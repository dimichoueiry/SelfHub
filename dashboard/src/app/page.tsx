"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronRight, FileText, Inbox, Lock, Plus, ScrollText } from "lucide-react";
import { Page } from "@/components/common/page";
import { ErrorState, EmptyState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { KindGlyph } from "@/components/space/kind-glyph";
import { SyncBadge, syncIcon } from "@/components/space/sync-status";
import { useSyncAction } from "@/components/space/use-sync";
import { LocalChangesPanel } from "@/components/space/local-changes";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionableRules, useActivity, useMe, usePeople, useRules, useSpaces } from "@/lib/queries";
import { usePageTitle } from "@/lib/use-page-title";
import { resolveHref } from "@/lib/sync-help";
import { accessSentence, kindLabel, kindOrder, syncInfo } from "@/lib/labels";
import { firstName, greeting, plural, timeAgo } from "@/lib/format";
import type { Person, Rule, Space } from "@/lib/api/types";
import { cleanSentence } from "@/lib/plain";
import { cn } from "@/lib/utils";

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border bg-surface", className)}>{children}</section>;
}

function CardHeader({ title, aside, count }: { title: string; aside?: React.ReactNode; count?: number }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-b px-4">
      <h2 id={title === "Needs you" ? "needs-you-heading" : undefined} tabIndex={-1} className="flex items-center gap-2 text-sm font-medium outline-none">
        {title}
        {!!count && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {aside}
    </div>
  );
}

/** One "Needs you" row. Below sm the action drops under the text instead of squeezing it. */
function NeedRow({
  icon,
  tone,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  tone: "primary" | "warning" | "danger";
  title: React.ReactNode;
  detail: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
            tone === "primary" && "bg-primary-soft text-primary",
            tone === "warning" && "bg-warning/14 text-warning-text",
            tone === "danger" && "bg-danger/10 text-danger-text",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium sm:line-clamp-1">{title}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground sm:truncate">{detail}</p>
        </div>
      </div>
      <div className="pl-11 sm:pl-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div>
    </li>
  );
}

function NeedsYou() {
  const spaces = useSpaces();
  const rules = useActionableRules();
  const people = usePeople();
  const { sync, pendingId } = useSyncAction();
  const nameOf = (login: string) => people.data?.people.find((p) => p.login === login)?.name ?? login;
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewSpace = spaces.data?.find((s) => s.id === reviewing);

  if (spaces.isLoading || rules.isLoading || !rules.data) {
    return (
      <Card>
        <CardHeader title="Needs you" />
        <div className="divide-y" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }
  if (spaces.error) return <Card><ErrorState error={spaces.error} title="Couldn't load your spaces" onRetry={() => spaces.refetch()} /></Card>;

  const byId = (id: string) => spaces.data?.find((s) => s.id === id);
  const outOfSync = (spaces.data ?? []).filter(
    // "Not connected to GitHub" isn't something Sync now can fix, so it isn't listed here.
    (s) => s.myAccess !== "none" && s.repo && s.sync.state !== "synced" && s.sync.state !== "no-remote",
  );

  const items: React.ReactNode[] = [];
  for (const r of rules.data) {
    const s = byId(r.spaceId)!;
    items.push(
      <NeedRow
        key={r.id}
        tone="primary"
        icon={<ScrollText className="size-4" aria-hidden />}
        title={<>Rule waiting for you: {r.text}</>}
        detail={<>{s.name} · proposed by {nameOf(r.proposedBy)} {timeAgo(r.proposedAt)}</>}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/rules?rule=${r.id}`}>Review</Link>
          </Button>
        }
      />,
    );
  }
  for (const s of outOfSync) {
    const info = syncInfo(s, timeAgo(s.sync.lastSyncAt));
    const Icon = syncIcon[s.sync.state];
    const conflict = s.sync.state === "diverged" || s.sync.state === "error";
    items.push(
      <NeedRow
        key={s.id}
        tone={conflict ? "danger" : "warning"}
        icon={<Icon className="size-4" aria-hidden />}
        title={<>{s.name}: {info.label.charAt(0).toLowerCase() + info.label.slice(1)}</>}
        detail={info.detail}
        action={
          conflict ? (
            <Button asChild variant="outline" size="sm">
              <Link href={resolveHref(s)}>Resolve</Link>
            </Button>
          ) : s.sync.state === "local-changes" ? (
            <Button variant="outline" size="sm" onClick={() => setReviewing(s.id)}>
              Review and save
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => sync(s).catch(() => {})} disabled={pendingId === s.id}>
              {pendingId === s.id ? "Syncing…" : "Sync now"}
            </Button>
          )
        }
      />,
    );
  }

  return (
    <Card>
      <CardHeader title="Needs you" count={items.length} />
      <Dialog open={!!reviewSpace} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Not on GitHub yet</DialogTitle>
            <DialogDescription>
              {reviewSpace ? `These files in ${reviewSpace.name} changed on this computer and aren't on GitHub yet.` : ""}
            </DialogDescription>
          </DialogHeader>
          {reviewSpace && <LocalChangesPanel space={reviewSpace} onSaved={() => setReviewing(null)} />}
        </DialogContent>
      </Dialog>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success-text" aria-hidden />
          Nothing needs you right now. Every space is synced and no rules are waiting on you.
        </div>
      ) : (
        <ul className="divide-y">{items}</ul>
      )}
    </Card>
  );
}

function SpaceCard({ space }: { space: Space }) {
  return (
    <Link
      href={`/spaces/${space.id}`}
      className="group flex flex-col rounded-xl border bg-surface p-4 transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-[0_1px_2px_oklch(0_0_0/4%)]"
    >
      <div className="flex items-start gap-3">
        <KindGlyph kind={space.kind} size="md" label={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{space.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {kindLabel[space.kind]} · {accessSentence[space.myAccess]}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 -translate-x-1 text-subtle-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{space.description || "No description yet."}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
        <SyncBadge space={space} showDetail={false} />
        <span className="text-xs text-subtle-foreground">
          {plural(space.fileCount, "file")} · {timeAgo(space.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

/** Spaces you can't open: listed quietly so people know they exist, collapsed by default. */
function OtherSpaces({ spaces, orgName }: { spaces: Space[]; orgName: string }) {
  const [open, setOpen] = useState(false);
  const { data: people } = usePeople();
  const nameOf = (login: string) => people?.people.find((p) => p.login === login)?.name ?? login;
  if (!spaces.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-dashed">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground max-md:min-h-10"
      >
        <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        Other spaces in {orgName}
        <span className="text-xs text-subtle-foreground">· {spaces.length} you can&apos;t open</span>
      </button>
      {open && (
        <ul className="divide-y border-t">
          {spaces.map((s) => (
            <li key={s.id}>
              <Link href={`/spaces/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/40">
                <KindGlyph kind={s.kind} size="sm" label={false} className="opacity-60" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="hidden truncate text-xs text-subtle-foreground sm:block">
                  Ask {s.owners.map(nameOf).join(" or ") || "an admin"} for access
                </span>
                <Lock className="size-3.5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function YourSpaces() {
  const spaces = useSpaces();
  const { data: me } = useMe();
  const { setAddSpaceOpen } = useAppState();
  const mine = (spaces.data ?? [])
    .filter((s) => s.myAccess !== "none")
    .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
  const others = (spaces.data ?? []).filter((s) => s.myAccess === "none");
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Your spaces</h2>
        <Button variant="ghost" size="sm" onClick={() => setAddSpaceOpen(true)} className="text-muted-foreground">
          <Plus /> Add space
        </Button>
      </div>
      {spaces.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-xl" />
          ))}
        </div>
      ) : spaces.error ? (
        <Card><ErrorState error={spaces.error} title="Couldn't load your spaces" onRetry={() => spaces.refetch()} /></Card>
      ) : mine.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="No spaces yet"
            action={<Button onClick={() => setAddSpaceOpen(true)}><Plus /> Add a space</Button>}
          >
            Connect your company&apos;s first space from GitHub, or create one from a template.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {mine.map((s) => (
            <SpaceCard key={s.id} space={s} />
          ))}
        </div>
      )}
      {me && <OtherSpaces spaces={others} orgName={me.org.name} />}
    </section>
  );
}

/**
 * The API sends full sentences ("Maya Chen gave leo-park read access…", "Apex Roofing:
 * Pushed 1 commit."); the mock sends predicates ("gave Leo view access"). Render both as
 * "<Name> <what happened>" without repeating the name.
 */
function ActivityText({
  actor,
  summary,
  type,
  spaceName,
  people,
  rules,
}: {
  actor: string;
  summary: string;
  type: string;
  spaceName?: string;
  people?: Person[];
  rules?: Rule[];
}) {
  let rest = cleanSentence(summary.trim(), people, rules, false);
  if (rest.startsWith(actor + " ")) rest = rest.slice(actor.length + 1);
  else if (spaceName && rest.startsWith(`${spaceName}: `)) {
    const what = rest.slice(spaceName.length + 2).replace(/\.$/, "");
    rest = `${type === "sync" ? "synced" : "updated"} ${spaceName}: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  }
  return (
    <>
      <span className="font-medium">{firstName(actor)}</span> <span className="text-muted-foreground">{rest}</span>
    </>
  );
}

function RecentActivity() {
  const activity = useActivity();
  const allRules = useRules();
  const spaces = useSpaces();
  const people = usePeople();
  const nameOf = (login: string) => people.data?.people.find((p) => p.login === login)?.name ?? login;
  const space = (id: string) => spaces.data?.find((s) => s.id === id);

  return (
    <Card>
      <CardHeader title="Recent activity" />
      {activity.isLoading || spaces.isLoading || people.isLoading ? (
        <div className="space-y-4 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-6 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : activity.error ? (
        <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
      ) : !activity.data?.length ? (
        <EmptyState icon={FileText} title="No changes yet">
          When anyone edits a file or a rule, it shows up here.
        </EmptyState>
      ) : (
        <ol className="divide-y">
          {activity.data.slice(0, 9).map((a) => {
            const s = space(a.spaceId);
            const href = a.path ? `/spaces/${a.spaceId}?path=${encodeURIComponent(a.path)}` : `/spaces/${a.spaceId}`;
            return (
              <li key={a.id}>
                <Link href={href} className="flex gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50">
                  <UserAvatar login={a.actor} name={nameOf(a.actor)} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5">
                      <ActivityText actor={nameOf(a.actor)} summary={a.summary} type={a.type} spaceName={s?.name} people={people.data?.people} rules={allRules.data} />
                    </p>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
                      {s && <KindGlyph kind={s.kind} size="xs" label={false} />}
                      <span className="truncate">{s?.name ?? a.spaceId}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{timeAgo(a.date)}</span>
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export default function HomePage() {
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const { data: actionable } = useActionableRules();
  const mine = (spaces ?? []).filter((s) => s.myAccess !== "none");
  const needs =
    (actionable?.length ?? 0) +
    mine.filter((s) => s.repo && s.sync.state !== "synced" && s.sync.state !== "no-remote").length;
  usePageTitle("Home");

  return (
    <Page>
      <header className="mb-8">
        {me && spaces ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">
              {greeting()}, {firstName(me.name)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {needs === 0 ? "Nothing needs you" : `${needs} ${needs === 1 ? "thing needs" : "things need"} you`} ·{" "}
              {mine.length} {mine.length === 1 ? "space" : "spaces"}
            </p>
          </>
        ) : (
          <>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="mt-2 h-4 w-80" />
          </>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <NeedsYou />
          <YourSpaces />
        </div>
        <div className="min-w-0">
          <RecentActivity />
        </div>
      </div>
    </Page>
  );
}
