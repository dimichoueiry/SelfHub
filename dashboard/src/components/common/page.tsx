import { cn } from "@/lib/utils";

/** The gutter every route shares, so page edges line up as you move around. */
export const gutter = "px-5 md:px-8";

/** One container for every route: shared left gutter, left-aligned, max ~1120px. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("w-full max-w-[1120px] pt-8 pb-16 md:pt-10", gutter, className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-sm font-medium text-foreground">{children}</h2>
      {aside}
    </div>
  );
}
