import { Briefcase, Building2, User, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpaceKind } from "@/lib/api/types";
import { kindLabel } from "@/lib/labels";

export const kindIcon: Record<SpaceKind, LucideIcon> = {
  org: Building2,
  team: Users,
  client: Briefcase,
  personal: User,
};

const tone: Record<SpaceKind, string> = {
  org: "text-kind-org bg-kind-org/10",
  team: "text-kind-team bg-kind-team/12",
  client: "text-kind-client bg-kind-client/14",
  personal: "text-kind-personal bg-kind-personal/12",
};

// Monogram letters are the only visible label in the 1024 rail, so they use the foreground
// colour (≥4.5:1 everywhere). The kind's colour lives on the tile tint and its ring.
const monoTone: Record<SpaceKind, string> = {
  org: "bg-kind-org/12 ring-kind-org/45",
  team: "bg-kind-team/14 ring-kind-team/55",
  client: "bg-kind-client/18 ring-kind-client/60",
  personal: "bg-kind-personal/14 ring-kind-personal/55",
};

const sizes = {
  xs: "size-4 rounded-[4px] [&_svg]:size-2.5",
  sm: "size-5 rounded-[5px] [&_svg]:size-3",
  md: "size-7 rounded-md [&_svg]:size-3.5",
  lg: "size-9 rounded-lg [&_svg]:size-4.5",
};

const VOWELS = /[aeiouy]/i;

/**
 * Two letters for a space: "Apex Roofing" → "AR", "Northline" → "NL" (North|line).
 * One-word names take the start of the word's last part, so they never spell a word
 * like "No" next to the rail's lock badges.
 */
export function monogram(name: string) {
  const words = name.replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? "?";
  if (w.length < 3) return w.toUpperCase();
  // Last consonant that follows another consonant and precedes a vowel: "Nort|h|line" → "l".
  for (let i = w.length - 2; i >= 2; i--) {
    if (!VOWELS.test(w[i - 1]) && !VOWELS.test(w[i]) && VOWELS.test(w[i + 1])) return (w[0] + w[i]).toUpperCase();
  }
  const consonant = [...w.slice(1)].find((c) => !VOWELS.test(c));
  return (w[0] + (consonant ?? w[1])).toUpperCase();
}

export function KindGlyph({
  kind,
  size = "sm",
  className,
  label = true,
  monogram: text,
}: {
  kind: SpaceKind;
  size?: keyof typeof sizes;
  className?: string;
  /** Adds an accessible name. Turn off when the kind is written next to it. */
  label?: boolean;
  /** Show these letters instead of the kind icon (the collapsed rail). */
  monogram?: string;
}) {
  const Icon = kindIcon[kind];
  if (text) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tracking-tight text-foreground ring-1 ring-inset",
          monoTone[kind],
          className,
        )}
      >
        {/* Drawn with CSS so it isn't part of the link's text: the link's label carries the
            full name, and assistive tech doesn't hear "AT". */}
        <span data-mono={text} className="before:content-[attr(data-mono)]" />
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", tone[kind], sizes[size], className)}
      role={label ? "img" : undefined}
      aria-label={label ? `${kindLabel[kind]} space` : undefined}
      aria-hidden={label ? undefined : true}
    >
      <Icon strokeWidth={2.2} />
    </span>
  );
}
