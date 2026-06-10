import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined, currency = "EUR") {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// Reservation arrival/departure values are stored as UTC-anchored calendar
// dates (a date-only booking date → UTC midnight). Pin the formatter to UTC so
// the displayed day is the booking day itself, never shifted by the viewer's
// timezone (a browser behind UTC would otherwise show the previous day).
const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// Message/task timestamps are real instants (not date-only). Render them in the
// app's operating timezone so the wall-clock time matches Airbnb/Hospitable and
// the host's own clock — NOT the server's UTC. (Türkiye is UTC+3 year-round.)
const APP_TIME_ZONE = "Europe/Istanbul";

const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
});

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return dateFmt.format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "—";
  return dateTimeFmt.format(new Date(date));
}

export function formatTime(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/**
 * Whole days from "today" (the host's calendar day in `tz`) to a reservation/task
 * date. Returns 0 = today, 1 = tomorrow, −1 = yesterday.
 *
 * The date is interpreted by its **UTC calendar day** — the exact same basis
 * `formatDate` uses to DISPLAY it (the formatter is pinned to UTC). Reservation
 * dates land at different times of day depending on the import path (Hospitable =
 * UTC midnight, iCal/CSV = local noon, others later in the UTC day), so measuring
 * in any single zone would let a task shown as "10 Haz" fall into a different
 * bucket than its own label. Anchoring to the UTC day guarantees a task displayed
 * as today's date always counts as today (offset 0), regardless of the stored
 * hour. "Today" itself is the host's calendar day in `tz` (Istanbul), so the
 * filter still tracks the host's clock, not the server's UTC.
 */
export function daysUntilDate(
  date: Date | string,
  now: Date = new Date(),
  tz: string = APP_TIME_ZONE,
): number {
  const d = new Date(date);
  const dateIdx = Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000,
  );
  const todayIdx = Math.floor(
    Date.parse(`${now.toLocaleDateString("en-CA", { timeZone: tz })}T00:00:00Z`) / 86_400_000,
  );
  return dateIdx - todayIdx;
}

/** Relative "x ago" style label in Turkish, coarse-grained. */
export function fromNow(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} gün önce`;
  return formatDate(date);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(text: string, length = 80) {
  if (text.length <= length) return text;
  return text.slice(0, length).trimEnd() + "…";
}

/** Parse JSON stored as String columns without throwing. */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
