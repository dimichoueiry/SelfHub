"use client";

import { useParams } from "next/navigation";
import { useSpace } from "@/lib/queries";
import { MembersPanel } from "@/components/people/members-panel";

export default function SpaceMembersPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { data: space } = useSpace(spaceId);
  if (!space) return null;
  return (
    <div className="w-full max-w-[1120px] px-5 py-6 md:px-8 md:py-8">
      <MembersPanel space={space} />
    </div>
  );
}
