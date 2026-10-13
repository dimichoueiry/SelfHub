import { Eye, Lock, ShieldCheck } from "lucide-react";
import type { Space } from "@/lib/api/types";
import { roleLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function explain(space: Space, lockedFile: boolean) {
  if (lockedFile) return "Locked files are rules every task follows. Only their approvers change them, through review.";
  if (space.myAccess === "none") return "Access comes from GitHub. Ask an admin of this space to add you.";
  if (space.writePolicy === "read-only") return "Nobody can save changes to this space from SelfHub.";
  if (space.myAccess === "read") return "You can open every file here, but not change them.";
  const policy =
    space.writePolicy === "pull-request"
      ? "Your changes are proposed for review and apply once an approver accepts them."
      : "Your saves go straight to GitHub.";
  const locked = space.lockedPaths.some((p) => !p.startsWith("."))
    ? " Locked files can only be changed by approvers."
    : "";
  return `${policy}${locked}`;
}

/** Your access, as a quiet status line (not a button). */
export function AccessChip({ space, lockedFile = false, className }: { space: Space; lockedFile?: boolean; className?: string }) {
  const access = space.writePolicy === "read-only" && space.myAccess !== "none" ? "read" : space.myAccess;
  const Icon = lockedFile || access === "none" ? Lock : access === "read" ? Eye : ShieldCheck;
  const label = lockedFile ? "This file is locked" : roleLabel[access];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground", className)}>
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">Your access: </span>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{explain(space, lockedFile)}</TooltipContent>
    </Tooltip>
  );
}
