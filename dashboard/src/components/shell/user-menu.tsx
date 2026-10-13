"use client";

import { ChevronsUpDown, FlaskConical, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/queries";
import { apiMode } from "@/lib/api/client";
import { simulateConflictOnNextSave } from "@/lib/api/mock/adapter";
import { getDemoUser, serverDemoUser, setDemoUser, subscribeDemoUser, type DemoUser } from "@/lib/demo-user";
import { useSyncExternalStore } from "react";
import { demoFallback, useDemoPeople } from "@/lib/use-demo-people";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppState } from "@/components/app-state";

export function DemoPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-full border border-warning/40 bg-warning/12 px-1.5 text-[10px] font-semibold tracking-[0.04em] text-warning-text uppercase",
        className,
      )}
    >
      Demo
    </span>
  );
}

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { guard } = useAppState();
  const demoUser = useSyncExternalStore(subscribeDemoUser, getDemoUser, serverDemoUser);
  const demoPeople = useDemoPeople();

  if (!me) {
    return (
      <div className={cn("flex h-10 items-center gap-2.5", !collapsed && "px-2")}>
        <Skeleton className="size-6 rounded-full" />
        {!collapsed && <Skeleton className="h-3 w-20" />}
      </div>
    );
  }

  const switchUser = (user: string) =>
    guard(() => {
      setDemoUser(user as DemoUser);
      router.push("/");
      const who = demoPeople[user as DemoUser];
      toast.info(`You're now viewing as ${who?.name ?? demoFallback[user as DemoUser]}`, {
        description: "Everything on screen reloads with their access.",
      });
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // Expanded: the visible name is the accessible name. Collapsed (icon only): label it.
        aria-label={collapsed ? `${me.name}, account menu` : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-left transition-colors duration-150 hover:bg-sidebar-accent",
          collapsed ? "size-9 justify-center" : "h-10 w-full px-2",
        )}
      >
        <UserAvatar login={me.login} name={me.name} avatarUrl={me.avatarUrl} size="sm" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight">{me.name}</span>
              <span className="block truncate text-[11px] leading-tight text-subtle-foreground">@{me.login}</span>
            </span>
            {me.mode === "demo" && <DemoPill />}
            <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-64">
        {me.mode === "demo" && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">View the demo as</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={demoUser} onValueChange={switchUser}>
              {(["sam", "maya"] as const).map((u) => (
                <DropdownMenuRadioItem key={u} value={u}>
                  <span className="flex flex-col">
                    <span>{demoPeople[u]?.name ?? demoFallback[u]}</span>
                    <span className="text-xs text-muted-foreground">
                      {u === "maya" ? "Admin of every space" : (demoPeople[u]?.title ?? "Can edit some spaces")}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> Match system
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {apiMode === "mock" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                simulateConflictOnNextSave();
                toast.info("The next save will hit a conflict", {
                  description: "As if a teammate saved the same file while you were editing.",
                });
              }}
            >
              <FlaskConical />
              Simulate a conflict on next save
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
