import { cn } from "@/lib/utils";
import type { Role } from "@/lib/api/types";
import { roleHelp, roleLabel } from "@/lib/labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Status style: tinted, borderless. Strongest role reads strongest.
const tone: Record<Role | "none", string> = {
  admin: "bg-primary-soft text-primary",
  write: "bg-muted text-foreground",
  read: "text-muted-foreground",
  none: "text-subtle-foreground",
};

export function RolePill({ role, tooltip = true, className }: { role: Role | "none"; tooltip?: boolean; className?: string }) {
  const pill = (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium",
        tone[role],
        className,
      )}
    >
      {role === "none" ? (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">No access</span>
        </>
      ) : (
        roleLabel[role]
      )}
    </span>
  );
  if (!tooltip || role === "none") return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-md">
          {pill}
        </span>
      </TooltipTrigger>
      <TooltipContent>{roleHelp[role]}</TooltipContent>
    </Tooltip>
  );
}
