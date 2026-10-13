"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getApi } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { ConnectGitHubResult, GitHubCheck, RepoVisibility, Space } from "@/lib/api/types";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Phase = "checking" | "confirm" | "working" | "success" | "error" | "fallback";
/** Why we're showing the copy-paste prompt. "chosen": they picked it themselves. */
type FallbackReason = "gh-missing" | "logged-out" | "chosen";

const SIGNUP_URL = "https://github.com/signup";
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

function nameProblem(name: string) {
  if (!name.trim()) return "Give the repository a name.";
  if (!REPO_NAME_RE.test(name.trim()) || name.trim() === "." || name.trim() === "..")
    return "Use only letters, numbers, hyphens (-), underscores (_) and dots. No spaces.";
  return undefined;
}

/** The prompt someone pastes into Claude or Codex when SelfHub can't do it here. */
export function connectPrompt(path: string, name: string, visibility: RepoVisibility = "private", org?: string | null) {
  const folder = /\s/.test(path) ? `"${path}"` : path;
  return (
    `Please connect the folder ${folder} to GitHub for me. ` +
    "If I don't have the GitHub CLI (gh), install it. " +
    "If I don't have a GitHub account, help me create a free one at github.com/signup. " +
    "Log me in with `gh auth login` (HTTPS, browser). " +
    `Then create a ${visibility} repository named ${name}${org ? ` in the ${org} organization` : ""} and push this folder to it. ` +
    "Explain each step in plain language; I'm not technical."
  );
}

/**
 * Connect a space that is only on this computer to GitHub: check gh, confirm the
 * repository, create it and send the files. When gh is missing or not logged in, offer a
 * prompt for Claude or Codex instead. Renders inside a Dialog (uses DialogTitle).
 */
export function ConnectGitHubFlow({
  space,
  onDone,
  onCancel,
  onBusyChange,
  onConnected,
}: {
  space: Space;
  /** Close after success, or after giving up. */
  onDone: () => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
  onConnected?: (result: ConnectGitHubResult) => void;
}) {
  const qc = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [check, setCheck] = useState<GitHubCheck | null>(null);
  const [reason, setReason] = useState<FallbackReason>("chosen");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [submitted, setSubmitted] = useState(false);
  const [taken, setTaken] = useState<{ message: string; suggestion?: string } | null>(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ConnectGitHubResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rechecking, setRechecking] = useState(false);
  const [stillNot, setStillNot] = useState(false);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Each phase starts at its heading, so keyboard and screen reader users know where they are.
  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [phase]);

  useEffect(() => onBusyChange?.(phase === "working"), [phase, onBusyChange]);

  useEffect(() => {
    if (phase !== "working") return;
    const t = setTimeout(() => setStep(1), 900);
    return () => clearTimeout(t);
  }, [phase]);

  async function refreshSpaces() {
    await qc.invalidateQueries({ queryKey: keys.spaces });
    qc.invalidateQueries({ queryKey: keys.activity });
  }

  function applyCheck(found: GitHubCheck, first: boolean) {
    setCheck(found);
    if (first || !name) setName(found.suggestedName);
    if (!owner || !found.owners.some((o) => o.login === owner)) setOwner(found.defaultOwner ?? found.owners[0]?.login ?? "");
    if (found.ready) {
      setAnnounce(first ? "" : "GitHub is ready on this computer.");
      setPhase("confirm");
    } else {
      setReason(found.problem ?? "gh-missing");
      if (!first) {
        setStillNot(true);
        setAnnounce(found.problem === "logged-out" ? "Still not logged in to GitHub." : "The GitHub CLI (gh) still isn't installed.");
      }
      setPhase("fallback");
    }
  }

  async function checkFailed(e: unknown) {
    // Someone (or their AI assistant) already connected it: that's the outcome we wanted.
    if (isApiError(e) && e.code === "already-connected") {
      await refreshSpaces();
      const fresh = qc.getQueryData<Space[]>(keys.spaces)?.find((s) => s.id === space.id);
      setResult({ space: fresh ?? space, repo: fresh?.repo ?? { owner: "", name: "", url: "" } });
      setPhase("success");
      return;
    }
    setError(e);
    setPhase("error");
  }

  /** first: a fresh check (after an error); otherwise "Check again" from the fallback. */
  async function runCheck(first: boolean) {
    if (first) setPhase("checking");
    else setRechecking(true);
    setStillNot(false);
    try {
      applyCheck(await getApi().githubCheck(space.id), first);
    } catch (e) {
      await checkFailed(e);
    } finally {
      setRechecking(false);
    }
  }

  useEffect(() => {
    getApi()
      .githubCheck(space.id)
      .then((found) => applyCheck(found, true), checkFailed);
    // Run once, when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setSubmitted(true);
    if (nameProblem(name) || !owner) return;
    setTaken(null);
    setStep(0);
    setPhase("working");
    try {
      const done = await getApi().connectGitHub(space.id, { owner, name: name.trim(), visibility });
      qc.setQueryData<Space[]>(keys.spaces, (prev) => prev?.map((s) => (s.id === done.space.id ? done.space : s)));
      await refreshSpaces();
      setResult(done);
      setPhase("success");
      onConnected?.(done);
    } catch (e) {
      if (isApiError(e) && e.code === "name-taken") {
        const suggestion = typeof e.details?.suggestion === "string" ? e.details.suggestion : undefined;
        setTaken({ message: e.message, suggestion });
        setPhase("confirm");
        return;
      }
      if (isApiError(e) && (e.code === "gh-missing" || e.code === "logged-out")) {
        setReason(e.code);
        setPhase("fallback");
        return;
      }
      if (isApiError(e) && e.code === "push-failed") await refreshSpaces();
      setError(e);
      setPhase("error");
    }
  }

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setAnnounce("Copied");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const box = document.getElementById("connect-prompt") as HTMLTextAreaElement | null;
      box?.focus();
      box?.select();
      setAnnounce("Couldn't copy automatically. The prompt is selected: press Command+C or Ctrl+C to copy it.");
    }
  }

  const org = check?.owners.find((o) => o.login === owner && o.kind === "org")?.login ?? null;
  const fullName = `${owner}/${name.trim()}`;
  const nameError = submitted ? nameProblem(name) : undefined;

  return (
    <div className="min-w-0">
      {/* One live region for the flow: progress, outcomes and "Copied". */}
      <p className="sr-only" role="status" aria-live="polite">
        {phase === "checking"
          ? "Checking GitHub on this computer…"
          : phase === "working"
            ? step === 0
              ? `Creating ${fullName} on GitHub…`
              : "Sending your files…"
            : phase === "success"
              ? "Connected to GitHub."
              : announce}
      </p>

      {phase === "checking" && (
        <div className="p-6">
          <DialogTitle ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold outline-none">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            Checking GitHub on this computer…
          </DialogTitle>
          <DialogDescription className="mt-1">This takes a moment.</DialogDescription>
        </div>
      )}

      {phase === "confirm" && check && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <div className="px-6 pt-6">
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
              Connect to GitHub
            </DialogTitle>
            <DialogDescription className="mt-1">
              SelfHub will create a repository on GitHub and send {space.name}&apos;s files to it. A repository is GitHub&apos;s word for a project folder.
            </DialogDescription>
          </div>
          <div className="space-y-5 px-6 py-5">
            <div>
              <Label htmlFor="repo-name">Repository name</Label>
              <Input
                id="repo-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTaken(null);
                }}
                className="mt-1.5 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!nameError || !!taken}
                aria-describedby={nameError || taken ? "repo-name-error" : "repo-name-help"}
              />
              {nameError || taken ? (
                <div id="repo-name-error" role="alert" className="mt-1.5 text-xs text-danger-text">
                  <p className="flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                    {nameError ?? taken?.message}
                  </p>
                  {!nameError && taken?.suggestion && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setName(taken.suggestion!);
                        setTaken(null);
                        document.getElementById("repo-name")?.focus();
                      }}
                    >
                      Use {taken.suggestion}
                    </Button>
                  )}
                </div>
              ) : (
                <p id="repo-name-help" className="mt-1.5 text-xs text-muted-foreground">
                  Letters, numbers, hyphens (-), underscores (_) and dots. No spaces.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="repo-owner">Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id="repo-owner" className="mt-1.5 w-full" aria-describedby="repo-owner-help">
                  <SelectValue placeholder="Choose an owner" />
                </SelectTrigger>
                <SelectContent>
                  {check.owners.map((o) => (
                    <SelectItem key={o.login} value={o.login}>
                      {o.login} {o.kind === "user" ? "(your GitHub account)" : "(organization)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="repo-owner-help" className="mt-1.5 text-xs text-muted-foreground">
                {check.owners.some((o) => o.kind === "org")
                  ? "Pick your company's organization so your team can find it."
                  : "It goes in your own GitHub account. You can add your team to it later."}
              </p>
            </div>

            <fieldset>
              <legend className="text-sm font-medium">Who can see it</legend>
              <RadioGroup value={visibility} onValueChange={(v) => setVisibility(v as RepoVisibility)} className="mt-2 gap-3">
                {(
                  [
                    { value: "private", title: "Private (recommended)", body: "Only people you add can see it." },
                    { value: "public", title: "Public", body: "Anyone on the internet can see it. Not for client or company information." },
                  ] as const
                ).map((o) => (
                  <label key={o.value} htmlFor={`visibility-${o.value}`} className="flex cursor-pointer items-start gap-2.5">
                    <RadioGroupItem id={`visibility-${o.value}`} value={o.value} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.body}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-muted/40 px-6 py-3">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-sm"
              onClick={() => {
                setReason("chosen");
                setPhase("fallback");
              }}
            >
              Do it with Claude or Codex instead
            </Button>
            <div className="ml-auto flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit">Create {visibility} repo and connect</Button>
            </div>
          </div>
        </form>
      )}

      {phase === "working" && (
        <div className="p-6">
          <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
            Connecting to GitHub…
          </DialogTitle>
          <DialogDescription className="mt-1">This takes a few seconds. Keep this window open until it&apos;s done.</DialogDescription>
          <ol className="mt-5 space-y-3">
            {["Checked GitHub on this computer", `Creating ${fullName}`, "Sending your files"].map((s, i) => {
              const at = i === 0 ? -1 : i - 1; // the check already passed
              const state = at < step ? "done" : at === step ? "now" : "next";
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  {state === "done" ? (
                    <CheckCircle2 className="size-4 text-success-text" aria-hidden />
                  ) : state === "now" ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  ) : (
                    <span className="inline-flex size-4 items-center justify-center" aria-hidden>
                      <span className="size-1.5 rounded-full bg-border-strong" />
                    </span>
                  )}
                  <span className={cn(state === "next" && "text-muted-foreground", i === 1 && "break-all")}>{s}</span>
                  <span className="sr-only">{state === "done" ? "done" : state === "now" ? "in progress" : "waiting"}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {phase === "success" && result && (
        <div className="p-6 text-center sm:p-8">
          <span className="mx-auto mb-4 inline-flex size-11 items-center justify-center rounded-full bg-success/12 text-success-text">
            <Check className="size-5" strokeWidth={2.5} aria-hidden />
          </span>
          <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
            Connected to GitHub
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1 max-w-sm">
            {result.repo.url
              ? `${space.name} is backed up on GitHub as ${result.repo.owner}/${result.repo.name}. To share it, give your team access on the Members page.`
              : `${space.name} is backed up on GitHub. To share it, give your team access on the Members page.`}
          </DialogDescription>
          <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            {result.repo.url && (
              <Button variant="outline" asChild>
                <a href={result.repo.url} target="_blank" rel="noreferrer">
                  Open on GitHub <ExternalLink aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            )}
            <Button onClick={onDone}>Done</Button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="p-6">
          <DialogTitle ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold outline-none">
            <AlertCircle className="size-4 text-danger-text" aria-hidden />
            {isApiError(error) && error.code === "push-failed" ? "Almost connected" : "Couldn't connect to GitHub"}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {isApiError(error) ? error.message : "SelfHub didn't respond. Check that it's still running, then try again."}
          </DialogDescription>
          {isApiError(error) && error.hint && <p className="mt-2 text-sm text-muted-foreground">{error.hint}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {isApiError(error) && error.code === "push-failed" ? (
              <span />
            ) : (
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start px-0 text-sm"
                onClick={() => {
                  setReason("chosen");
                  setPhase("fallback");
                }}
              >
                Do it with Claude or Codex instead
              </Button>
            )}
            <div className="flex justify-end gap-2">
              {isApiError(error) && error.code === "push-failed" ? (
                <Button onClick={onDone}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={onCancel}>
                    Close
                  </Button>
                  <Button onClick={() => (check?.ready ? setPhase("confirm") : runCheck(true))}>Try again</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === "fallback" && (
        <div>
          <div className="px-6 pt-6">
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
              {reason === "gh-missing"
                ? "The GitHub CLI (gh) isn't installed"
                : reason === "logged-out"
                  ? "You're not logged in to GitHub on this computer"
                  : "Do it with Claude or Codex"}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {reason === "gh-missing"
                ? "SelfHub uses the GitHub CLI (gh), a free app from GitHub, to create the repository and send your files. It isn't on this computer yet."
                : reason === "logged-out"
                  ? "SelfHub uses the GitHub CLI (gh) to create the repository. It's installed, but it isn't logged in to a GitHub account."
                  : "An AI assistant like Claude or Codex can set this up for you and explain each step."}
            </DialogDescription>
          </div>
          <div className="space-y-4 px-6 py-5">
            {stillNot && (
              <p role="alert" className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <AlertCircle className="size-4 shrink-0 text-warning-text" aria-hidden />
                {reason === "logged-out" ? "Still not logged in. Finish the steps, then check again." : "Still not installed. Finish the steps, then check again."}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              No GitHub account yet?{" "}
              <a href={SIGNUP_URL} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                Create a free one at github.com/signup
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Copy this prompt.</li>
              <li>Paste it into Claude or Codex and follow along.</li>
              <li>Come back here and choose Check again.</li>
            </ol>
            <div>
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="connect-prompt">Prompt for Claude or Codex</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => copyPrompt(connectPrompt(check?.path ?? "", name.trim() || check?.suggestedName || space.id, visibility, org))} disabled={!check}>
                  {copied ? <Check className="text-success-text" aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy prompt"}
                </Button>
              </div>
              <Textarea
                id="connect-prompt"
                readOnly
                rows={6}
                value={check ? connectPrompt(check.path, name.trim() || check.suggestedName, visibility, org) : ""}
                className="mt-1.5 resize-none font-mono text-xs leading-5"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            {reason === "chosen" && check?.ready ? (
              <Button type="button" variant="ghost" onClick={() => setPhase("confirm")} className="justify-start">
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Close
              </Button>
              <Button type="button" onClick={() => runCheck(false)} disabled={rechecking}>
                {rechecking ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                {rechecking ? "Checking…" : "Check again"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The flow in its own dialog. Focus returns to `returnFocus` (the status pill) on close. */
export function ConnectGitHubDialog({
  space,
  open,
  onOpenChange,
  returnFocus,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o && busy ? undefined : onOpenChange(o))}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[520px]"
        showCloseButton={!busy}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          if (returnFocus?.current) {
            e.preventDefault();
            returnFocus.current.focus();
          }
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        {open && (
          <ConnectGitHubFlow space={space} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} onBusyChange={setBusy} />
        )}
      </DialogContent>
    </Dialog>
  );
}
