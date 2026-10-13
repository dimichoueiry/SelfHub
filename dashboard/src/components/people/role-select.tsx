"use client";

import type { Role } from "@/lib/api/types";
import { roleHelp, roleLabel } from "@/lib/labels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Admin / Can edit / Can view, optionally with "No access" (which the caller confirms). */
export function RoleSelect({
  value,
  onChange,
  disabled,
  label,
  className,
  allowNone = false,
}: {
  value: Role;
  onChange: (role: Role | "none") => void;
  disabled?: boolean;
  label: string;
  className?: string;
  allowNone?: boolean;
}) {
  const options: (Role | "none")[] = allowNone ? ["admin", "write", "read", "none"] : ["admin", "write", "read"];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role | "none")} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={label} className={className ?? "w-[120px]"}>
        <SelectValue>{roleLabel[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((r) => (
          <SelectItem key={r} value={r}>
            <span className="flex flex-col">
              <span>{roleLabel[r]}</span>
              <span className="text-xs text-muted-foreground">{roleHelp[r]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
