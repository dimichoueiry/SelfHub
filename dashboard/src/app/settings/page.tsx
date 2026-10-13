"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useMe } from "@/lib/queries";
import { useDemoPeople } from "@/lib/use-demo-people";
import { usePageTitle } from "@/lib/use-page-title";
import { apiMode } from "@/lib/api/client";
import { setDemoUser, getDemoUser, subscribeDemoUser, serverDemoUser } from "@/lib/demo-user";
import { Page, PageHeader } from "@/components/common/page";
import { UserAvatar } from "@/components/common/user-avatar";
import { DemoPill } from "@/components/shell/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppState } from "@/components/app-state";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-8 first:border-0 first:pt-0 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; hint?: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow] duration-150",
            value === o.id ? "border-primary/50 shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
          )}
        >
          {o.icon && <o.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <span>
            <span className="block text-sm font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: me } = useMe();
  const { guard } = useAppState();
  const demoUser = useSyncExternalStore(subscribeDemoUser, getDemoUser, serverDemoUser);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const demoPeople = useDemoPeople();
  usePageTitle("Settings");

  return (
    <Page>
      <PageHeader title="Settings" description="Your account and how SelfHub looks on this device." />

      <Section title="Account" description="SelfHub signs you in with GitHub. Your access everywhere comes from there.">
        {me ? (
          <div className="flex items-center gap-3 rounded-xl border bg-surface p-4">
            <UserAvatar login={me.login} name={me.name} avatarUrl={me.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {me.name} {me.mode === "demo" && <DemoPill />}
              </p>
              <p className="text-sm text-muted-foreground">
                @{me.login} · {me.org.name}
              </p>
            </div>
          </div>
        ) : (
          <Skeleton className="h-[74px] rounded-xl" />
        )}
      </Section>

      <Section title="Appearance" description="Saved on this device.">
        {mounted ? (
          <Choice
            label="Theme"
            value={(theme ?? "light") as "light" | "dark" | "system"}
            onChange={setTheme}
            options={[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "Match system", icon: Monitor },
            ]}
          />
        ) : (
          <Skeleton className="h-[50px] rounded-lg" />
        )}
      </Section>

      {me?.mode === "demo" && (
        <Section title="Demo" description={`This dashboard is running on sample ${me.org.name} data. Nothing here reaches GitHub.`}>
          <Choice
            label="View the demo as"
            value={demoUser}
            onChange={(v) => guard(() => setDemoUser(v))}
            options={[
              { id: "sam", label: demoPeople.sam?.name ?? "Ads specialist", hint: demoPeople.sam?.title ?? "Can edit some spaces" },
              { id: "maya", label: demoPeople.maya?.name ?? "Admin", hint: "Admin of every space" },
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {apiMode === "mock" ? (
              <>
                Data source: in-browser mock. Set <span className="font-mono">NEXT_PUBLIC_SELFHUB_API=http</span> to use the SelfHub API.
                Reloading the page resets the sample data.
              </>
            ) : (
              <>Data source: the SelfHub API in demo mode. Switching sends the matching demo login with every request.</>
            )}
          </p>
        </Section>
      )}
    </Page>
  );
}
