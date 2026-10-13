import { getApi } from "@/lib/api/client";
import type { Member, Role } from "@/lib/api/types";

/** Move one person's access in one space from `from` to `to`. Returns the updated member list. */
export async function changeAccess(spaceId: string, login: string, from: Role | "none", to: Role | "none"): Promise<Member[] | undefined> {
  const api = getApi();
  if (from === to) return undefined;
  if (to === "none") return api.removeMember(spaceId, login);
  if (from === "none") return api.addMember(spaceId, { login, role: to });
  return api.updateMember(spaceId, login, to);
}
