"use client";

import { apiMode } from "@/lib/api/client";
import { DEMO_LOGINS } from "@/lib/api/http";
import type { Person } from "@/lib/api/types";
import { usePeople } from "@/lib/queries";
import type { DemoUser } from "@/lib/demo-user";

/** The login each demo persona has in the current data source. */
export function demoLogin(user: DemoUser) {
  return apiMode === "http" ? DEMO_LOGINS[user] : user;
}

/** The two demo personas, with names and titles from /api/people (never hardcoded). */
export function useDemoPeople(): Record<DemoUser, Person | undefined> {
  const { data } = usePeople();
  const find = (user: DemoUser) => data?.people.find((p) => p.login === demoLogin(user));
  return { sam: find("sam"), maya: find("maya") };
}

export const demoFallback: Record<DemoUser, string> = { sam: "the ads specialist", maya: "the admin" };
