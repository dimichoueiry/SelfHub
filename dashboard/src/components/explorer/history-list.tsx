"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { useDiff, useHistory, usePeople, useRules } from "@/lib/queries";
import { cleanSentence } from "@/lib/plain";
import { fullDate, timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/user-avatar";
import { DiffView } from "@/components/common/diff-view";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";

/** "+18 −1", hiding a side that's zero. */
function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="ml-auto shrink-0 tabular-nums">
      {additions > 0 && <span className="text-success-text">+{additions}</span>}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && <span className="text-danger-text">−{deletions}</span>}
      <span className="sr-only">
        {additions} lines added, {deletions} removed
      </span>
    </span>
  );
}

/** Change list plus diff. Used for one file (path) or the whole space. */
export function HistoryPanel({ spaceId, path, onOpenFile }: { spaceId: string; path?: string; onOpenFile?: (path: string) => void }) {
  const history = useHistory(spaceId, path);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? history.data?.[0]?.sha ?? null;
  const diff = useDiff(spaceId, selected);
  const entry = history.data?.find((h) => h.sha === selected);
  const people = usePeople();
  const rules = useRules();
  const clean = (m: string) => cleanSentence(m, people.data?.people, rules.data);

  if (history.isLoading) {
    return (
      <div className="grid gap-4 px-5 py-6 md:px-8 xl:grid-cols-[340px_minmax(0,1fr)]" aria-busy="true">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }
  if (history.error) return <ErrorState error={history.error} title="Couldn't load the history" onRetry={() => history.refetch()} />;
  if (!history.data?.length) {
    return (
      <EmptyState icon={History} title="No changes yet">
        Every save shows up here with who made it and what changed.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4 px-5 py-6 md:px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
      <ol aria-label="Changes" className="flex min-w-0 flex-col gap-1 xl:max-h-[calc(100dvh-220px)] xl:overflow-y-auto xl:scroll-thin">
        {history.data.map((h) => {
          const active = h.sha === selected;
          return (
            <li key={h.sha}>
              <button
                type="button"
                onClick={() => setPicked(h.sha)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/60",
                  active && "border-border bg-surface hover:bg-surface",
                )}
              >
                <UserAvatar login={h.author.login} name={h.author.name} avatarUrl={h.author.avatarUrl} size="sm" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{clean(h.message)}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{h.author.name}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={h.date} title={fullDate(h.date)} className="shrink-0">
                      {timeAgo(h.date)}
                    </time>
                    <Counts additions={h.additions} deletions={h.deletions} />
                  </span>
                  {!path && h.path && <span className="mt-0.5 block truncate text-xs text-subtle-foreground">{h.path.split("/").pop()}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="min-w-0">
        {entry && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{clean(entry.message)}</p>
              <p className="text-xs text-muted-foreground">
                {entry.author.name} · {fullDate(entry.date)}
              </p>
            </div>
            {!path && entry.path && onOpenFile && (
              <Button variant="outline" size="sm" onClick={() => onOpenFile(entry.path!)}>
                Open file
              </Button>
            )}
          </div>
        )}
        {diff.isLoading ? (
          <Skeleton className="h-64 rounded-lg" />
        ) : diff.error ? (
          <ErrorState error={diff.error} title="Couldn't load this change" onRetry={() => diff.refetch()} />
        ) : diff.data ? (
          <DiffView patch={diff.data.patch} emptyText={entry && /^(rename|move)/i.test(entry.message) ? "Only the name changed. The text is the same." : undefined} />
        ) : null}
      </div>
    </div>
  );
}
