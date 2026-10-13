"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { cn } from "@/lib/utils";

export type FileKind = "markdown" | "csv" | "text";

export function fileKind(path: string): FileKind {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.csv$/i.test(path)) return "csv";
  return "text";
}

/** For labels: "markdown", "CSV", "text". */
export const fileKindLabel: Record<FileKind, string> = { markdown: "markdown", csv: "CSV", text: "text" };

/** Minimal RFC 4180 parser: commas, quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** True while there's more to scroll to on the right (drives the edge fade). */
function useMoreToRight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return { ref, more };
}

function CsvTable({ content }: { content: string }) {
  const [head, ...body] = parseCsv(content);
  const { ref, more } = useMoreToRight<HTMLDivElement>();
  if (!head) return <p className="text-sm text-muted-foreground">This file is empty.</p>;
  return (
    <div className="md relative">
      {/* Edge fade: a visible cue that the table scrolls sideways. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-px right-px z-10 w-10 rounded-r-lg bg-gradient-to-l from-background to-transparent transition-opacity duration-150",
          more ? "opacity-100" : "opacity-0",
        )}
      />
      <div ref={ref} className="table-wrap" tabIndex={0} role="region" aria-label={more ? "Table, scrolls sideways" : "Table"}>
        <table>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>
                {head.map((_, j) => (
                  <td key={j} className="font-mono text-[13px]">
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Render a file by its type: markdown as prose, CSV as a table, anything else as plain text. */
export function FileContent({
  path,
  content,
  format,
  className,
}: {
  path: string;
  content: string;
  /** The API's File.format, when known; otherwise the extension decides. */
  format?: "markdown" | "csv" | "json" | "text" | "binary";
  className?: string;
}) {
  const kind: FileKind = format === "markdown" || format === "csv" ? format : format ? "text" : fileKind(path);
  if (kind === "markdown") return <Markdown content={content} className={className} />;
  if (kind === "csv") return <CsvTable content={content} />;
  return (
    <pre className={cn("max-w-[68ch] overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-[13px] leading-5 whitespace-pre-wrap", className)}>
      {content}
    </pre>
  );
}
