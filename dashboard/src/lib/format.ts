const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True for "2026-10-11": a day with no time (rule files only record the day). */
export function isDateOnly(value: string) {
  return DATE_ONLY.test(value);
}

/** "today", "yesterday", "Oct 11" for date-only values. Never invents a time of day. */
function dayAgo(day: string, now: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  if (isDateOnly(iso)) return dayAgo(iso, now);
  if (Number.isNaN(new Date(iso).getTime())) return "";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const sec = Math.round(diff / 1000);
  if (abs < 45_000) return "just now";
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return `${Math.abs(min)}m ago`;
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return `${Math.abs(hr)}h ago`;
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 7) return rtf.format(day, "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: Math.abs(day) > 300 ? "numeric" : undefined });
}

export function fullDate(iso: string) {
  if (isDateOnly(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (Number.isNaN(new Date(iso).getTime())) return "";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortSha(sha: string) {
  return sha.slice(0, 7);
}

export function bytes(n?: number) {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

export function firstName(name: string) {
  return name.split(" ")[0];
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
