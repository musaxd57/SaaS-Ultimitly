// Org-timezone tek kaynağı. Ürün TR-öncelikli doğdu (her şey Europe/Istanbul
// varsayıyordu); raporlar/otomasyon gün sınırları ve saat kapıları artık
// Organization.timezone'a bağlanır. Varsayılan DEĞİŞMEDİ: kolon 00_init'ten beri
// "Europe/Istanbul" default'lu — hiçbir mevcut org için davranış farkı yok.
//
// Yazma yolu (Ayarlar) yalnız isValidTimeZone'dan geçen değerleri kabul eder;
// okuma yolu yine de orgTimezone() ile korunur (bozuk/eski değer asla Intl'i
// patlatamaz — sessizce Istanbul'a düşer).
//
// NOT (bilinçli kapsam): mesaj/görev ZAMAN DAMGASI gösterimi (utils.ts
// APP_TIME_ZONE) hâlâ Istanbul — o ayrı bir görüntüleme-katmanı turu; buradaki
// iş doğruluk katmanı (pencere/kova/sınır hesapları).

export const DEFAULT_TIMEZONE = "Europe/Istanbul";

let supportedCache: Set<string> | null = null;
function supportedSet(): Set<string> {
  if (!supportedCache) {
    try {
      supportedCache = new Set(Intl.supportedValuesOf("timeZone"));
    } catch {
      supportedCache = new Set([DEFAULT_TIMEZONE]);
    }
  }
  return supportedCache;
}

/** IANA listesinde olan VEYA Intl'in gerçekten kurabildiği (alias toleransı) dilimler geçerli. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  if (supportedSet().has(tz)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** DB'den okunan org.timezone'u güvenle çözer: null/bozuk → Europe/Istanbul. */
export function orgTimezone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Calendar date (YYYY-MM-DD) of `d` as seen in the given IANA timezone. */
export function dateKeyInTimeZone(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** How far ahead (ms) the IANA `tz` is from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - at.getTime();
  } catch {
    return 0;
  }
}

/**
 * UTC [start, end] instants spanning the calendar day of `now` as seen in the
 * IANA `tz` (e.g. "Europe/Istanbul"). Use this so "today's arrivals/departures"
 * are bucketed by the host's local day, not the server's UTC day.
 */
export function zonedDayRange(now: Date, tz: string): { start: Date; end: Date } {
  const key = dateKeyInTimeZone(now, tz); // "YYYY-MM-DD" in tz
  const [y, m, d] = key.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offsetMs = tzOffsetMs(tz, new Date(utcMidnight));
  const start = new Date(utcMidnight - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Local-midnight instant of the CALENDAR day (y, m 1-12, d) in `tz`. Month/day
 * overflow normalizes like Date.UTC (m 13 → Ocak y+1, d 0 → önceki ayın son günü),
 * so month arithmetic ("next month's 1st") needs no manual carrying. Raporların
 * ay-sınırı matematiği için — sabit-offset (UTC+3) kısayolunun DST'li dilimlerde
 * çalışmayan yerini alır.
 */
export function zonedDateStart(y: number, m: number, d: number, tz: string): Date {
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(utcMidnight - tzOffsetMs(tz, new Date(utcMidnight)));
}

/** Current hour (0-23) in the given IANA timezone (e.g. "Europe/Istanbul"). */
export function currentHourInTimeZone(timeZone: string, now: Date = new Date()): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now);
    const hour = parseInt(formatted, 10) % 24;
    return Number.isNaN(hour) ? now.getHours() : hour;
  } catch {
    return now.getHours();
  }
}
