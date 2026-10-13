import { cn } from "@/lib/utils";

function hue(login: string) {
  let h = 0;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
};

export function UserAvatar({
  login,
  name,
  avatarUrl,
  size = "sm",
  className,
}: {
  login: string;
  name?: string;
  avatarUrl?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const style = { "--h": hue(login) } as React.CSSProperties;
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn("shrink-0 rounded-full bg-muted object-cover ring-1 ring-border", sizes[size], className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight",
        "bg-[oklch(0.93_0.035_var(--h))] text-[oklch(0.38_0.08_var(--h))]",
        "dark:bg-[oklch(0.33_0.05_var(--h))] dark:text-[oklch(0.88_0.05_var(--h))]",
        sizes[size],
        className,
      )}
    >
      {/* CSS-drawn: decorative, so it isn't read as part of a button's name. */}
      <span data-mono={initials(name ?? login)} className="before:content-[attr(data-mono)]" />
    </span>
  );
}
