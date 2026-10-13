import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="This page doesn't exist"
      className="py-28"
      action={
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      }
    >
      The link may be old, or the space it pointed to was removed.
    </EmptyState>
  );
}
