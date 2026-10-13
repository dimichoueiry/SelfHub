import type { QueryClient } from "@tanstack/react-query";

// Changes proposed in review-required spaces. The API returns a PR link but the file on
// main doesn't change until it's approved, so the reader remembers them for this session.

export interface Proposal {
  path: string;
  prUrl: string;
  branch?: string;
  date: string;
  message: string;
}

export const proposalsKey = (spaceId: string) => ["proposals", spaceId] as const;

export function addProposal(qc: QueryClient, spaceId: string, p: Proposal) {
  qc.setQueryData<Proposal[]>(proposalsKey(spaceId), (prev = []) => [p, ...prev]);
}
