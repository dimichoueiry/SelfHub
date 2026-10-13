"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/use-page-title";
import { useFile } from "@/lib/queries";
import type { Space } from "@/lib/api/types";
import { useParams, usePathname } from "next/navigation";
import { ExternalLink, SearchX } from "lucide-react";
import { useSpace } from "@/lib/queries";
import { kindLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { KindGlyph } from "@/components/space/kind-glyph";
import { SyncButton } from "@/components/space/sync-status";
import { AccessChip } from "@/components/space/access-chip";
import { EmptyState, ErrorState } from "@/components/common/states";
import { NoAccessState } from "@/components/common/no-access";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function SpaceLayout({ children }: { children: React.ReactNode }) {
  const { spaceId } = useParams<{ spaceId: string }>();
  const pathname = usePathname();
  const { data: space, isLoading, isFetching, error, refetch } = useSpace(spaceId);
  // An unknown id in a cached list may just be a space added a moment ago: check once.
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoading && !space && !error && checked.current !== spaceId) {
      checked.current = spaceId;
      refetch();
    }
  }, [isLoading, space, error, spaceId, refetch]);

  // Don't call a space missing while a fresher list is still on its way.
  if (isLoading || (!space && !error && isFetching)) {
    return (
      <div className="border-b px-5 pt-5 md:px-8" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="mt-5 flex gap-6 pb-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-14" />
          ))}
        </div>
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="py-24" />;
  if (!space) {
    return (
      <EmptyState
        icon={SearchX}
        title="This space doesn't exist"
        className="py-24"
        action={
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        }
      >
        It may have been removed, or the link is wrong.
      </EmptyState>
    );
  }

  const base = `/spaces/${space.id}`;
  const tabName = pathname.startsWith(`${base}/history`)
    ? "History"
    : pathname.startsWith(`${base}/members`)
      ? "Members"
      : pathname.startsWith(`${base}/settings`)
        ? "Settings"
        : null;
  const tabs = [
    { href: base, label: "Files", active: pathname === base },
    { href: `${base}/history`, label: "History", active: pathname.startsWith(`${base}/history`) },
    { href: `${base}/members`, label: "Members", active: pathname.startsWith(`${base}/members`) },
    { href: `${base}/settings`, label: "Settings", active: pathname.startsWith(`${base}/settings`) },
  ];
  const noAccess = space.myAccess === "none";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense>
        <SpaceTitle name={space.name} tab={tabName} />
      </Suspense>
      <div className="shrink-0 border-b bg-background px-5 pt-4 md:px-8 md:pt-5">
        <div className="flex max-w-[1120px] flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <KindGlyph kind={space.kind} size="lg" label={false} />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">{space.name}</h1>
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>{kindLabel[space.kind]} space</span>
                {/* A space that isn't on GitHub has nothing to link to, whatever its manifest says. */}
                {space.repo && space.sync.state !== "no-remote" && (
                  <>
                    <span aria-hidden>·</span>
                    <a
                      href={space.repo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 font-mono text-[11.5px] hover:text-foreground max-md:min-h-10 max-md:py-3"
                    >
                      <span className="truncate">
                        {space.repo.owner}/{space.repo.name}
                      </span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                      <span className="sr-only">(opens GitHub)</span>
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Suspense fallback={<AccessChip space={space} />}>
              <SpaceAccessChip space={space} onFiles={pathname === base} />
            </Suspense>
            {!noAccess && <SyncButton space={space} />}
          </div>
        </div>
        {!noAccess && (
          <nav aria-label={`${space.name} sections`} className="-mb-px mt-3 -ml-2.5 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t.active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 max-md:h-10 shrink-0 items-center rounded-t-md px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground",
                  t.active && "font-medium text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
        {noAccess && <div className="h-4" />}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{noAccess ? <NoAccessState space={space} /> : children}</div>
    </div>
  );
}

function SpaceTitle({ name, tab }: { name: string; tab: string | null }) {
  const path = useSearchParams().get("path");
  usePageTitle(name, tab ?? path?.split("/").pop());
  return null;
}

/** On the Files tab, the chip follows the open file: a locked file says so. */
function SpaceAccessChip({ space, onFiles }: { space: Space; onFiles: boolean }) {
  const path = useSearchParams().get("path");
  const file = useFile(space.id, onFiles && space.myAccess !== "none" ? path : null);
  return <AccessChip space={space} lockedFile={onFiles && !!file.data?.locked} />;
}
