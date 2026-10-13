import { parsePatch, type DiffOp } from "@/lib/diff";
import { cn } from "@/lib/utils";

const rowTone = {
  add: "bg-success/10",
  del: "bg-danger/9",
  same: "",
  hunk: "",
  meta: "text-subtle-foreground",
};

function Sign({ kind }: { kind: "add" | "del" | "same" | "hunk" | "meta" }) {
  if (kind === "add") return <span className="text-success-text">+</span>;
  if (kind === "del") return <span className="text-danger-text">−</span>;
  return <span> </span>;
}

/** Unified diff with line numbers and +/− markers (never color alone). */
export function DiffView({ patch, className, emptyText }: { patch: string; className?: string; emptyText?: string }) {
  // Hunk headers ("@@ -9,7 +9,7 @@") mean nothing to most readers; a gap marks the jump instead.
  const lines = parsePatch(patch).filter((l) => l.kind !== "meta");
  if (!lines.length) return <p className="p-4 text-sm text-muted-foreground">{emptyText ?? "No text changes in this file."}</p>;
  return (
    <div className={cn("scroll-thin relative overflow-x-auto rounded-lg border bg-surface font-mono text-[12.5px] leading-5", className)}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={rowTone[l.kind]}>
              {l.kind === "hunk" ? (
                <td colSpan={4} className="h-2 p-0" aria-hidden>
                  {i > 0 && <span className="block border-t border-dashed border-border" />}
                </td>
              ) : (
                <>
                  <td className="w-10 border-r border-border/60 px-2 text-right text-muted-foreground select-none">{l.oldNo ?? ""}</td>
                  <td className="w-10 border-r border-border/60 px-2 text-right text-muted-foreground select-none">{l.newNo ?? ""}</td>
                  <td className="w-5 pl-2 select-none" aria-label={l.kind === "add" ? "added" : l.kind === "del" ? "removed" : undefined}>
                    <Sign kind={l.kind} />
                  </td>
                  <td className="pr-4 whitespace-pre-wrap break-words">{l.text || " "}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Changed lines with a little context; long unchanged runs collapse. Used by the conflict view. */
export function OpsView({ ops, className, context = 2 }: { ops: DiffOp[]; className?: string; context?: number }) {
  const near = ops.map((_, i) => ops.slice(Math.max(0, i - context), i + context + 1).some((o) => o.type !== "same"));
  const rows: ({ op: DiffOp } | { skipped: number })[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (near[i]) rows.push({ op: ops[i] });
    else {
      const last = rows[rows.length - 1];
      if (last && "skipped" in last) last.skipped++;
      else rows.push({ skipped: 1 });
    }
  }
  return (
    <div className={cn("scroll-thin overflow-auto rounded-lg border bg-surface font-mono text-[12.5px] leading-5", className)}>
      {rows.map((row, i) =>
        "skipped" in row ? (
          <div key={i} className="bg-muted/60 px-3 py-0.5 font-sans text-[11px] text-subtle-foreground">
            {row.skipped} unchanged line{row.skipped === 1 ? "" : "s"}
          </div>
        ) : (
          <div key={i} className={cn("flex", row.op.type === "add" && "bg-success/10", row.op.type === "del" && "bg-danger/9")}>
            <span className="w-6 shrink-0 pl-2 select-none">
              <Sign kind={row.op.type === "same" ? "same" : row.op.type} />
            </span>
            <span className="pr-4 whitespace-pre-wrap break-words">{row.op.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
