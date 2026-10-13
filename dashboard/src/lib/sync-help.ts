import type { Space } from "@/lib/api/types";

/** Where "Resolve" / "Open <file>" goes: the conflicted file, opened in the editor. */
export function resolveHref(space: Space) {
  const file = space.sync.conflict?.path;
  return file ? `/spaces/${space.id}?path=${encodeURIComponent(file)}&edit=1` : `/spaces/${space.id}`;
}
