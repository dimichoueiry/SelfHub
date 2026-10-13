import { AlertCircle, Lock, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api/errors";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border bg-surface text-muted-foreground">
        <Icon className="size-[18px]" />
      </span>
      <h3 className="text-base font-medium">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  title = "Couldn't load this",
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const message = isApiError(error) ? error.message : error instanceof Error ? error.message : String(error);
  const hint = isApiError(error) ? error.hint : undefined;
  // A 403 no-access is not a failure to retry: it's the no-access state.
  if (isApiError(error) && error.status === 403 && error.code === "no-access") {
    return (
      <div className={cn("flex flex-col items-center justify-center px-6 py-20 text-center", className)}>
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border bg-surface text-muted-foreground">
          <Lock className="size-[18px]" />
        </span>
        <h3 className="text-base font-medium">{message}</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint ?? "Access comes from GitHub. Ask an admin of this space to add you."}</p>
      </div>
    );
  }
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-danger/25 bg-danger/8 text-danger-text">
        <AlertCircle className="size-[18px]" />
      </span>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
