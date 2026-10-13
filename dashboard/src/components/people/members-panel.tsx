"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Info, Loader2, Lock, UserMinus, UserPlus, Users } from "lucide-react";
import type { Member, Role, Space } from "@/lib/api/types";
import { errorText } from "@/lib/api/errors";
import { useMe, useMemberMutations, useMembers, usePeople } from "@/lib/queries";
import { roleLabel, rolePhrase } from "@/lib/labels";
import { firstName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/user-avatar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { RolePill } from "@/components/space/role-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RoleSelect } from "./role-select";
import { useReturnFocus } from "@/lib/use-return-focus";

const LOGIN_RE = /^@?[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Kept for old imports; the role mapping now lives in one line in space settings. */
export function RoleLegend() {
  return null;
}

function InviteForm({ space, members }: { space: Space; members: Member[] }) {
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("read");
  const [error, setError] = useState<string | null>(null);
  const { add } = useMemberMutations(space.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = login.trim().replace(/^@/, "");
    if (!clean) return setError("Enter a GitHub username.");
    if (!LOGIN_RE.test(clean)) return setError("That isn't a valid GitHub username. Use letters, numbers and single hyphens.");
    if (members.some((m) => m.login.toLowerCase() === clean.toLowerCase())) return setError(`@${clean} already has access. Change their role below.`);
    setError(null);
    try {
      const list = await add.mutateAsync({ login: clean, role });
      setLogin("");
      const found = Array.isArray(list) ? list.find((m) => m.login === clean) : undefined;
      const added = found && found.name !== clean ? found.name : `@${clean}`;
      toast.success(`Added ${added} to ${space.name} as ${roleLabel[role]}`, {
        description: "If they're new to your organization on GitHub, they get an email invite first.",
      });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-surface p-4">
      <label htmlFor="invite-login" className="text-sm font-medium">
        Invite by GitHub username
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-subtle-foreground">@</span>
          <Input
            id="invite-login"
            value={login.replace(/^@/, "")}
            onChange={(e) => {
              setLogin(e.target.value);
              setError(null);
            }}
            placeholder="username"
            autoComplete="off"
            className="h-8 pl-6.5"
            aria-invalid={!!error}
            aria-describedby={error ? "invite-error" : undefined}
          />
        </div>
        <div className="flex gap-2">
          <RoleSelect value={role} onChange={(r) => r !== "none" && setRole(r)} label="Role for the new member" className="h-8 w-[120px] flex-1 sm:flex-none" />
          <Button type="submit" disabled={add.isPending || !login.trim()}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Invite
          </Button>
        </div>
      </div>
      {error && (
        <p id="invite-error" role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-danger-text">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </form>
  );
}

export function MembersPanel({ space }: { space: Space }) {
  const members = useMembers(space.id);
  const { data: me } = useMe();
  const { add, update, remove } = useMemberMutations(space.id);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const removeFocus = useReturnFocus();
  // Access can only be shared for spaces on GitHub (the API answers 400 no-repo otherwise),
  // and a personal space is never shared.
  const shareable = !!space.repo && space.kind !== "personal";
  const people = usePeople();
  const ownerNames = new Intl.ListFormat("en", { type: "disjunction" }).format(
    space.owners.map((o) => people.data?.people.find((p) => p.login === o)?.name ?? o),
  ) || "an admin";
  const isAdmin = space.myAccess === "admin" && shareable;

  async function changeRole(m: Member, role: Role) {
    if (role === m.role) return;
    setBusy(m.login);
    try {
      await update.mutateAsync({ login: m.login, role });
      const from = m.role;
      toast.success(`${firstName(m.name)} ${rolePhrase[role]} ${space.name}`, {
        description: "Updated on GitHub.",
        action: {
          label: "Undo",
          onClick: () =>
            update
              .mutateAsync({ login: m.login, role: from })
              .then(() => toast.success(`Undone. ${firstName(m.name)} is back to ${roleLabel[from]}.`))
              .catch((e) => toast.error("Couldn't undo", { description: errorText(e) })),
        },
        duration: 8000,
      });
    } catch (err) {
      toast.error(`Couldn't change ${firstName(m.name)}'s role`, { description: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    const m = removing;
    setBusy(m.login);
    try {
      await remove.mutateAsync(m.login);
      toast.success(`Removed ${firstName(m.name)} from ${space.name}`, {
        description: "They lost access on GitHub too.",
        action: {
          label: "Undo",
          onClick: () =>
            add
              .mutateAsync({ login: m.login, role: m.role })
              .then(() => toast.success(`Undone. ${firstName(m.name)} is back as ${roleLabel[m.role]}.`))
              .catch((e) => toast.error("Couldn't undo", { description: errorText(e) })),
        },
        duration: 8000,
      });
      setRemoving(null);
    } catch (err) {
      toast.error(`Couldn't remove ${firstName(m.name)}`, { description: errorText(err) });
      setRemoving(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <h2 id="members-heading" tabIndex={-1} className="text-base font-semibold outline-none">
          Members
        </h2>
        <p className="text-sm text-muted-foreground">
          Who can open and change {space.name}. Access lives on GitHub, and changes you make here apply there too.
        </p>
      </div>

      {!isAdmin && (
        <div className="flex items-start gap-2.5 rounded-lg border bg-muted/50 px-3.5 py-3 text-sm" role="note">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            {space.kind === "personal"
              ? "This is your personal space. Only you can see it, and it can't be shared."
              : !space.repo
                ? `${space.name} isn't on GitHub yet, so its access can't be shared. Connect it to GitHub first.`
                : `Only admins of ${space.name} can change access. Ask ${ownerNames} to add someone.`}
          </p>
        </div>
      )}

      {isAdmin && members.data && <InviteForm space={space} members={members.data} />}

      <div className="overflow-hidden rounded-xl border bg-surface">
        {members.isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        ) : members.error ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : !members.data?.length ? (
          <EmptyState icon={Users} title="No members yet">
            Invite someone by their GitHub username.
          </EmptyState>
        ) : (
          <ul className="divide-y" aria-label={`Members of ${space.name}`}>
            {members.data.map((m) => {
              const viaTeam = m.via === "team";
              const isMe = m.login === me?.login;
              return (
                <li key={m.login} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap", busy === m.login && "opacity-60")}>
                  <UserAvatar login={m.login} name={m.name} avatarUrl={m.avatarUrl} size="md" />
                  {/* Below sm the name gets the full row; controls drop underneath, so names aren't cut. */}
                  <div className="min-w-0 basis-[calc(100%-3.5rem)] sm:basis-auto sm:flex-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                      <span className="break-words sm:truncate">{m.name}</span>
                      {isMe && <span className="shrink-0 text-xs font-normal text-muted-foreground">(you)</span>}
                      {m.isOwner && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="shrink-0 rounded bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                              Approver
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Approves rules and locked files</TooltipContent>
                        </Tooltip>
                      )}
                    </p>
                    <p className="text-xs break-words text-muted-foreground sm:truncate">
                      {m.pending && <span className="font-medium text-warning-text">Invited · waiting to accept · </span>}
                      @{m.login}
                      {viaTeam && <> · via the {m.team ?? "a GitHub"} team</>}
                    </p>
                  </div>
                  <div className="ml-11 flex items-center gap-1.5 sm:ml-0">
                    {isAdmin && !viaTeam && !isMe ? (
                      <RoleSelect
                        value={m.role}
                        allowNone
                        onChange={(r) => {
                          if (r !== "none") return changeRole(m, r);
                          // Open after the select closes, so the Enter that picked "No access"
                          // can't also press a button in the dialog.
                          setTimeout(() => {
                            removeFocus.capture(document.querySelector<HTMLElement>(`[role="combobox"][aria-label="${CSS.escape(`Role for ${m.name}`)}"]`));
                            setRemoving(m);
                          }, 0);
                        }}
                        disabled={busy === m.login}
                        label={`Role for ${m.name}`}
                      />
                    ) : isAdmin && viaTeam && !isMe ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-md">
                            <RolePill role={m.role} tooltip={false} />
                            <Info className="size-3.5 text-subtle-foreground" aria-hidden />
                            <span className="sr-only">Managed by the {m.team} team on GitHub</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-60">
                          {firstName(m.name)}&apos;s access comes from the {m.team ?? "a GitHub"} team, so it can&apos;t be changed per person. Change
                          the team on GitHub, or give them a higher role directly.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <RolePill role={m.role} />
                    )}
                    {isAdmin && (viaTeam || isMe) && <span className="size-7" aria-hidden />}
                    {isAdmin && !isMe && !viaTeam && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${m.name}`}
                        disabled={busy === m.login}
                        onClick={(e) => {
                          removeFocus.capture(e.currentTarget);
                          setRemoving(m);
                        }}
                        className="text-muted-foreground hover:text-danger-text"
                      >
                        <UserMinus />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RoleLegend />

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onCloseAutoFocus={(e) => removeFocus.restore(e, () => document.getElementById("members-heading"))}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name} from {space.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access on GitHub, and their agents stop loading this space. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="danger" onClick={confirmRemove} disabled={busy === removing?.login}>
              {busy === removing?.login && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
