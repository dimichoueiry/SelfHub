import type { Me, Rule, Space } from "@/lib/api/types";

export function canApproveRule(rule: Rule, space: Space | undefined, me: Me | undefined) {
  if (!space || !me) return false;
  return space.owners.includes(me.login) || space.myAccess === "admin";
}

export function canEditSpace(space: Space) {
  return (space.myAccess === "write" || space.myAccess === "admin") && space.writePolicy !== "read-only";
}

export function ownersText(space: Pick<Space, "owners">) {
  return space.owners.map((o) => `@${o}`).join(", ");
}
