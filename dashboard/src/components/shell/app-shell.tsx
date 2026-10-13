"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMe } from "@/lib/queries";
import { SidebarContent } from "./sidebar";
import { OrgMark } from "./org-header";
import { CommandPalette } from "./command-palette";
import { AddSpaceDialog } from "@/components/space/add-space-dialog";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { setPaletteOpen, paletteOpen, mobileNavOpen, setMobileNavOpen, dirty, pendingAction, resolvePending, guard } = useAppState();
  const router = useRouter();
  const { data: me } = useMe();

  // ⌘K / Ctrl+K opens the command palette from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  // Unsaved-changes guard: in-app links ask first; reloads and tab closes get the browser prompt.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirty.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      if (a.closest("[data-editor-root]")) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.pathname + a.search + a.hash;
      guard(() => router.push(href));
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty.current) e.preventDefault();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, guard, router]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm shadow-float focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside aria-label="Sidebar" className="hidden w-14 shrink-0 border-r bg-sidebar md:flex xl:hidden">
        <SidebarContent collapsed />
      </aside>
      <aside aria-label="Sidebar" className="hidden w-[248px] shrink-0 border-r bg-sidebar xl:flex xl:flex-col">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
            <Menu />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {me && <OrgMark name={me.org.name} className="size-6 rounded-md text-xs" />}
            <span className="truncate text-sm font-semibold">{me?.org.name ?? "SelfHub"}</span>
          </div>
          <Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Search />
          </Button>
        </header>

        <main id="main" tabIndex={-1} className="scroll-thin min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[284px] max-w-[85vw] gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Spaces, people, rules and settings</SheetDescription>
          <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <CommandPalette />
      <AddSpaceDialog />

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && resolvePending(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to this file haven&apos;t been saved. If you leave now, they&apos;ll be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => resolvePending(true)}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
