"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Lock, Plus, RefreshCw, ScrollText, Search, Settings, Users2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionableRules, useSpaces } from "@/lib/queries";
import { useModKey } from "@/lib/use-mod-key";
import { kindGroupLabel, kindOrder, syncInfo } from "@/lib/labels";
import { timeAgo } from "@/lib/format";
import type { Space } from "@/lib/api/types";
import { KindGlyph, monogram } from "@/components/space/kind-glyph";
import { SyncIcon } from "@/components/space/sync-status";
import { useSyncAll } from "@/components/space/use-sync";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgHeader } from "./org-header";
import { UserMenu } from "./user-menu";

function RailTip({ label, children, show }: { label: string; children: React.ReactNode; show: boolean }) {
  if (!show) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  collapsed,
  badge,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <RailTip label={badge ? `${label} · ${badge} waiting for you` : label} show={collapsed}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? (badge ? `${label}, ${badge} waiting for you` : label) : undefined}
        className={cn(
          "group relative flex h-8 items-center gap-2.5 rounded-md text-sm text-muted-foreground transition-colors duration-150 max-md:h-10",
          "hover:bg-sidebar-accent hover:text-foreground",
          collapsed ? "w-9 justify-center" : "px-2",
          active && "bg-sidebar-accent font-medium text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.9} />
        {!collapsed && <span className="truncate">{label}</span>}
        {!!badge && !collapsed && (
          <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
            {badge}
            <span className="sr-only"> waiting for you</span>
          </span>
        )}
        {!!badge && collapsed && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-sidebar tabular-nums"
          >
            {badge}
          </span>
        )}
      </Link>
    </RailTip>
  );
}

function SpaceItem({ space, collapsed, onNavigate }: { space: Space; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname.startsWith(`/spaces/${space.id}`);
  const noAccess = space.myAccess === "none";
  const status = noAccess ? "No access" : syncInfo(space, timeAgo(space.sync.lastSyncAt)).label;
  return (
    <RailTip label={`${space.name} · ${status}`} show={collapsed}>
      <Link
        href={`/spaces/${space.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? `${space.name}, ${status}` : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-md text-sm transition-colors duration-150 max-md:h-10",
          "text-foreground/85 hover:bg-sidebar-accent hover:text-foreground",
          collapsed ? "size-9 justify-center" : "px-2",
          active && "bg-sidebar-accent font-medium text-foreground",
          noAccess && "text-muted-foreground",
        )}
      >
        <span className="relative inline-flex">
          {collapsed ? (
            <KindGlyph kind={space.kind} monogram={monogram(space.name)} label={false} />
          ) : (
            <KindGlyph kind={space.kind} size="sm" label={false} className={cn(noAccess && "opacity-60")} />
          )}
          {collapsed && (
            <span className="absolute -right-1.5 -bottom-1.5">
              {noAccess ? (
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-sidebar">
                  <Lock className="size-3 text-subtle-foreground" strokeWidth={2.5} aria-hidden />
                </span>
              ) : space.sync.state !== "synced" ? (
                <SyncIcon space={space} badge />
              ) : null}
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{space.name}</span>
            {noAccess ? (
              <>
                <Lock className="size-3 text-subtle-foreground" aria-hidden />
                <span className="sr-only">No access</span>
              </>
            ) : (
              <SyncIcon space={space} />
            )}
          </>
        )}
      </Link>
    </RailTip>
  );
}

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { data: spaces, isLoading } = useSpaces();
  const { data: actionable } = useActionableRules();
  const mod = useModKey();
  const searchHintId = useId();
  const { setPaletteOpen, setAddSpaceOpen } = useAppState();
  const { syncAll, running } = useSyncAll();

  const groups = kindOrder
    .map((kind) => ({ kind, items: (spaces ?? []).filter((s) => s.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className={cn("flex h-full flex-col", collapsed ? "items-center" : "")}>
      {/* In the mobile drawer the sheet's close button sits top-right; leave room for it. */}
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-3", onNavigate && "pr-12")}>
        <OrgHeader collapsed={collapsed} />
      </div>

      <div className={cn("shrink-0", collapsed ? "pb-2" : "px-3 pb-2")}>
        <RailTip label={`Search (${mod} K)`} show={collapsed}>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              setPaletteOpen(true);
            }}
            aria-label={collapsed ? "Search" : undefined}
            aria-describedby={searchHintId}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md border bg-surface text-sm max-md:h-10 text-muted-foreground transition-colors duration-150 hover:border-border-strong hover:text-foreground",
              collapsed ? "w-9 justify-center" : "w-full px-2",
            )}
          >
            <Search className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search</span>
                <Kbd className="h-5 bg-muted text-[11px]">{mod === "⌘" ? "⌘K" : "Ctrl K"}</Kbd>
              </>
            )}
          </button>
        </RailTip>
      </div>

      <span id={searchHintId} className="sr-only">
        Search files, spaces and actions
      </span>
      <nav aria-label="Main" className={cn("scroll-thin min-h-0 flex-1 overflow-y-auto", collapsed ? "w-full px-2.5" : "px-3")}>
        <div className={cn("flex flex-col gap-px py-1", collapsed && "items-center")}>
          <NavItem href="/" icon={Home} label="Home" collapsed={collapsed} onNavigate={onNavigate} />
        </div>

        <div className={cn("mt-4 mb-1 flex items-center", collapsed ? "justify-center" : "justify-between pl-2")}>
          {!collapsed && <span className="text-xs font-medium text-subtle-foreground">Spaces</span>}
          <div className={cn("flex items-center", collapsed && "flex-col gap-1")}>
            <RailTip label="Sync all spaces now: get teammates' changes and send yours" show>
              <Button variant="ghost" size="icon-xs" onClick={syncAll} disabled={running} aria-label="Sync all spaces now" className="text-muted-foreground">
                <RefreshCw className={cn(running && "animate-spin")} />
              </Button>
            </RailTip>
            <RailTip label="Add space" show>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  onNavigate?.();
                  setAddSpaceOpen(true);
                }}
                aria-label="Add space"
                className="text-muted-foreground"
              >
                <Plus />
              </Button>
            </RailTip>
          </div>
        </div>

        {isLoading && (
          <div className={cn("flex flex-col gap-1.5 py-1", collapsed ? "items-center" : "px-2")}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex h-7 items-center gap-2.5">
                <Skeleton className="size-5 rounded-[5px]" />
                {!collapsed && <Skeleton className="h-3" style={{ width: `${50 + ((i * 37) % 40)}%` }} />}
              </div>
            ))}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.kind} className={cn("mt-2", collapsed && "border-t border-border/70 pt-2 first:border-0")}>
            {!collapsed && (
              <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-[0.04em] text-subtle-foreground uppercase">
                {kindGroupLabel[g.kind]}
              </div>
            )}
            <ul className={cn("flex flex-col gap-px", collapsed && "items-center")} aria-label={kindGroupLabel[g.kind]}>
              {g.items.map((s) => (
                <li key={s.id}>
                  <SpaceItem space={s} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className={cn("mt-5 flex flex-col gap-px border-t pt-3 pb-2", collapsed && "items-center")}>
          <NavItem href="/people" icon={Users2} label="People & access" collapsed={collapsed} onNavigate={onNavigate} />
          <NavItem href="/rules" icon={ScrollText} label="Rules" collapsed={collapsed} badge={actionable?.length} onNavigate={onNavigate} />
        </div>
      </nav>

      <div className={cn("shrink-0 border-t py-2", collapsed ? "flex w-full flex-col items-center gap-1 px-2.5" : "px-3")}>
        <NavItem href="/settings" icon={Settings} label="Settings" collapsed={collapsed} onNavigate={onNavigate} />
        <div className="mt-1">
          <UserMenu collapsed={collapsed} />
        </div>
      </div>
    </div>
  );
}
