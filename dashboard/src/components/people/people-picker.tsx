"use client";

import { useId, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { usePeople } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/user-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Pick people from the org (with avatars). Value is a list of logins. */
export function PeoplePicker({
  id,
  value,
  onChange,
  placeholder = "Choose people",
  describedBy,
}: {
  id?: string;
  value: string[];
  onChange: (logins: string[]) => void;
  placeholder?: string;
  describedBy?: string;
}) {
  const { data } = usePeople();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const people = data?.people ?? [];
  const selected = value.map((login) => people.find((p) => p.login === login) ?? { login, name: login, avatarUrl: "" });
  const toggle = (login: string) => onChange(value.includes(login) ? value.filter((l) => l !== login) : [...value, login]);

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-describedby={describedBy}
            className="flex min-h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-10"
          >
            <span className={cn("min-w-0 flex-1 truncate", !selected.length && "text-muted-foreground")}>
              {selected.length ? `${selected.length} chosen` : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent id={listId} align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <CommandPrimitive label="People" className="flex flex-col">
            <CommandPrimitive.Input
              placeholder="Search people"
              className="h-10 border-b bg-transparent px-3 text-sm outline-none placeholder:text-subtle-foreground"
            />
            <CommandPrimitive.List className="scroll-thin max-h-64 overflow-y-auto p-1">
              <CommandPrimitive.Empty className="px-3 py-4 text-center text-sm text-muted-foreground">Nobody matches.</CommandPrimitive.Empty>
              {people.map((p) => {
                const on = value.includes(p.login);
                return (
                  <CommandPrimitive.Item
                    key={p.login}
                    value={`${p.name} ${p.login}`}
                    onSelect={() => toggle(p.login)}
                    className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-primary-soft max-md:min-h-10"
                  >
                    <UserAvatar login={p.login} name={p.name} avatarUrl={p.avatarUrl} size="xs" />
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      {p.title && <span className="text-muted-foreground"> · {p.title}</span>}
                    </span>
                    <Check className={cn("size-4 text-primary", !on && "invisible")} aria-hidden />
                    <span className="sr-only">{on ? "chosen" : ""}</span>
                  </CommandPrimitive.Item>
                );
              })}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen">
          {selected.map((p) => (
            <li key={p.login} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-1 pl-0.5 text-xs">
              <UserAvatar login={p.login} name={p.name} avatarUrl={p.avatarUrl} size="xs" />
              {p.name}
              <button
                type="button"
                onClick={() => toggle(p.login)}
                aria-label={`Remove ${p.name}`}
                className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
