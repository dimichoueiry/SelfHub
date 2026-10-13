"use client";

import { useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { useTheme } from "next-themes";
import {
  FileText,
  Home,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Sun,
  UserRound,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { KindGlyph } from "@/components/space/kind-glyph";
import { useSyncAll } from "@/components/space/use-sync";
import { useMe, useSearch, useSpaces } from "@/lib/queries";
import { kindLabel } from "@/lib/labels";
import { getDemoUser, setDemoUser } from "@/lib/demo-user";
import { demoFallback, useDemoPeople } from "@/lib/use-demo-people";
import { cn } from "@/lib/utils";
import { plainText } from "@/lib/plain";

interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

const itemClass =
  "group flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[selected=true]:bg-primary-soft data-[selected=true]:text-foreground data-[disabled=true]:opacity-50";

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="px-1.5 pb-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-subtle-foreground [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </CommandPrimitive.Group>
  );
}

/** Highlight query terms inside a snippet without dangerouslySetInnerHTML. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-primary/12 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, paletteOpener, markPaletteNavigated, takePaletteNavigated, setAddSpaceOpen, guard } = useAppState();
  // After choosing a destination, focus goes to the new page; after Escape, back to the opener.
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: spaces } = useSpaces();
  const { data: me } = useMe();
  const { syncAll } = useSyncAll();
  const demoPeople = useDemoPeople();
  const search = useSearch(deferred);

  const close = () => {
    setPaletteOpen(false);
    setQuery("");
  };
  const go = (href: string) => {
    markPaletteNavigated();
    close();
    guard(() => router.push(href));
  };

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  const spaceItems = (spaces ?? []).filter((s) => matches(s.name) || matches(kindLabel[s.kind]));
  const nav: Action[] = [
    { id: "home", label: "Home", icon: Home, run: () => go("/") },
    { id: "people", label: "People & access", icon: Users2, run: () => go("/people") },
    { id: "rules", label: "Rules", icon: ScrollText, run: () => go("/rules") },
    { id: "settings", label: "Settings", icon: Settings, run: () => go("/settings") },
  ].filter((a) => matches(a.label));
  const actions: Action[] = [
    {
      id: "add-space",
      label: "Add a space",
      hint: "Connect a space from GitHub or start a new one",
      icon: Plus,
      run: () => {
        close();
        setAddSpaceOpen(true);
      },
    },
    { id: "sync-all", label: "Sync now", hint: "Get teammates' changes and send yours", icon: RefreshCw, run: () => (close(), syncAll()) },
    {
      id: "theme",
      label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolvedTheme === "dark" ? Sun : Moon,
      run: () => (close(), setTheme(resolvedTheme === "dark" ? "light" : "dark")),
    },
    me?.mode === "demo" && {
      id: "switch-user",
      label: `View the demo as ${demoPeople[getDemoUser() === "maya" ? "sam" : "maya"]?.name ?? demoFallback[getDemoUser() === "maya" ? "sam" : "maya"]}`,
      icon: UserRound,
      run: () => {
        close();
        guard(() => {
          setDemoUser(getDemoUser() === "maya" ? "sam" : "maya");
          router.push("/");
        });
      },
    },
  ].filter((a): a is Action => !!a && (matches(a.label) || (!!a.hint && matches(a.hint))));

  const files = q.length > 1 ? (search.data ?? []) : [];
  const spaceName = (id: string) => spaces?.find((s) => s.id === id)?.name ?? id;
  const spaceKind = (id: string) => spaces?.find((s) => s.id === id)?.kind ?? "team";
  const searching = q.length > 1 && (search.isFetching || deferred !== query);
  const nothing = !files.length && !spaceItems.length && !nav.length && !actions.length && !searching;

  return (
    <Dialog open={paletteOpen} onOpenChange={(o) => (o ? setPaletteOpen(true) : close())}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const target = takePaletteNavigated() ? document.getElementById("main") : paletteOpener.current;
          requestAnimationFrame(() => (target && target.isConnected ? target : document.getElementById("main"))?.focus());
        }}
        className="top-[12vh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[620px]"
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">Search files across your spaces, jump to a space, or run an action.</DialogDescription>
        <CommandPrimitive shouldFilter={false} loop className="flex flex-col" label="Search and commands">
          <div className="flex items-center gap-2.5 border-b px-4">
            {searching ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search files, spaces and actions…"
              className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-subtle-foreground"
            />
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </div>
          <CommandPrimitive.List className="scroll-thin max-h-[min(60vh,460px)] overflow-y-auto py-1">
            {nothing && (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium">No results for &ldquo;{query}&rdquo;</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Search only covers spaces you can open. Try a different word, or check the spelling.
                </p>
              </div>
            )}

            {files.length > 0 && (
              <Group heading="Files">
                {files.map((hit) => (
                  <CommandPrimitive.Item
                    key={`${hit.spaceId}:${hit.path}`}
                    value={`file:${hit.spaceId}:${hit.path}`}
                    onSelect={() => go(`/spaces/${hit.spaceId}?path=${encodeURIComponent(hit.path)}`)}
                    className={cn(itemClass, "items-start")}
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-medium">{plainText(hit.title)}</span>
                        <span className="flex min-w-0 shrink items-center gap-1.5 text-xs text-muted-foreground">
                          <KindGlyph kind={spaceKind(hit.spaceId)} size="xs" label={false} className="translate-y-[3px]" />
                          <span className="truncate">{spaceName(hit.spaceId)}</span>
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        <Highlight text={plainText(hit.snippet)} query={q} />
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-subtle-foreground">{hit.path}</p>
                    </div>
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}

            {spaceItems.length > 0 && (
              <Group heading="Spaces">
                {spaceItems.slice(0, q ? 6 : 8).map((s) => (
                  <CommandPrimitive.Item key={s.id} value={`space:${s.id}`} onSelect={() => go(`/spaces/${s.id}`)} className={itemClass}>
                    <KindGlyph kind={s.kind} size="sm" label={false} />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {s.myAccess === "none" ? "No access" : kindLabel[s.kind]}
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}

            {actions.length > 0 && (
              <Group heading="Actions">
                {actions.map((a) => (
                  <CommandPrimitive.Item key={a.id} value={`action:${a.id}`} onSelect={a.run} className={itemClass}>
                    <a.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.label}</span>
                    {a.hint && <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">{a.hint}</span>}
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}

            {nav.length > 0 && (
              <Group heading="Go to">
                {nav.map((a) => (
                  <CommandPrimitive.Item key={a.id} value={`nav:${a.id}`} onSelect={a.run} className={itemClass}>
                    <a.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span>{a.label}</span>
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}
          </CommandPrimitive.List>
          <div className="hidden items-center gap-4 border-t bg-muted/40 px-4 py-2 text-[11px] text-subtle-foreground sm:flex">
            <span className="flex items-center gap-1.5">
              <Kbd className="h-4.5 min-w-4.5 text-[10px]">↑</Kbd>
              <Kbd className="h-4.5 min-w-4.5 text-[10px]">↓</Kbd> to move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd className="h-4.5 text-[10px]">↵</Kbd> to open
            </span>
            <span className="ml-auto">Searches every space you can open</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
