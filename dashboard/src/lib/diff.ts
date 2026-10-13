// Small line diff used by the mock adapter (to produce patches) and by the conflict view.
// Files are short markdown documents, so an O(n·m) LCS table is fine.

export type DiffOp = { type: "same" | "add" | "del"; text: string };

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "del", text: a[i++] });
    } else {
      ops.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });
  return ops;
}

export function countChanges(ops: DiffOp[]) {
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "add") additions++;
    else if (op.type === "del") deletions++;
  }
  return { additions, deletions };
}

/** Unified diff with 3 lines of context, in the shape `git show` prints. */
export function unifiedPatch(path: string, before: string, after: string, context = 3): string {
  const ops = diffLines(before, after);
  const header = before === "" ? `--- /dev/null\n+++ b/${path}\n` : `--- a/${path}\n+++ b/${path}\n`;
  const hunks: string[] = [];
  let k = 0;
  let oldLine = 1;
  let newLine = 1;
  const positions = ops.map((op) => {
    const pos = { op, oldLine, newLine };
    if (op.type !== "add") oldLine++;
    if (op.type !== "del") newLine++;
    return pos;
  });
  while (k < positions.length) {
    if (positions[k].op.type === "same") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    let lastChange = k;
    while (end < positions.length && end - lastChange <= context * 2) {
      if (positions[end].op.type !== "same") lastChange = end;
      end++;
    }
    end = Math.min(positions.length, lastChange + context + 1);
    const slice = positions.slice(start, end);
    const oldCount = slice.filter((p) => p.op.type !== "add").length;
    const newCount = slice.filter((p) => p.op.type !== "del").length;
    const oldStart = oldCount === 0 ? slice[0].oldLine - 1 : slice[0].oldLine;
    const newStart = newCount === 0 ? slice[0].newLine - 1 : slice[0].newLine;
    const lines = slice.map((p) => (p.op.type === "add" ? "+" : p.op.type === "del" ? "-" : " ") + p.op.text);
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${lines.join("\n")}`);
    k = end;
  }
  return header + hunks.join("\n");
}

export interface PatchLine {
  kind: "hunk" | "add" | "del" | "same" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export function parsePatch(patch: string): PatchLine[] {
  const out: PatchLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  // Everything between "diff --git" and the first "@@" is git's file header
  // (index, mode, rename, ---/+++). None of it is content.
  let inHeader = true;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git") || line.startsWith("diff ")) {
      inHeader = true;
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("@@")) {
      inHeader = false;
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      out.push({ kind: "hunk", text: line });
    } else if (inHeader || line.startsWith("\\")) {
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      out.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    } else if (line.startsWith("-")) {
      out.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    } else if (line === "" ) {
      // Trailing newline at the end of the patch.
      continue;
    } else {
      out.push({ kind: "same", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}
