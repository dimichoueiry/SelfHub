"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { changeAccess } from "@/lib/access-change";
import { usePageTitle } from "@/lib/use-page-title";
import { useReturnFocus } from "@/lib/use-return-focus";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ChevronRight, Loader2, Lock, Search, Users2 } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { errorText } from "@/lib/api/errors";
import type { Person, Role, Space, SpaceKind } from "@/lib/api/types";
import { keys, useMe, usePeople } from "@/lib/queries";
import { kindGroupLabel, kindOrder, roleHelp, roleLabel, rolePhrase } from "@/lib/labels";
import { firstName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/common/page";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { KindGlyph } from "@/components/space/kind-glyph";
import { RolePill } from "@/components/space/role-pill";
import { RoleLegend } from "@/components/people/members-panel";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Filter = "all" | Exclude<SpaceKind, "personal">;
type Access = Role | "none";

function AccessSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Access;
  onChange: (v: Access) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Access)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={label} className="w-[108px] sm:w-[124px]">
        <SelectValue>{roleLabel[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {(["admin", "write", "read", "none"] as Access[]).map((r) => (
          <SelectItem key={r} value={r}>
            <span className="flex flex-col">
              <span>{roleLabel[r]}</span>
              <span className="text-xs text-muted-foreground">{roleHelp[r]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PersonDrawer({
  person,
  spaces,
  access,
  onOpenChange,
  onCloseAutoFocus,
}: {
  person: Person | null;
  spaces: Space[];
  access: Record<string, Access>;
  onOpenChange: (o: boolean) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const confirmFocus = useReturnFocus();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  // Members of the spaces you administer: tells us which grants come from a GitHub team,
  // which can't be changed per person (the API answers 409 via-team).
  const managed = spaces.filter((s) => s.myAccess === "admin");
  const memberLists = useQueries({
    queries: managed.map((s) => ({
      queryKey: keys.members(s.id),
      queryFn: () => getApi().members(s.id),
      enabled: !!person,
    })),
  });
  const grantOf = (spaceId: string) => {
    const i = managed.findIndex((s) => s.id === spaceId);
    return i < 0 ? undefined : memberLists[i]?.data?.find((m) => m.login === person?.login);
  };

  const [confirmRemove, setConfirmRemove] = useState<Space | null>(null);

  async function apply(space: Space, from: Access, to: Access, who: Person) {
    const list = await changeAccess(space.id, who.login, from, to);
    if (Array.isArray(list)) qc.setQueryData(keys.members(space.id), list);
    await qc.invalidateQueries({ queryKey: keys.people });
    qc.invalidateQueries({ queryKey: keys.spaces });
    qc.invalidateQueries({ queryKey: keys.activity });
  }

  async function change(space: Space, next: Access, confirmed = false) {
    if (!person) return;
    const current = access[space.id] ?? "none";
    if (next === current) return;
    // Removing access is destructive: confirm first, like the Members tab does.
    if (next === "none" && !confirmed) {
      // Open after the select has closed, so the Enter that picked "No access" can't also
      // press a button in the dialog. Focus returns to this select afterwards.
      const label = `${person.name}'s access to ${space.name}`;
      setTimeout(() => {
        confirmFocus.capture(document.querySelector<HTMLElement>(`[role="combobox"][aria-label="${CSS.escape(label)}"]`));
        setConfirmRemove(space);
      }, 0);
      return;
    }
    const who = person;
    setBusy(space.id);
    try {
      await apply(space, current, next, who);
      toast.success(
        next === "none"
          ? `${firstName(who.name)} no longer has access to ${space.name}`
          : `${firstName(who.name)} ${rolePhrase[next]} ${space.name}`,
        {
          description: next === "none" ? "They lost access on GitHub too." : "Updated on GitHub.",
          action: {
            label: "Undo",
            onClick: () =>
              apply(space, next, current, who)
                .then(() => toast.success(`Undone. ${firstName(who.name)} is back to ${roleLabel[current]} in ${space.name}.`))
                .catch((e) => toast.error("Couldn't undo", { description: errorText(e) })),
          },
          duration: 8000,
        },
      );
    } catch (e) {
      toast.error(`Couldn't change ${firstName(person.name)}'s access`, {
        description: errorText(e),
      });
    } finally {
      setBusy(null);
    }
  }

  const count = Object.values(access).filter((a) => a !== "none").length;

  return (
    <Sheet open={!!person} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[420px]" onCloseAutoFocus={onCloseAutoFocus}>
        {person && (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-center gap-3">
                <UserAvatar login={person.login} name={person.name} avatarUrl={person.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base font-semibold">{person.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    @{person.login}
                    {person.title && <> · {person.title}</>}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
              <p className="mb-3 text-sm text-muted-foreground">
                {firstName(person.name)} can open {count} of {spaces.length} spaces.
              </p>
              <ul className="divide-y rounded-xl border bg-surface">
                {spaces.map((s) => {
                  const a = access[s.id] ?? "none";
                  const grant = grantOf(s.id);
                  const viaTeam = grant?.via === "team";
                  const canManage = s.myAccess === "admin" && person.login !== me?.login && !viaTeam;
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <KindGlyph kind={s.kind} size="sm" label={false} />
                      <span className="min-w-0 flex-1">
                        <Link href={`/spaces/${s.id}/members`} className="block text-sm hover:underline" onClick={() => onOpenChange(false)}>
                          {s.name}
                        </Link>
                        {viaTeam && (
                          <span className="block text-xs text-muted-foreground">
                            Via the {grant?.team ?? "GitHub"} team. Change it on the team in GitHub.
                          </span>
                        )}
                      </span>
                      {busy === s.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
                      {canManage ? (
                        <AccessSelect value={a} onChange={(v) => change(s, v)} disabled={busy === s.id} label={`${person.name}'s access to ${s.name}`} />
                      ) : (
                        <RolePill role={a} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4">
                <RoleLegend />
              </div>
            </div>
          </>
        )}
      </SheetContent>
      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent
          // Start on the dialog itself, not on a button: a stray keypress can't confirm or cancel.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onCloseAutoFocus={(e) => confirmFocus.restore(e)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {person?.name} from {confirmRemove?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access on GitHub, and their agents stop loading this space. You can add them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="danger"
              onClick={() => {
                const s = confirmRemove;
                setConfirmRemove(null);
                if (s) change(s, "none", true);
              }}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

export default function PeoplePage() {
  const people = usePeople();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openLogin, setOpenLogin] = useState<string | null>(null);
  const drawerFocus = useReturnFocus();

  const spaces = useMemo(
    () =>
      (people.data?.spaces ?? [])
        .filter((s) => filter === "all" || s.kind === filter)
        .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)),
    [people.data, filter],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people.data?.people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.login.toLowerCase().includes(q));
  }, [people.data, query]);

  const adminAnywhere = people.data?.spaces.some((s) => s.myAccess === "admin");
  const person = people.data?.people.find((p) => p.login === openLogin) ?? null;
  // Who to ask: the admins of the company space.
  const orgSpace = people.data?.spaces.find((s) => s.kind === "org");
  const orgAdmins = orgSpace ? (people.data?.people ?? []).filter((p) => people.data?.access[p.login]?.[orgSpace.id] === "admin") : [];
  usePageTitle("People & access");

  return (
    <Page>
      <PageHeader
        title="People & access"
        description="Who can open and change each space. This mirrors GitHub, so it's always the real answer."
      />

      {people.data && !adminAnywhere && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border bg-muted/50 px-3.5 py-3 text-sm" role="note">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            You can see who has access. Only admins can change it.{" "}
            {orgAdmins.length > 0
              ? `Ask ${new Intl.ListFormat("en", { type: "disjunction" }).format(orgAdmins.map((p) => p.name))} if someone needs to be added or removed.`
              : "Ask an admin if someone needs to be added or removed."}
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="h-8 pl-8"
          />
        </div>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" size="sm" aria-label="Show spaces">
          <ToggleGroupItem value="all">All spaces</ToggleGroupItem>
          {(["org", "team", "client"] as const).map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {kindGroupLabel[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {people.isLoading ? (
        <div className="overflow-hidden rounded-xl border bg-surface" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-36" />
              <div className="ml-auto flex gap-6">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-5 w-16" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : people.error ? (
        <ErrorState error={people.error} title="Couldn't load people and access" onRetry={() => people.refetch()} />
      ) : !rows.length ? (
        <div className="rounded-xl border bg-surface">
          <EmptyState icon={Users2} title={query ? `Nobody matches "${query}"` : "No people yet"}>
            {query ? "Check the spelling, or search by GitHub username." : "People appear here once they're added to a space on GitHub."}
          </EmptyState>
        </div>
      ) : (
        <div className="scroll-thin relative overflow-x-auto rounded-xl border bg-surface">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Access by person and space. Select a person to see details.</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-[164px] border-b sm:min-w-[220px] bg-surface px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
                >
                  Person
                </th>
                {spaces.map((s) => (
                  <th key={s.id} scope="col" className="min-w-[116px] border-b px-3 py-2.5 text-left align-bottom">
                    <Link href={`/spaces/${s.id}/members`} className="inline-flex max-w-[140px] items-center gap-1.5 text-xs font-medium hover:underline max-md:py-3">
                      <KindGlyph kind={s.kind} size="xs" label={false} />
                      <span className="truncate" title={s.name}>
                        {s.name}
                      </span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.login} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b bg-surface p-0 text-left font-normal group-last:border-b-0 group-hover:bg-muted"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        drawerFocus.capture(e.currentTarget);
                        setOpenLogin(p.login);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left max-md:min-h-10"
                      aria-describedby="person-row-hint"
                    >
                      <UserAvatar login={p.login} name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block max-w-[120px] truncate text-xs text-muted-foreground sm:max-w-none">{p.title ?? `@${p.login}`}</span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground opacity-0 group-hover:opacity-100" aria-hidden />
                    </button>
                  </th>
                  {spaces.map((s) => (
                    <td
                      key={s.id}
                      className={cn("border-b px-3 py-2 group-last:border-b-0 group-hover:bg-muted/50", adminAnywhere && "cursor-pointer")}
                      onClick={
                        adminAnywhere
                          ? (e) => {
                              drawerFocus.capture(e.currentTarget.parentElement?.querySelector<HTMLElement>("th button"));
                              setOpenLogin(p.login);
                            }
                          : undefined
                      }
                    >
                      <RolePill role={people.data!.access[p.login]?.[s.id] ?? "none"} tooltip={false} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <RoleLegend />
      </div>

      <PersonDrawer
        person={person}
        spaces={people.data?.spaces ?? []}
        access={(person && people.data?.access[person.login]) || {}}
        onOpenChange={(o) => !o && setOpenLogin(null)}
        onCloseAutoFocus={(e) => drawerFocus.restore(e)}
      />
      <span id="person-row-hint" className="sr-only">
        Opens their access details
      </span>
    </Page>
  );
}
