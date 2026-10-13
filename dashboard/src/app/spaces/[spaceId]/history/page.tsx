"use client";

import { useParams, useRouter } from "next/navigation";
import { HistoryPanel } from "@/components/explorer/history-list";

export default function SpaceHistoryPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const router = useRouter();
  return (
    <div className="w-full max-w-[1120px]">
      <HistoryPanel spaceId={spaceId} onOpenFile={(p) => router.push(`/spaces/${spaceId}?path=${encodeURIComponent(p)}`)} />
    </div>
  );
}
