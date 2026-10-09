import type { NightKey } from "@/modules/availability/core";
import { resolveGuestDates, type DateResolution } from "@/lib/ai/date-resolution";
import { formatDayTr, historyStamp } from "@/lib/ai/stay-timeline";

// ---------------------------------------------------------------------------
// TARİH OKUMASI — cevap istemine KODLA çözülmüş tarih olgusu (kurucu talimatı 09-07 "date resolution … metadata"; 10-10 kurucu
// yokken karar #10; anahtar `AI_DATE_RESOLUTION_ENABLED` VARSAYILAN KAPALI → istem bayt bayt eski).
//
// Cevapsız misafir mesajlarının her biri KENDİ yazıldığı ana göre çözülür (F14: akşam yazılıp sabah okunan "yarın" bugündür;
// gece yarısından sonra yazılan "yarın" belirsizdir — `date-resolution.ts`). Daha önceki misafir mesajlarındaki AÇIK tarihler yalnız
// ay bilgisi verir ("ayın 17'si"). Satır yalnız OLGU taşır: hangi günler, kesin mi belirsiz mi, neden (kapalı küme → sabit Türkçe
// ifade); davranış talimatı YOK (karar #1 ile aynı ilke — ne yapılacağını istemin kendi kuralları söyler). Misafirin metni satıra
// GİRMEZ (yalnız kodun ürettiği gün adları + sabit ifadeler) → satır talimat taşıyamaz. Hiçbir mesajda tarih yoksa blok YOK.
// SAF: DB / ağ yok; an çağırandan gelir.
// ---------------------------------------------------------------------------

export function dateReadingEnabled(): boolean {
  return process.env.AI_DATE_RESOLUTION_ENABLED === "1";
}

/** Satır yazılan en fazla mesaj (en yeniler). Bekleyen pencere zaten sınırlı; istem bütçesi de sınırlı kalsın. */
export const DATE_READING_MAX_MESSAGES = 5;
/** Ay bilgisi için taranan en fazla önceki misafir mesajı (en yeniler). */
export const DATE_READING_MAX_EARLIER = 12;

export interface DateReadingMessage {
  text: string;
  /** Yazıldığı an; yoksa / geçersizse `now` (QR anında cevaplanır). */
  at?: Date | null;
}

export interface DateReadingInput {
  /** Cevapsız misafir mesajları, eskiden yeniye (sonuncusu güncel mesaj). */
  messages: readonly DateReadingMessage[];
  /** Daha önceki (cevaplanmış) misafir mesajları, eskiden yeniye — yalnız açık tarihlerin AY bilgisi için. */
  earlier?: readonly DateReadingMessage[];
  now: Date;
  timeZone: string;
  /** Konaklamanın giriş / çıkış günü (iptal edilmiş rezervasyon verilmez). */
  reservation?: { arrival: NightKey; departure: NightKey } | null;
}

/** Belirsizlik / uyarı gerekçeleri (kapalı küme, `date-resolution.ts`) → sabit Türkçe ifade. Tanınmayan kod yazılmaz. */
const REASON_TR: Readonly<Record<string, string>> = {
  after_midnight_relative: 'gece yarısından sonra yazılmış "yarın" — bir önceki günü de kastedebilir',
  day_without_month: "ay yazılmamış",
  next_weekday_ambiguous: "bu hafta mı sonraki hafta mı belli değil",
  numeric_order_ambiguous: "gün / ay sırası belli değil",
  conflicting_dates: "yazılan günler birbiriyle çelişiyor",
  weekday_mismatch: "hafta günü tarihle uyuşmuyor",
  reservation_unknown: "rezervasyon günü bilinmiyor",
  dotted_time_or_date: "saat mi tarih mi belli değil",
  far_future_assumption: "yıl varsayımı uzak bir güne düştü",
  past_date: "geçmiş bir gün",
};

function validAt(at: Date | null | undefined, now: Date): Date {
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : now;
}

function days(keys: readonly NightKey[]): string {
  return keys.map(formatDayTr).join(" · ");
}

/** Tek mesajın olgu cümlesi; tarih yoksa null. */
function factOf(r: DateResolution): string | null {
  if (r.status === "none") return null;
  const notes = r.reasons.map((c) => REASON_TR[c]).filter((x): x is string => typeof x === "string");
  const assumed = r.assumed.includes("year") ? ["yıl varsayıldı"] : [];
  const tail = [...assumed, ...notes];
  const why = tail.length > 0 ? ` (${tail.join("; ")})` : "";
  if (r.status === "resolved") return `${days(r.dates)}${why}`;
  const sure = r.dates.length > 0 ? `kesin: ${days(r.dates)}; ` : "";
  const options = r.alternatives.length > 0 ? `belirsiz — olası günler: ${days(r.alternatives)}` : "belirsiz";
  return `${sure}${options}${why}`;
}

/** Açık tarihleri (yalnız tam / gün-ay dayanaklı, kesin) — sonraki mesajların "ayın 17'si" okuması için. */
function explicitDatesOf(r: DateResolution): NightKey[] {
  return r.status === "resolved" && (r.basis === "explicit_full" || r.basis === "explicit_day_month") ? r.dates : [];
}

export function dateReadingLines(input: DateReadingInput): string[] {
  const reservation = input.reservation ?? null;
  const conversationDates: NightKey[] = [];
  for (const m of (input.earlier ?? []).slice(-DATE_READING_MAX_EARLIER)) {
    const at = validAt(m.at, input.now);
    conversationDates.push(...explicitDatesOf(resolveGuestDates(m.text, { now: at, timeZone: input.timeZone, reservation })));
  }
  const lines: string[] = [];
  for (const m of input.messages.slice(-DATE_READING_MAX_MESSAGES)) {
    const at = validAt(m.at, input.now);
    const r = resolveGuestDates(m.text, { now: at, timeZone: input.timeZone, reservation, conversationDates: [...conversationDates] });
    conversationDates.push(...explicitDatesOf(r));
    const fact = factOf(r);
    if (fact === null) continue;
    const stamp = historyStamp(at, input.now, input.timeZone);
    lines.push(`- Misafir mesajı${stamp ? ` (yazıldığı an: ${stamp})` : ""}: ${fact}.`);
  }
  return lines;
}

/** İstem bloğu; tarih yoksa boş dize (istem bayt bayt aynı). Anahtarı çağıran okur. */
export function dateReadingBlock(input: DateReadingInput): string {
  const lines = dateReadingLines(input);
  if (lines.length === 0) return "";
  return `\n\nTARİH OKUMASI (kodla çözüldü — ${input.timeZone} saatiyle, her mesaj kendi yazıldığı ana göre; misafirin metni değil):\n${lines.join("\n")}`;
}
