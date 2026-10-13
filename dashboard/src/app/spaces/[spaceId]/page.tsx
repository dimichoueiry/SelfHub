"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Settings2,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderTree,
  GitPullRequestArrow,
  History,
  Lock,
  MoreHorizontal,
  PencilLine,
  Eye,
  Trash2,
  TextCursorInput,
} from "lucide-react";
import { toast } from "sonner";
import { unmarkRemoved, useFile, usePeople, useRemovedAt, useSpace, useTree } from "@/lib/queries";
import { timeAgo, fullDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileDoc, Space, TreeEntry } from "@/lib/api/types";
import { canEditSpace } from "@/lib/permissions";
import { useAppState } from "@/components/app-state";
import { FileTree } from "@/components/explorer/file-tree";
import { Editor } from "@/components/explorer/editor";
import { HistoryPanel } from "@/components/explorer/history-list";
import { DeleteFileDialog, NewFileDialog, RenameFileDialog } from "@/components/explorer/file-dialogs";
import { proposalsKey, type Proposal } from "@/components/explorer/proposals";
import { FileContent } from "@/components/common/file-content";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function pickDefault(entries: TreeEntry[]) {
  const files = entries.filter((e) => e.type === "file");
  return (
    files.find((f) => f.path === "README.md")?.path ??
    files.find((f) => f.path === "brief.md")?.path ??
    files.find((f) => !f.path.includes("/"))?.path ??
    files[0]?.path ??
    null
  );
}

function TreeSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-busy="true">
      <Skeleton className="h-8 w-full rounded-md" />
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${45 + ((i * 29) % 45)}%`, marginLeft: (i % 3) * 14 }} />
      ))}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto max-w-[68ch] space-y-4 px-6 py-10" aria-busy="true">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-8 h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function Breadcrumb({ space, path }: { space: Space; path: string }) {
  const parts = path.split("/");
  return (
    <nav aria-label="File path" className="flex min-w-0 items-center gap-1 text-sm">
      <span className="hidden shrink-0 text-muted-foreground sm:inline">{space.name}</span>
      {parts.map((p, i) => (
        <span key={i} className={cn("flex min-w-0 items-center gap-1", i < parts.length - 1 && "hidden sm:flex")}>
          <ChevronRight className={cn("size-3.5 shrink-0 text-subtle-foreground", i === 0 && "hidden sm:block")} aria-hidden />
          <span className={cn("truncate", i === parts.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{p}</span>
        </span>
      ))}
    </nav>
  );
}

/** "Locked. Only Maya Chen or Marcus Bell can change it…" → ["Maya Chen", "Marcus Bell"]. */
function namesFromReason(reason: string | undefined): string[] {
  const m = /Only (.+?) can change/.exec(reason ?? "");
  return m ? m[1].split(/,\s*|\s+or\s+|\s+and\s+/).map((n) => n.trim()).filter(Boolean) : [];
}

function LockedNote({ space, file, approverNames }: { space: Space; file: FileDoc; approverNames: string[] }) {
  const names = namesFromReason(file.reason).length ? namesFromReason(file.reason) : approverNames;
  const askWho = names.length ? new Intl.ListFormat("en", { type: "disjunction" }).format(names.slice(0, 2)) : "an approver";
  const suggestUrl = space.repo
    ? `${space.repo.url}/issues/new?title=${encodeURIComponent(`Suggestion: ${file.path}`)}&body=${encodeURIComponent(`What should change in \`${file.path}\`, and why:\n\n`)}`
    : null;
  // Our own sentence, in the same access terms as everywhere else (the API says "read access").
  const sentence = file.locked
    ? (file.reason ?? "This file is locked.")
    : space.writePolicy === "read-only"
      ? `Nobody can save changes to ${space.name} from SelfHub.`
      : `You can view ${space.name}. To edit, ask ${askWho} for Can edit.`;
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-lg border bg-muted/50 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center" role="note">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {file.locked ? <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <p className="min-w-0 font-medium">{sentence}</p>
      </div>
      {suggestUrl && space.writePolicy !== "read-only" && (
        <a
          href={suggestUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-6.5 flex shrink-0 flex-col self-start rounded-md px-2 py-1 text-left hover:bg-primary-soft sm:ml-0 sm:self-auto sm:text-right"
        >
          <span className="text-sm font-medium text-primary">Ask {askWho} for a change</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground sm:justify-end">
            Opens a GitHub issue <ExternalLink className="size-3" aria-hidden />
          </span>
        </a>
      )}
    </div>
  );
}

/** For owners of a locked file: a quiet line on how their changes are saved. */
function OwnerNote({ file }: { file: FileDoc }) {
  return (
    <p className="mb-6 flex items-start gap-2 text-xs text-muted-foreground" role="note">
      <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{file.note}</span>
    </p>
  );
}

function FilePane({
  space,
  path,
  entries,
  onOpenTree,
  onNavigate,
  startEditing,
}: {
  space: Space;
  path: string;
  entries: TreeEntry[];
  onOpenTree: () => void;
  onNavigate: (path: string | null) => void;
  /** Open straight into the editor (e.g. "Open content-calendar.md" from a sync conflict). */
  startEditing?: boolean;
}) {
  const file = useFile(space.id, path);
  const [mode, setMode] = useState<"read" | "history" | "edit">(startEditing ? "edit" : "read");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const returnFocusToEdit = useRef(false);
  useEffect(() => {
    if (mode !== "read" || !returnFocusToEdit.current) return;
    returnFocusToEdit.current = false;
    requestAnimationFrame(() => (editButtonRef.current ?? readerRef.current)?.focus());
  }, [mode]);
  const people = usePeople();
  const approverNames = space.owners.map((o) => people.data?.people.find((p) => p.login === o)?.name ?? o);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { guard } = useAppState();
  const proposals = useQuery<Proposal[]>({ queryKey: proposalsKey(space.id), queryFn: () => [], staleTime: Infinity, gcTime: Infinity });
  const proposal = proposals.data?.find((p) => p.path === path);
  // An owner's change to a locked file in a connected space is reviewed too.
  const review = space.writePolicy === "pull-request" || file.data?.saveMode === "review";
  const existing = entries.filter((e) => e.type === "file").map((e) => e.path);

  const toolbar = (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 md:px-6">
      <Button variant="outline" size="sm" className="lg:hidden" onClick={onOpenTree}>
        <FolderTree /> Files
      </Button>
      <div className="min-w-0 flex-1">
        <Breadcrumb space={space} path={path} />
      </div>
      {file.data && mode !== "edit" && (
        <div className="flex shrink-0 items-center gap-2">
          {mode === "history" ? (
            <Button variant="outline" size="sm" onClick={() => setMode("read")}>
              <ArrowLeft /> Back to file
            </Button>
          ) : (
            file.data.editable && (
              <Button ref={editButtonRef} size="sm" onClick={() => setMode("edit")}>
                <PencilLine /> Edit
              </Button>
            )
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More file actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setMode("history")}>
                <History /> History of this file
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  navigator.clipboard?.writeText(`${space.name}:${path}`);
                  toast.success("Reference copied", { description: `${space.name}:${path}. Paste it into Claude to attach this file.` });
                }}
              >
                <Copy /> Copy file reference
              </DropdownMenuItem>
              {space.repo && (
                <DropdownMenuItem asChild>
                  <a href={`${space.repo.url}/blob/${space.defaultBranch}/${path}`} target="_blank" rel="noreferrer">
                    <ExternalLink /> View on GitHub
                  </a>
                </DropdownMenuItem>
              )}
              {file.data.editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={review} onSelect={() => setRenameOpen(true)}>
                    <TextCursorInput /> Rename or move
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={review} variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                  {review && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      Rename and delete aren&apos;t available in spaces that require review yet. Do them on GitHub.
                    </p>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  if (file.isLoading) {
    return (
      <>
        {toolbar}
        <ReaderSkeleton />
      </>
    );
  }
  // Keep showing the last good copy (and an open editor) if a background refetch fails.
  if (!file.data) {
    return (
      <>
        {toolbar}
        <ErrorState
          error={file.error}
          title="Couldn't open this file"
          onRetry={() => file.refetch()}
        />
      </>
    );
  }

  const doc = file.data;

  if (mode === "edit" && doc.editable) {
    return (
      <Editor
        // Keyed by path, not version: a refetch or sync must never remount (and wipe) the draft.
        key={doc.path}
        space={space}
        file={doc}
        onClose={() => {
          // The editor unmounts; put focus somewhere sensible (the Edit button, else the file title).
          returnFocusToEdit.current = true;
          setMode("read");
        }}
      />
    );
  }

  return (
    <>
      {toolbar}
      <div
        className="scroll-thin min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        // Long files with no links still need arrow and page keys to scroll.
        tabIndex={0}
        role="region"
        aria-label={`Contents of ${path.split("/").pop()}`}
        ref={readerRef}
      >
        {mode === "history" ? (
          <HistoryPanel spaceId={space.id} path={path} />
        ) : (
          <article className="mx-auto w-full max-w-[calc(68ch+4rem)] px-5 pt-6 pb-24 md:px-8 md:pt-8">
            {!doc.editable && <LockedNote space={space} file={doc} approverNames={approverNames} />}
            {doc.owned && doc.note && <OwnerNote file={doc} />}
            <div className="mb-6">
              {doc.lastCommit ? (
                <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <UserAvatar login={doc.lastCommit.author.login} name={doc.lastCommit.author.name} avatarUrl={doc.lastCommit.author.avatarUrl} size="xs" />
                  <span className="truncate">
                    Last edited by <span className="font-medium text-foreground">{doc.lastCommit.author.name}</span>{" "}
                    <time dateTime={doc.lastCommit.date} title={fullDate(doc.lastCommit.date)}>
                      {timeAgo(doc.lastCommit.date)}
                    </time>
                    <span className="hidden md:inline"> · &ldquo;{doc.lastCommit.message}&rdquo;</span>
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Not saved to history yet. This file only exists in the local copy.</p>
              )}
            </div>
            {proposal && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary-soft/60 px-3.5 py-3 text-sm" role="status">
                <GitPullRequestArrow className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">You proposed a change {timeAgo(proposal.date)}</p>
                  <p className="text-muted-foreground">
                    &ldquo;{proposal.message}&rdquo; is waiting for review. This page shows the approved version until then.

                  </p>
                </div>
                {proposal.prUrl && (
                  <a href={proposal.prUrl} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-primary hover:underline">
                    Open review
                  </a>
                )}
              </div>
            )}
            {doc.binary ? (
              <EmptyState icon={FileText} title="This file can't be shown here">
                It isn&apos;t text. Open it on GitHub or in a desktop app.
              </EmptyState>
            ) : doc.content.trim() ? (
              <FileContent path={doc.path} content={doc.content} format={doc.format} />
            ) : (
              <EmptyState
                icon={FileText}
                title="This file is empty"
                action={doc.editable ? <Button onClick={() => setMode("edit")}>Start writing</Button> : undefined}
              >
                {doc.editable ? "Add the first lines and save." : "Nothing has been written here yet."}
              </EmptyState>
            )}
          </article>
        )}
      </div>
      <RenameFileDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        space={space}
        file={doc}
        existing={existing}
        onRenamed={(p) => guard(() => onNavigate(p))}
      />
      <DeleteFileDialog open={deleteOpen} onOpenChange={setDeleteOpen} space={space} path={path} onDeleted={() => onNavigate(null)} />
    </>
  );
}

function Explorer() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: space } = useSpace(spaceId);
  const tree = useTree(spaceId, !!space && space.myAccess !== "none");
  const { guard } = useAppState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const requested = search.get("path");
  // System files (.github/, .selfhub/) are hidden unless an admin asks for them, or a link
  // points straight at one.
  const [showSystem, setShowSystem] = useState(false);
  const isSystem = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
  const isSystemEntry = (e: TreeEntry) => e.system ?? isSystem(e.path);
  const allEntries = useMemo(() => tree.data ?? [], [tree.data]);
  const revealSystem = showSystem || (!!requested && isSystem(requested));
  const entries = useMemo(
    () => (revealSystem ? allEntries : allEntries.filter((e) => !(e.system ?? e.path.split("/").some((seg) => seg.startsWith("."))))),
    [allEntries, revealSystem],
  );
  const fallback = useMemo(() => pickDefault(entries), [entries]);
  const exists = requested ? entries.some((e) => e.path === requested && e.type === "file") : false;
  // A path this person just renamed or deleted: fall back quietly, never fetch it or report it.
  const removedAt = useRemovedAt(spaceId, requested);
  const wasRemoved = removedAt !== undefined;
  const justRemoved = wasRemoved && !exists;
  // While the tree is refetching (e.g. right after a rename), trust the requested path.
  const path = requested && !justRemoved && (exists || !tree.data || tree.isFetching) ? requested : fallback;

  useEffect(() => {
    // Someone added the file back (a sync, say): it's a normal path again.
    if (removedAt !== undefined && exists && !tree.isFetching && tree.dataUpdatedAt > removedAt) unmarkRemoved(spaceId, requested!);
  }, [removedAt, exists, tree.isFetching, tree.dataUpdatedAt, spaceId, requested]);

  useEffect(() => {
    if (tree.data && !tree.isFetching && requested && !exists && !justRemoved) {
      toast.info(`${requested} isn't in ${space?.name ?? "this space"}`, { description: "It may have been renamed or deleted. Showing the space's main file." });
    }
  }, [tree.data, tree.isFetching, requested, exists, justRemoved, space?.name]);

  if (!space) return null;

  const open = (p: string | null) =>
    guard(() => {
      setSheetOpen(false);
      router.push(p ? `/spaces/${space.id}?path=${encodeURIComponent(p)}` : `/spaces/${space.id}`);
    });
  const canCreate = canEditSpace(space);
  const folder = path?.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  const treePane = (inSheet: boolean) => (
    <>
      <div className={cn("flex h-10 shrink-0 items-center justify-between border-b px-3", inSheet && "h-12 pr-12")}>
        <span className="text-xs font-medium text-muted-foreground">
          Files{tree.data ? ` · ${entries.filter((e) => e.type === "file").length}` : ""}
        </span>
        <div className="flex items-center">
        {space.myAccess === "admin" && allEntries.some(isSystemEntry) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Show system files"
                aria-pressed={showSystem}
                onClick={() => setShowSystem(!showSystem)}
                className={cn("text-muted-foreground", showSystem && "bg-primary-soft text-primary")}
              >
                <Settings2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showSystem ? "Hide system files" : "Show system files"}</TooltipContent>
          </Tooltip>
        )}
        {canCreate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="New file" onClick={() => setNewOpen(true)} className="text-muted-foreground">
                <FilePlus2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New file</TooltipContent>
          </Tooltip>
        )}
        </div>
      </div>
      {tree.isLoading ? (
        <TreeSkeleton />
      ) : tree.error ? (
        <ErrorState error={tree.error} title="Couldn't load files" onRetry={() => tree.refetch()} className="py-8" />
      ) : (
        <FileTree entries={entries} selected={path} onOpen={(p) => open(p)} className="flex-1" />
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Files in this space" className="hidden w-[264px] shrink-0 flex-col border-r bg-sidebar/50 lg:flex">
        {treePane(false)}
      </aside>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="left"
          className="w-[300px] max-w-[85vw] gap-0 p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
          }}
        >
          <SheetTitle className="sr-only">Files in {space.name}</SheetTitle>
          <SheetDescription className="sr-only">Pick a file to read</SheetDescription>
          <div className="flex h-full flex-col">{treePane(true)}</div>
        </SheetContent>
      </Sheet>

      <section aria-label="File" className="flex min-w-0 flex-1 flex-col">
        {tree.isLoading ? (
          <ReaderSkeleton />
        ) : path ? (
          <FilePane
            // Remount when "open in editor" is requested for the file already showing.
            key={`${path}:${search.get("edit") === "1" ? "edit" : "read"}`}
            space={space}
            path={path}
            entries={entries}
            onOpenTree={() => setSheetOpen(true)}
            onNavigate={open}
            startEditing={search.get("edit") === "1" && path === requested}
          />
        ) : !tree.error ? (
          <EmptyState
            icon={FileText}
            title="This space is empty"
            className="py-24"
            action={canCreate ? <Button onClick={() => setNewOpen(true)}><FilePlus2 /> New file</Button> : undefined}
          >
            {canCreate ? "Add the first file. A brief or a README is a good start." : "Nobody has added files yet."}
          </EmptyState>
        ) : null}
      </section>

      {canCreate && (
        <NewFileDialog open={newOpen} onOpenChange={setNewOpen} space={space} folder={folder} existing={entries.map((e) => e.path)} onCreated={(p) => open(p)} />
      )}
    </div>
  );
}

export default function FilesPage() {
  return (
    <Suspense fallback={<ReaderSkeleton />}>
      <Explorer />
    </Suspense>
  );
}
