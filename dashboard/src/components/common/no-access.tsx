"use client";

import { Copy, ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";
import type { Space } from "@/lib/api/types";
import { useMe, usePeople } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function NoAccessState({ space, className }: { space: Space; className?: string }) {
  const { data: me } = useMe();
  const { data: people } = usePeople();
  const names = space.owners.map((o) => people?.people.find((p) => p.login === o)?.name ?? o);
  const who = names.length ? new Intl.ListFormat("en", { type: "disjunction" }).format(names) : "an admin of this space";
  const request = [
    `Hi${names.length === 1 ? ` ${names[0].split(" ")[0]}` : ""}, could you give me access to ${space.name} in SelfHub?`,
    space.repo ? `It's on GitHub here: ${space.repo.url}` : null,
    me ? `My GitHub username is ${me.login}. Thanks, ${me.name.split(" ")[0]}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center justify-center px-6 py-20 text-center", className)}>
      <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border bg-surface text-muted-foreground">
        <Lock className="size-[18px]" aria-hidden />
      </span>
      <h3 className="text-base font-medium">You don&apos;t have access to {space.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Access comes from GitHub. Ask {who} to add you, and it shows up here within a minute.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          onClick={() => {
            navigator.clipboard?.writeText(request);
            toast.success("Access request copied", { description: `Paste it to ${who} in chat or email.` });
          }}
        >
          <Copy /> Copy access request
        </Button>
        {space.repo?.url && (
          <Button variant="ghost" asChild>
            <a href={space.repo.url} target="_blank" rel="noreferrer">
              Open on GitHub <ExternalLink aria-hidden />
            </a>
          </Button>
        )}
      </div>
      <p className="mt-4 text-xs text-subtle-foreground">Agents also skip this space for you, so its files never end up in your work.</p>
    </div>
  );
}
