"use client";

import { useEffect, useRef, useState } from "react";
import { PeoplePicker } from "@/components/people/people-picker";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, FolderPlus, GitBranch, Loader2, Lock } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiMode, getApi } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { Space, SpaceKind } from "@/lib/api/types";
import { keys, useConnectableRepos, useMe, useSpaces } from "@/lib/queries";
import { kindBlurb, kindLabel, kindOrder } from "@/lib/labels";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindGlyph } from "./kind-glyph";

type Step = "choose" | "connect" | "create" | "working" | "done";
type Path = "connect" | "create";

const REPO_RE = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?[\w.-]+\/[\w.-]+?(?:\.git)?\/?$|^git@github\.com:[\w.-]+\/[\w.-]+?(?:\.git)?$/;
/** The API also clones any git URL or connects a local folder (local and demo modes). */
const ANY_SOURCE_RE = /^(?:(?:https?|ssh|git|file):\/\/\S+|git@[\w.-]+:\S+|[~/]\S*|[A-Za-z]:\\\S*)$/;

function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-danger-text">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** The API's "has no .selfhub/space.json" answer: the folder is a repo, just not a space yet. */
function notASpace(error: unknown) {
  return isApiError(error) && (error.code === "not-a-space" || /space\.json/.test(error.message));
}

function ServerError({ error, onMakeSpace }: { error: unknown; onMakeSpace?: () => void }) {
  if (!error) return null;
  // Our own words for the known case; never show a CLI command.
  const message = notASpace(error)
    ? "This folder isn't a SelfHub space yet."
    : isApiError(error)
      ? error.message.replace(/\s*Make it one with `[^`]*`\.?/, "")
      : "The request didn't reach SelfHub. Check your connection, then try again.";
  const hint = notASpace(error)
    ? "It needs SelfHub's settings file first. You can create a new space with this name instead; its files start empty."
    : isApiError(error)
      ? error.hint
      : undefined;
  return (
    <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/25 bg-danger/6 px-3 py-2.5 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden />
      <div>
        <p className="font-medium">{message}</p>
        {hint && <p className="mt-0.5 text-muted-foreground">{hint}</p>}
        {onMakeSpace && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onMakeSpace}>
            Create a new space instead
          </Button>
        )}
      </div>
    </div>
  );
}

const createSteps = ["Creating it on GitHub", "Adding a brief, rules and settings", "Giving you and the approvers access"];
const connectSteps = ["Checking you can open it", "Reading its files", "Adding it to your spaces"];

export function AddSpaceDialog() {
  const { addSpaceOpen, setAddSpaceOpen, guard } = useAppState();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();

  const [step, setStep] = useState<Step>("choose");
  const [path, setPath] = useState<Path>("create");
  const [progress, setProgress] = useState(0);
  const [created, setCreated] = useState<Space | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);

  // Connect fields
  const [source, setSource] = useState("");
  const [connectName, setConnectName] = useState("");
  // Create fields
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("client");
  const [description, setDescription] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [review, setReview] = useState(false);
  const [reviewTouched, setReviewTouched] = useState(false);

  const repos = useConnectableRepos(addSpaceOpen && step === "connect");

  function reset() {
    setStep("choose");
    setProgress(0);
    setCreated(null);
    setServerError(null);
    setSubmitted(false);
    setSource("");
    setConnectName("");
    setName("");
    setKind("client");
    setDescription("");
    setOwners([]);
    setReview(false);
    setReviewTouched(false);
  }

  // Each step starts at its heading.
  useEffect(() => {
    if (addSpaceOpen) requestAnimationFrame(() => headingRef.current?.focus());
  }, [step, addSpaceOpen]);

  useEffect(() => {
    if (step !== "working") return;
    const t = setInterval(() => setProgress((p) => Math.min(p + 1, 2)), 550);
    return () => clearInterval(t);
  }, [step]);


  const nameError = !name.trim()
    ? "Give the space a name."
    : name.trim().length < 2
      ? "Use at least 2 characters."
      : spaces?.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())
        ? `A space called ${name.trim()} already exists.`
        : undefined;
  const sourceError = !source.trim()
    ? apiMode === "http"
      ? "Paste a GitHub repository link or a folder path."
      : "Paste a GitHub repository link or pick one below."
    : !REPO_RE.test(source.trim()) && !(apiMode === "http" && ANY_SOURCE_RE.test(source.trim()))
      ? apiMode === "http"
        ? "Use a GitHub link (github.com/northline/client-apex), a git URL, or a folder path."
        : "That doesn't look like a GitHub repository. Use a link like github.com/northline/client-apex."
      : undefined;

  async function submit() {
    setSubmitted(true);
    setServerError(null);
    if (path === "create" && nameError) return;
    if (path === "connect" && sourceError) return;
    setStep("working");
    setProgress(0);
    try {
      const space =
        path === "create"
          ? await getApi().createSpace({
              action: "create",
              name: name.trim(),
              kind,
              description: description.trim() || undefined,
              owners: owners,
              writePolicy: review ? "pull-request" : "direct",
            })
          : await getApi().createSpace({ action: "connect", source: source.trim(), name: connectName.trim() || undefined });
      // Use the space the API just returned, so a list fetch that started before this
      // request (and lands after it) can't hide the new space.
      qc.setQueryData<Space[]>(keys.spaces, (prev) => (prev && !prev.some((s) => s.id === space.id) ? [...prev, space] : prev));
      await qc.cancelQueries({ queryKey: keys.spaces });
      await qc.invalidateQueries({ queryKey: keys.spaces });
      qc.invalidateQueries({ queryKey: keys.people });
      qc.invalidateQueries({ queryKey: keys.activity });
      setCreated(space);
      setStep("done");
    } catch (e) {
      setServerError(e);
      setStep(path);
    }
  }

  const close = (open: boolean) => {
    if (open) return setAddSpaceOpen(true);
    if (step === "working") return;
    setAddSpaceOpen(false);
    setTimeout(reset, 200);
  };

  const steps = path === "create" ? createSteps : connectSteps;
  const announcement =
    step === "choose"
      ? "Add a space. Choose how."
      : step === "connect"
        ? "Connect an existing GitHub repository."
        : step === "create"
          ? "Create a new space."
          : step === "working"
            ? `${steps[progress]}…`
            : created
              ? `${created.name} is ready.`
              : "";

  return (
    <Dialog open={addSpaceOpen} onOpenChange={close}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[560px]"
        showCloseButton={step !== "working"}
        onInteractOutside={(e) => step === "working" && e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // Start at the step's heading so screen readers announce where they are.
          e.preventDefault();
          headingRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => step === "working" && e.preventDefault()}
      >
        {/* One live region for the whole dialog: step changes and progress are announced here. */}
        <p className="sr-only" aria-live="polite" role="status">
          {announcement}
        </p>
        {step === "choose" && (
          <div className="p-6">
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              Add a space
            </DialogTitle>
            <DialogDescription className="mt-1">
              A space is a shared folder of company knowledge, kept on GitHub, that your team and agents work from.
            </DialogDescription>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    id: "connect",
                    icon: GitBranch,
                    title: "Connect an existing GitHub repository",
                    body: "Add one your company already keeps on GitHub, like a client's folder.",
                  },
                  {
                    id: "create",
                    icon: FolderPlus,
                    title: "Create a new space",
                    body: "Start from a template. SelfHub creates it on GitHub for you.",
                  },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setPath(o.id);
                    setStep(o.id);
                  }}
                  className="group flex flex-col items-start rounded-xl border bg-surface p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-[0_0_0_3px_var(--primary-soft)]"
                >
                  <span className="mb-3 inline-flex size-9 items-center justify-center rounded-lg border bg-muted text-foreground">
                    <o.icon className="size-4" />
                  </span>
                  <span className="text-sm font-medium">{o.title}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{o.body}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(step === "connect" || step === "create") && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={() => (setStep("choose"), setServerError(null), setSubmitted(false))}>
                <ArrowLeft />
              </Button>
              <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
                {step === "connect" ? "Connect an existing GitHub repository" : "Create a new space"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {step === "connect"
                  ? apiMode === "http"
                    ? "Paste a GitHub repository link, or the path to a folder on this computer."
                    : "Paste a GitHub repository link, or pick one below."
                  : "Name the space, choose its kind and who approves changes."}
              </DialogDescription>
            </div>

            <div className="space-y-5 px-6 py-5">
              <ServerError
                error={serverError}
                onMakeSpace={
                  notASpace(serverError)
                    ? () => {
                        const folder = source.trim().replace(/[\/]+$/, "").split(/[\/]/).pop() ?? "";
                        setName(folder.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
                        setServerError(null);
                        setSubmitted(false);
                        setPath("create");
                        setStep("create");
                      }
                    : undefined
                }
              />

              {step === "connect" ? (
                <>
                  <div>
                    <Label htmlFor="repo-source">{apiMode === "http" ? "GitHub repository link or folder on this computer" : "GitHub repository"}</Label>
                    <Input
                      id="repo-source"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="github.com/northline/client-ridgeline"
                      className="mt-1.5 font-mono text-sm"
                      aria-invalid={submitted && !!sourceError}
                      aria-describedby={submitted && sourceError ? "repo-source-error" : undefined}
                    />
                    <FieldError id="repo-source-error">{submitted && sourceError}</FieldError>
                  </div>
                  {(repos.isLoading || (repos.data?.length ?? 0) > 0) && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Repos you can access</p>
                    <div className="overflow-hidden rounded-lg border">
                      {repos.isLoading &&
                        Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="flex h-14 items-center gap-3 border-b px-3 last:border-0">
                            <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                          </div>
                        ))}
                      {repos.data?.length === 0 && (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                          Paste the link above.
                        </p>
                      )}
                      {repos.data?.map((r) => {
                        const selected = source.replace(/^https?:\/\/(www\.)?github\.com\//, "") === r.fullName;
                        return (
                          <button
                            key={r.fullName}
                            type="button"
                            disabled={r.connected}
                            onClick={() => {
                              setSource(`github.com/${r.fullName}`);
                              // A picked repo is valid: clear any earlier error.
                              setSubmitted(false);
                              setServerError(null);
                            }}
                            aria-pressed={selected}
                            className={cn(
                              "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors duration-150 last:border-0",
                              "hover:bg-muted/60 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                              selected && "bg-primary-soft hover:bg-primary-soft",
                            )}
                          >
                            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate font-mono text-[13px]", r.connected && "text-muted-foreground")}>{r.fullName}</span>
                              <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                            </span>
                            {r.connected ? (
                              <span className="shrink-0 text-xs text-subtle-foreground">Already added</span>
                            ) : selected ? (
                              <Check className="size-4 shrink-0 text-primary" aria-hidden />
                            ) : (
                              <span className="shrink-0 text-xs text-subtle-foreground">{timeAgo(r.updatedAt)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}
                  <div>
                    <Label htmlFor="connect-name">
                      Display name <span className="font-normal text-subtle-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="connect-name"
                      value={connectName}
                      onChange={(e) => setConnectName(e.target.value)}
                      placeholder="Ridgeline Plumbing"
                      className="mt-1.5"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="space-name">Name</Label>
                    <Input
                      id="space-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Ridgeline Plumbing"
                      className="mt-1.5"
                      aria-invalid={submitted && !!nameError}
                      aria-describedby={submitted && nameError ? "space-name-error" : undefined}
                    />
                    <FieldError id="space-name-error">{submitted && nameError}</FieldError>
                  </div>

                  <fieldset>
                    <legend className="text-sm font-medium">Kind</legend>
                    <div role="radiogroup" aria-label="Kind" className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {kindOrder.map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={kind === k}
                          onClick={() => {
                            setKind(k);
                            if (!reviewTouched) setReview(k === "org");
                          }}
                          onKeyDown={(e) => {
                            const i = kindOrder.indexOf(k);
                            const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                            if (!next) return;
                            e.preventDefault();
                            const nk = kindOrder[(i + next + kindOrder.length) % kindOrder.length];
                            setKind(nk);
                            if (!reviewTouched) setReview(nk === "org");
                            (e.currentTarget.parentElement?.children[kindOrder.indexOf(nk)] as HTMLElement)?.focus();
                          }}
                          tabIndex={kind === k ? 0 : -1}
                          className={cn(
                            "flex items-start gap-2.5 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow,background-color] duration-150",
                            kind === k ? "border-primary/50 bg-primary-soft/50 shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
                          )}
                        >
                          <KindGlyph kind={k} size="md" label={false} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{kindLabel[k]}</span>
                            <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{kindBlurb[k]}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <Label htmlFor="space-description">
                      Description <span className="font-normal text-subtle-foreground">(optional)</span>
                    </Label>
                    <Textarea
                      id="space-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. Residential plumbing in Fort Collins."
                      rows={2}
                      className="mt-1.5 resize-none"
                    />
                  </div>

                  <div>
                    <Label htmlFor="space-owners">Approvers</Label>
                    <div className="mt-1.5">
                      <PeoplePicker
                        id="space-owners"
                        value={owners}
                        onChange={setOwners}
                        placeholder={me ? `${me.name} (you)` : "Choose approvers"}
                        describedBy="space-owners-help"
                      />
                    </div>
                    <p id="space-owners-help" className="mt-1.5 text-xs text-muted-foreground">
                      Approvers accept rules and changes to locked files. Leave it empty to approve them yourself.
                    </p>
                  </div>

                  <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-3">
                    <div>
                      <Label htmlFor="space-review" className="text-sm font-medium">
                        Require review for changes
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Changes open a review on GitHub and apply once an approver accepts them. Recommended for company spaces.
                      </p>
                    </div>
                    <Switch
                      id="space-review"
                      checked={review}
                      onCheckedChange={(v) => {
                        setReview(v);
                        setReviewTouched(true);
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t bg-muted/40 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden />
                {step === "create" ? `Only people in ${me?.org.name ?? "your organization"} can see it.` : "Access stays exactly as it is on GitHub."}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button type="submit">{step === "create" ? "Create space" : "Connect"}</Button>
              </div>
            </div>
          </form>
        )}

        {step === "working" && (
          <div className="p-6">
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
              {path === "create" ? `Creating ${name.trim()}…` : "Connecting…"}
            </DialogTitle>
            <DialogDescription className="mt-1">This takes a few seconds. You can&apos;t close this window until it&apos;s done.</DialogDescription>
            <ol className="mt-5 space-y-3">
              {steps.map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-sm">
                  {i < progress ? (
                    <CheckCircle2 className="size-4 text-success-text" aria-hidden />
                  ) : i === progress ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  ) : (
                    <span className="inline-flex size-4 items-center justify-center" aria-hidden>
                      <span className="size-1.5 rounded-full bg-border-strong" />
                    </span>
                  )}
                  <span className={cn(i > progress && "text-muted-foreground")}>{s}</span>
                  <span className="sr-only">{i < progress ? "done" : i === progress ? "in progress" : "waiting"}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {step === "done" && created && (
          <div className="p-6 text-center sm:p-8">
            <span className="mx-auto mb-4 inline-flex size-11 items-center justify-center rounded-full bg-success/12 text-success-text">
              <Check className="size-5" strokeWidth={2.5} />
            </span>
            <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              {created.name} is ready
            </DialogTitle>
            <DialogDescription className="mx-auto mt-1 max-w-sm">
              {path === "create"
                ? created.repo && created.sync.state !== "no-remote"
                  ? `SelfHub created ${created.repo.owner}/${created.repo.name} with starter files. Everyone you add can open it.`
                  : "Created on this computer with starter files. Connect it to GitHub to share it."
                : `${created.repo ? `${created.repo.owner}/${created.repo.name}` : created.name} is connected. ${created.fileCount} file${created.fileCount === 1 ? " is" : "s are"} ready to read.`}
            </DialogDescription>
            <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
              <Button variant="outline" onClick={reset}>
                Add another
              </Button>
              <Button
                onClick={() => {
                  close(false);
                  guard(() => router.push(`/spaces/${created.id}`));
                }}
              >
                Open {created.name}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
