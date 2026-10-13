"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, ExternalLink, FileText, Info, Loader2, ScrollText, X, XCircle } from "lucide-react";
import { getApi } from "@/lib/api/client";
import { errorText } from "@/lib/api/errors";
import type { Rule, RuleStatus, Space } from "@/lib/api/types";
import { keys, useMe, usePeople, useRules, useSpaces } from "@/lib/queries";
import { canApproveRule } from "@/lib/permissions";
import { usePageTitle } from "@/lib/use-page-title";
import { Toggle } from "@/components/ui/toggle";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { firstName, fullDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/common/page";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { KindGlyph } from "@/components/space/kind-glyph";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const tabs: { id: RuleStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "active", label: "Active" },
  { id: "rejected", label: "Rejected" },
];

function RuleCard({
  rule,
  space,
  highlighted,
  nameOf,
  canDecide,
  onDecide,
  busy,
}: {
  rule: Rule;
  space?: Space;
  highlighted: boolean;
  nameOf: (login: string) => string;
  canDecide: boolean;
  onDecide: (rule: Rule, decision: "approve" | "reject") => void;
  busy: "approve" | "reject" | null;
}) {
  return (
    <article
      id={`rule-${rule.id}`}
      className={cn(
        "rounded-xl border bg-surface transition-shadow duration-300",
        highlighted && "shadow-[0_0_0_2px_var(--primary-soft),0_0_0_3px_var(--primary)]",
      )}
      aria-labelledby={`rule-${rule.id}-text`}
    >
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {space && (
            <Link href={`/spaces/${space.id}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
              <KindGlyph kind={space.kind} size="xs" label={false} />
              {space.name}
            </Link>
          )}
          {rule.status === "active" && (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-success-text">
              <CheckCircle2 className="size-3.5" aria-hidden /> Active
            </span>
          )}
          {rule.status === "rejected" && (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-muted-foreground">
              <XCircle className="size-3.5" aria-hidden /> Rejected
            </span>
          )}
        </div>
        <p id={`rule-${rule.id}-text`} className="text-[15px] leading-6 font-medium text-pretty">
          {rule.text}
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-x-3">
          <dt className="text-muted-foreground">Why</dt>
          <dd className="text-foreground/90">{rule.why}</dd>
          {rule.status === "rejected" && rule.rejectReason && (
            <>
              <dt className="text-muted-foreground">Rejected</dt>
              <dd className="text-foreground/90">{rule.rejectReason}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Source</dt>
          <dd className="min-w-0">
            <Link
              href={`/spaces/${rule.spaceId}?path=${encodeURIComponent(rule.source)}`}
              className="inline-flex max-w-full items-center gap-1.5 font-mono text-[12.5px] text-primary hover:underline"
            >
              <FileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{rule.source}</span>
            </Link>
          </dd>
        </dl>
      </div>
      <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <UserAvatar login={rule.proposedBy} name={nameOf(rule.proposedBy)} size="xs" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="truncate rounded-sm">
            Proposed by {firstName(nameOf(rule.proposedBy))}{" "}
            <time dateTime={rule.proposedAt} title={fullDate(rule.proposedAt)}>
              {timeAgo(rule.proposedAt)}
            </time>
            {rule.status === "active" && rule.approvedBy && (
              <>
                {" "}
                · approved by {firstName(nameOf(rule.approvedBy))}
                {rule.approvedAt && <> {timeAgo(rule.approvedAt)}</>}
              </>
            )}
            {rule.status === "rejected" && (rule.rejectedBy ?? rule.approvedBy) && (
              <>
                {" "}
                · rejected by {firstName(nameOf((rule.rejectedBy ?? rule.approvedBy)!))}
                {rule.rejectedAt && <> {timeAgo(rule.rejectedAt)}</>}
              </>
            )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Rule {rule.id}</TooltipContent>
          </Tooltip>
          {rule.prUrl && (
            <a href={rule.prUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
              Review on GitHub <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </p>
        {rule.status === "pending" &&
          (canDecide ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => onDecide(rule, "reject")} disabled={!!busy}>
                {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
                Reject
              </Button>
              <Button size="sm" onClick={() => onDecide(rule, "approve")} disabled={!!busy}>
                {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
                Approve
              </Button>
            </div>
          ) : (
            <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden />
              {space && space.owners.length
                ? `Only approvers of ${space.name} can decide: ${space.owners.map(nameOf).join(", ")}`
                : "Only this space's approvers can decide"}
            </p>
          ))}
      </div>
    </article>
  );
}

function RulesView() {
  const params = useSearchParams();
  const focus = params.get("rule");
  const [tab, setTab] = useState<RuleStatus>("pending");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [waitingOnly, setWaitingOnly] = useState(false);
  const all = useRules();
  const { data: spaces, isLoading: spacesLoading } = useSpaces();
  const { data: me } = useMe();
  const people = usePeople();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<{ id: string; d: "approve" | "reject" } | null>(null);
  const [rejecting, setRejecting] = useState<Rule | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const nameOf = (login: string) => people.data?.people.find((p) => p.login === login)?.name ?? login;
  const spaceOf = (id: string) => spaces?.find((s) => s.id === id);
  const canDecide = (r: Rule) => canApproveRule(r, spaceOf(r.spaceId), me);
  // Rules you can act on come first; "Waiting for you" shows only those.
  const list = (all.data ?? [])
    .filter((r) => r.status === tab && (spaceFilter === "all" || r.spaceId === spaceFilter) && (!waitingOnly || tab !== "pending" || canDecide(r)))
    .sort((a, b) => (tab === "pending" ? Number(canDecide(b)) - Number(canDecide(a)) : 0));
  const waitingCount = (all.data ?? []).filter((r) => r.status === "pending" && canDecide(r)).length;
  usePageTitle("Rules");
  const count = (s: RuleStatus) => (all.data ?? []).filter((r) => r.status === s && (spaceFilter === "all" || r.spaceId === spaceFilter)).length;
  const ruleSpaces = Array.from(new Set((all.data ?? []).map((r) => r.spaceId)))
    .map(spaceOf)
    .filter((s): s is Space => !!s);

  useEffect(() => {
    if (focus && all.data) {
      requestAnimationFrame(() => document.getElementById(`rule-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
  }, [focus, all.data]);

  async function decide(rule: Rule, d: "approve" | "reject") {
    setBusy({ id: rule.id, d });
    try {
      const updated = d === "approve" ? await getApi().approveRule(rule.id) : await getApi().rejectRule(rule.id, rejectReason.trim() || undefined);
      setRejectReason("");
      await qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: keys.activity });
      qc.invalidateQueries({ queryKey: ["tree", rule.spaceId] });
      qc.invalidateQueries({ queryKey: ["file", rule.spaceId] });
      const space = spaceOf(rule.spaceId);
      if (updated?.status === "pending") {
        // Review-required space: the decision went on a branch for review.
        toast.success(d === "approve" ? "Approval sent for review" : "Rejection sent for review", {
          description: updated.message ?? `${space?.name ?? "This space"} requires review, so the decision applies once it's merged.`,
          duration: 8000,
        });
      } else if (d === "approve") {
        toast.success("Rule approved", {
          description:
            space?.kind === "client"
              ? `Agents follow it on every ${space.name} task from now on.`
              : `Agents follow it on every task that loads ${space?.name ?? "this space"}.`,
        });
      } else {
        toast.success("Rule rejected", { description: "Agents won't use it. It stays in the Rejected tab for reference." });
      }
    } catch (e) {
      toast.error(`Couldn't ${d} the rule`, { description: errorText(e) });
    } finally {
      setBusy(null);
      setRejecting(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Rules"
        description="What agents have learned from feedback. A rule only applies after an approver of its space accepts it."
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Rule status" className="inline-flex rounded-lg border bg-muted/60 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls="rules-panel"
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.id === t.id);
                const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!n) return;
                const next = tabs[(i + n + tabs.length) % tabs.length];
                setTab(next.id);
                (e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement)?.focus();
              }}
              tabIndex={tab === t.id ? 0 : -1}
              className={cn(
                "inline-flex h-7 max-md:h-10 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150",
                tab === t.id && "bg-surface font-medium text-foreground shadow-[0_1px_2px_oklch(0_0_0/6%),0_0_0_1px_var(--border)]",
              )}
            >
              {t.label}
              {all.data && <span className="text-xs tabular-nums text-subtle-foreground">{count(t.id)}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {tab === "pending" && (
          <Toggle
            variant="outline"
            size="sm"
            pressed={waitingOnly}
            onPressedChange={setWaitingOnly}
            className="justify-center"
          >
            Waiting for you
            <span className="text-xs tabular-nums opacity-70">{waitingCount}</span>
          </Toggle>
        )}
        <Select value={spaceFilter} onValueChange={setSpaceFilter}>
          <SelectTrigger size="sm" className="w-full sm:w-[200px]" aria-label="Filter by space">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All spaces</SelectItem>
            {ruleSpaces.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      <div id="rules-panel" role="tabpanel" aria-label={`${tabs.find((t) => t.id === tab)?.label} rules`} className="space-y-3">
        {all.isLoading || spacesLoading || people.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[188px] rounded-xl" />)}
          </div>
        ) : all.error ? (
          <ErrorState error={all.error} title="Couldn't load rules" onRetry={() => all.refetch()} />
        ) : list.length === 0 ? (
          <div className="rounded-xl border bg-surface">
            <EmptyState icon={ScrollText} title={tab === "pending" ? "No rules waiting" : tab === "active" ? "No active rules yet" : "No rejected rules"}>
              {tab === "pending"
                ? waitingOnly
                  ? "Nothing is waiting for you. Turn off the filter to see rules waiting for others."
                  : "When someone gives an agent feedback, the rule it proposes waits here for an approver."
                : tab === "active"
                  ? "Approved rules show up here, with who approved them and why."
                  : "Rules an approver turned down show up here, so nobody proposes them twice."}
            </EmptyState>
          </div>
        ) : (
          list.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              space={spaceOf(r.spaceId)}
              highlighted={focus === r.id}
              nameOf={nameOf}
              canDecide={canDecide(r)}
              busy={busy?.id === r.id ? busy.d : null}
              onDecide={(rule, d) => (d === "reject" ? setRejecting(rule) : decide(rule, d))}
            />
          ))
        )}
      </div>

      <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && !busy && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{rejecting?.text}&rdquo; won&apos;t be used by agents. {rejecting && firstName(nameOf(rejecting.proposedBy))} can see it was
              rejected and by whom.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="reject-reason" className="text-sm">
              Why? <span className="font-normal text-muted-foreground">(optional, shown on the rule)</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Too broad. Apex is fine with offer end dates."
              rows={2}
              className="mt-1.5 resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Keep it pending</AlertDialogCancel>
            <Button variant="danger" disabled={!!busy} onClick={() => rejecting && decide(rejecting, "reject")}>
              {busy && <Loader2 className="animate-spin" />}
              Reject rule
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

export default function RulesPage() {
  return (
    <Suspense fallback={null}>
      <RulesView />
    </Suspense>
  );
}
