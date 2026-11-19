const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** Timestamps are shown in UTC so every reviewer sees the same value. */
export function formatDateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

export function formatDate(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return DATE.format(new Date(dateOnly ? `${iso}T00:00:00Z` : iso));
}

export function formatSettledAt(value: string | null): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return /Z$/.test(value) ? formatDateTime(value) : `${formatDate(value.slice(0, 10))}, ${value.slice(11, 16)}`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
