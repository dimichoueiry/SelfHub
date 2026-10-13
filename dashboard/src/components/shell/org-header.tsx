"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export function OrgMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-kind-org text-[13px] font-semibold text-background",
        className,
      )}
    >
      {/* CSS-drawn: decorative, so it isn't read as part of a button's name. */}
      <span data-mono={name.charAt(0)} className="before:content-[attr(data-mono)]" />
    </span>
  );
}

export function OrgHeader({ collapsed }: { collapsed: boolean }) {
  const { data: me } = useMe();
  if (!me) {
    return (
      <div className={cn("flex items-center gap-2.5", !collapsed && "w-full px-1")}>
        <Skeleton className="size-7 rounded-lg" />
        {!collapsed && <Skeleton className="h-3.5 w-24" />}
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={collapsed ? `${me.org.name}, organization menu` : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-left transition-colors duration-150 hover:bg-sidebar-accent",
          collapsed ? "size-9 justify-center" : "h-9 w-full px-1.5",
        )}
      >
        <OrgMark name={me.org.name} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{me.org.name}</span>
            <ChevronsUpDown className="size-3.5 text-subtle-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organizations</DropdownMenuLabel>
        <DropdownMenuItem>
          <OrgMark name={me.org.name} className="size-5 rounded-md text-[10px]" />
          {me.org.name}
          <Check className="ml-auto size-4" />
        </DropdownMenuItem>
        <DropdownMenuItem disabled>Other organizations appear here when you join them</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
