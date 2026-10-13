"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Lock, Search, X } from "lucide-react";
import type { TreeEntry } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface Node {
  entry: TreeEntry;
  children: Node[];
  depth: number;
  /** Position among siblings, for aria-posinset / aria-setsize. */
  pos: number;
  size: number;
}

function build(entries: TreeEntry[]): Node[] {
  const byPath = new Map<string, Node>();
  const roots: Node[] = [];
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) byPath.set(e.path, { entry: e, children: [], depth: e.path.split("/").length - 1, pos: 1, size: 1 });
  for (const node of byPath.values()) {
    const parent = node.entry.path.includes("/") ? byPath.get(node.entry.path.slice(0, node.entry.path.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const order = (list: Node[]) => {
    // Folders first, then files; alphabetical within each.
    list.sort((a, b) => (a.entry.type === b.entry.type ? a.entry.name.localeCompare(b.entry.name) : a.entry.type === "dir" ? -1 : 1));
    list.forEach((n, i) => {
      n.pos = i + 1;
      n.size = list.length;
      order(n.children);
    });
  };
  order(roots);
  return roots;
}

function flatten(nodes: Node[], expanded: Set<string>, out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (n.entry.type === "dir" && expanded.has(n.entry.path)) flatten(n.children, expanded, out);
  }
  return out;
}

export function FileTree({
  entries,
  selected,
  onOpen,
  className,
}: {
  entries: TreeEntry[];
  selected: string | null;
  onOpen: (path: string) => void;
  className?: string;
}) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const visibleEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    const files = entries.filter((e) => e.type === "file" && e.path.toLowerCase().includes(q));
    const keep = new Set<string>();
    for (const f of files) {
      keep.add(f.path);
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) keep.add(parts.slice(0, i).join("/"));
    }
    return entries.filter((e) => keep.has(e.path));
  }, [entries, filter]);

  const tree = useMemo(() => build(visibleEntries), [visibleEntries]);
  const expanded = useMemo(() => {
    const all = new Set(visibleEntries.filter((e) => e.type === "dir").map((e) => e.path));
    if (!filter.trim()) for (const c of collapsed) all.delete(c);
    return all;
  }, [visibleEntries, collapsed, filter]);
  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  const activePath = focused && rows.some((r) => r.entry.path === focused) ? focused : (selected ?? rows[0]?.entry.path ?? null);

  const toggle = (path: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(path);
      if (open ?? !isOpen) next.delete(path);
      else next.add(path);
      return next;
    });

  function focusRow(path: string) {
    setFocused(path);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent, node: Node) {
    const i = rows.indexOf(node);
    const isDir = node.entry.type === "dir";
    const isOpen = isDir && expanded.has(node.entry.path);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows[i + 1]) focusRow(rows[i + 1].entry.path);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rows[i - 1]) focusRow(rows[i - 1].entry.path);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (isDir && !isOpen) toggle(node.entry.path, true);
        else if (isDir && node.children[0]) focusRow(node.children[0].entry.path);
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (isDir && isOpen) toggle(node.entry.path, false);
        else if (node.entry.path.includes("/")) focusRow(node.entry.path.slice(0, node.entry.path.lastIndexOf("/")));
        break;
      }
      case "Home":
        e.preventDefault();
        if (rows[0]) focusRow(rows[0].entry.path);
        break;
      case "End":
        e.preventDefault();
        if (rows.length) focusRow(rows[rows.length - 1].entry.path);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (isDir) toggle(node.entry.path);
        else onOpen(node.entry.path);
        break;
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative shrink-0 px-3 pt-3 pb-2">
        <Search className="pointer-events-none absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && rows[0]) {
              e.preventDefault();
              focusRow(rows[0].entry.path);
            }
            if (e.key === "Escape") setFilter("");
          }}
          placeholder="Find a file"
          aria-label="Find a file in this space"
          className="h-8 w-full rounded-md border bg-surface pr-7 pl-7.5 text-sm max-md:h-10 outline-none placeholder:text-subtle-foreground focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {filter && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => setFilter("")}
            className="absolute top-1/2 right-5 -translate-y-1/2 rounded p-0.5 text-subtle-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {filter ? <>No files match &ldquo;{filter}&rdquo;.</> : "This space has no files yet."}
        </p>
      ) : (
        <ul ref={listRef} role="tree" aria-label="Files" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {rows.map((node) => {
            const { entry } = node;
            const isDir = entry.type === "dir";
            const isOpen = isDir && expanded.has(entry.path);
            const isSelected = !isDir && entry.path === selected;
            const Icon = isDir ? (isOpen ? FolderOpen : Folder) : FileText;
            return (
              <li
                key={entry.path}
                role="treeitem"
                data-path={entry.path}
                aria-level={node.depth + 1}
                aria-posinset={node.pos}
                aria-setsize={node.size}
                aria-describedby={entry.locked && entry.reason ? `lock-${entry.path}` : undefined}
                aria-expanded={isDir ? isOpen : undefined}
                aria-selected={isSelected}
                aria-label={`${entry.name}${entry.locked ? ", locked" : ""}`}
                tabIndex={entry.path === activePath ? 0 : -1}
                onFocus={() => setFocused(entry.path)}
                onKeyDown={(e) => onKeyDown(e, node)}
                onClick={() => {
                  setFocused(entry.path);
                  if (isDir) toggle(entry.path);
                  else onOpen(entry.path);
                }}
                title={entry.locked && entry.reason ? entry.reason : undefined}
                style={{ paddingLeft: 8 + node.depth * 14 }}
                className={cn(
                  "group flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 text-sm outline-none select-none max-md:h-10",
                  "text-foreground/85 transition-colors duration-100 hover:bg-muted",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isSelected && "bg-primary-soft font-medium text-foreground hover:bg-primary-soft",
                )}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150",
                    isOpen && "rotate-90",
                    !isDir && "invisible",
                  )}
                  aria-hidden
                />
                <Icon className={cn("size-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.locked && <Lock className="size-3 shrink-0 text-subtle-foreground" aria-hidden />}
                {entry.locked && entry.reason && (
                  <span id={`lock-${entry.path}`} className="sr-only">
                    {entry.reason}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
