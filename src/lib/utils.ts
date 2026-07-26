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
// HOST's operating timezone so the wall clock matches Airbnb/Hospitable and the
// host's own clock — NOT the server's UTC.
//
// The default stays Europe/Istanbul: the column `Organization.timezone` has had
// that default since 00_init, so every existing org renders exactly as before.
// Callers that know the org (server pages already selecting `timezone`, resolved
// through `orgTimezone()`) pass it explicitly — mirroring `formatDayInTz` and
// `daysUntilDate`, which have taken a trailing tz all along.
//
// ⚠️ `formatDate` deliberately does NOT take a tz. It renders DATE-ONLY booking
// values (arrival/departure, stored at UTC midnight) and is pinned to UTC so the
// day shown is the booked day itself. Giving it a timezone would shift those
// days for any zone west of UTC. Instants use formatDateTime/formatTime/
// formatDayInTz; date-only values use formatDate. Keep that line clean.
const APP_TIME_ZONE = "Europe/Istanbul";

// Intl.DateTimeFormat construction is the expensive part, and these render once
// per row in long lists. Memoise per (kind, tz) so a per-call tz costs nothing
// after the first row. Keys come from our own code, never user input.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function cachedFmt(key: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  const k = `${key}|${tz}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("tr-TR", { ...opts, timeZone: tz });
    fmtCache.set(k, f);
  }
  return f;
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return dateFmt.format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined, tz: string = APP_TIME_ZONE) {
  if (!date) return "—";
  return cachedFmt("dt", tz, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatTime(date: Date | string | null | undefined, tz: string = APP_TIME_ZONE) {
  if (!date) return "—";
  return cachedFmt("t", tz, { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

/**
 * Whole days from "today" to a reservation/task date, both measured as calendar
 * days in `tz` (the host's operating zone, Istanbul). Returns 0 = today,
 * 1 = tomorrow, −1 = yesterday.
 *
 * Anchored to the org timezone so the Görevler "Bugün" filter matches the
 * dashboard's "Bugünkü Çıkışlar" exactly — both decide a checkout's day with the
 * Istanbul calendar boundary (zonedDayRange). A reservation that's already the
 * next Istanbul day (e.g. a dueAt at 21:00Z) counts as tomorrow on both screens.
 */
export function daysUntilDate(
  date: Date | string,
  now: Date = new Date(),
  tz: string = APP_TIME_ZONE,
): number {
  const dayIndex = (d: Date | string) =>
    Math.floor(
      Date.parse(`${new Date(d).toLocaleDateString("en-CA", { timeZone: tz })}T00:00:00Z`) /
        86_400_000,
    );
  return dayIndex(date) - dayIndex(now);
}

/**
 * Like formatDate but rendered in a given timezone (default the app's zone).
 * For TASK dueAt — a real instant tied to the org's operating day — so the date
 * shown on a task card matches the Istanbul-day filter (daysUntilDate) and the
 * dashboard. Reservation date-only values keep using formatDate (UTC-pinned).
 */
export function formatDayInTz(date: Date | string | null | undefined, tz: string = APP_TIME_ZONE) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(new Date(date));
}

/**
 * Relative "x ago" style label in Turkish, coarse-grained.
 *
 * Past 30 days it falls back to an absolute day. That fallback renders in `tz`,
 * NOT UTC: every caller passes a true instant (lastMessageAt, sentAt, createdAt,
 * lastSyncedAt), and for an instant the host's calendar day is the correct one.
 * The old UTC fallback showed the previous day for anything stamped after
 * 21:00 UTC in Istanbul.
 */
export function fromNow(date: Date | string | null | undefined, tz: string = APP_TIME_ZONE) {
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
  return formatDayInTz(date, tz);
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
