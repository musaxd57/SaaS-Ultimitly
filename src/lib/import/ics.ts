import { zonedWallClockToUtc, isValidTimeZone } from "@/lib/timezone";

// ICS (iCalendar) parser for reservation imports.
// Handles VEVENT blocks with DTSTART/DTEND in both date-only and datetime formats.

export interface IcsReservation {
  guestName: string;
  arrivalDate: Date;
  departureDate: Date;
  sourceReference: string | null;
  notes: string | null;
  channel: "ics";
  /** VEVENT STATUS (uppercased), e.g. "CANCELLED" | "CONFIRMED" | null. */
  status: string | null;
}

/** Unfold RFC 5545 long lines (continuation lines start with space or tab). */
function unfoldLines(text: string): string {
  // Satır sonu CRLF, LF ya da (eski Mac dışa aktarımı) YALNIZ CR olabilir — üçü de katlama sınırıdır (inceleme b1, 09-30).
  return text.replace(/(?:\r\n|\n|\r)[ \t]/g, "");
}

/**
 * Parse a DTSTART / DTEND value into a JS Date.
 *
 * 🚨 `tzid` = the TZID parameter from the KEY (`DTSTART;TZID=Europe/Istanbul:…`).
 * Denetim 08-07 (6)'da ÖLÇÜLDÜ: eskiden TZID okunup ATILIYORDU ve saatli değer
 * SUNUCUNUN yerel saatinde kuruluyordu. Railway UTC olduğu için
 * `TZID=Europe/Istanbul:20260805T230000` → `2026-08-05T23:00Z` oluyordu; doğrusu
 * `20:00Z`. Üç saatlik hata GÜNÜ kaydırıyor: konaklama panelde 6 Ağustos'ta
 * başlıyor görünüyor ve 5 Ağustos gecesi daire BOŞ sanılıyor → çifte rezervasyon.
 * Airbnb/Booking `VALUE=DATE` yolladığı için ANA AKIŞ etkilenmiyordu; takvim
 * formundaki "Diğer" seçeneği (Google Takvim / Vrbo / PMS) TZID yollar.
 */
function parseIcsDate(value: string, tzid?: string | null): Date | null {
  // Remove timezone id if present in the value (TZID is in the key, value is clean datetime)
  const clean = value.trim();

  // Date-only: YYYYMMDD
  if (/^\d{8}$/.test(clean)) {
    const year = parseInt(clean.slice(0, 4), 10);
    const month = parseInt(clean.slice(4, 6), 10) - 1;
    const day = parseInt(clean.slice(6, 8), 10);
    // ⚠️ `Date.UTC` — `new Date(y,m,d,12,…)` DEĞİL (denetim 08-07 (6)).
    // Yerel kurucu SUNUCUNUN dilimini kullanır; bugün doğru sonuç veriyor çünkü
    // Railway konteynerinde `TZ` set DEĞİL (= UTC). Bu GİZLİ bir bağımlılıktı:
    // konteynere bir gün `TZ` verilirse öğlen çapası kayar ve kayma yalnız
    // belirli ofsetlerde GÜNÜ değiştirir. Artık sunucu dilimine bağlı değil.
    // Öğlen çapası UTC-11…+11 aralığının tamamında doğru takvim gününü verir.
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    // new Date(...) ROLLS OVER an invalid calendar date (20260231 → 3 Mar) instead
    // of erroring, and the value is a valid Date (not NaN) so the downstream
    // isNaN guard never catches it → a booking imports on the WRONG day. Verify the
    // components survived the round-trip and reject if they didn't. (csv.ts makeDate
    // does the same; VALUE=DATE is exactly the format Airbnb/Booking feeds emit.)
    // UTC kurucuya geçtiğimiz için doğrulama da UTC getter'larıyla yapılmalı —
    // yerel getter'lar sunucu diliminde farklı gün okuyup guard'ı YANLIŞ tetiklerdi.
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
    return d;
  }

  // DateTime: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const dtMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s, z] = dtMatch;
    const [ny, nmo, nd, nh, nmi, ns] = [y, mo, d, h, mi, s].map((v) => parseInt(v, 10));
    // 🚨 TAKVİMDE OLMAYAN AN OKUNMAZ (Codex 09-30, B3): tarih-yalnız yol bileşenleri doğruluyordu, saatli yol DOĞRULAMIYORDU —
    // `20260230T120000Z` sessizce 2 Mart'a kayıyor (konaklama yanlış günde, okuma "tam"), saat 25 ise GEÇERSİZ Date'li bir
    // etkinlik üretiyordu. Geçersiz değer null döner → etkinlik "okunamadı" (`unreadable_event`), okuma eksik işaretlenir.
    if (!isCalendarWallClock(ny, nmo, nd, nh, nmi, ns)) return null;
    // Artık saniye (…T235960) JS'de bir sonraki dakikaya — gece yarısında ERTESİ GÜNE — taşar; gün kaymasın diye 59.
    const nsec = Math.min(ns, 59);
    if (z === "Z") {
      return new Date(Date.UTC(ny, nmo - 1, nd, nh, nmi, nsec));
    }
    if (tzid) {
      // Duvar saati NAMED ZONE'da okunur → doğru UTC anı (DST dâhil, iki geçiş).
      const at = zonedWallClockToUtc(ny, nmo, nd, nh, nmi, nsec, tzid);
      // ⚠️ Bilinmeyen/geçersiz TZID'de `tzOffsetMs` 0 döner, yani sonuç sessizce
      // UTC olur ve saat ≥21:00 ise GÜN yine kayar. Bunu tespit edip ÖĞLEN
      // ÇAPASINA düşüyoruz: saat kaybolur ama TAKVİM GÜNÜ her ofsette doğru kalır
      // — bu modülde gün doğruluğu saatten önce gelir (rezervasyon = gün).
      if (isValidTimeZone(tzid)) return at;
      return new Date(Date.UTC(ny, nmo - 1, nd, 12, 0, 0));
    }
    // TZID YOK ve `Z` YOK = RFC 5545 "floating" (yerel duvar saati). Sunucunun
    // dilimine bağlamak yanlış olurdu; org dilimini bu saf ayrıştırıcı bilmiyor.
    // Öğlen çapası burada da GÜNÜ garanti eder (UTC-11…+11 aralığında).
    return new Date(Date.UTC(ny, nmo - 1, nd, 12, 0, 0));
  }

  // Fallback: YALNIZ ISO 8601 biçimi ("2026-10-10", "2026-10-10T15:00:00Z", "…+03:00") — gün takvimde olmalı (`new Date("2026-02-30")`
  // 2 Mart'a kayar). 🚨 Serbest `new Date()` ayrıştırması KALKTI (10-01, 15 ajan incelemesi A09): "2026" / "2027" bir yıllık, "1" / "12"
  // 2001 yılı, "October 10 2026 23:30" sunucu diliminde okunuyordu — bozuk besleme sessizce uydurma konaklama yazıyordu. Biçim dışı
  // değer okunamayan etkinliktir (`unreadable_event`, F16: eksik okuma hüküm vermez).
  // U33 (Codex 10-07): OFSETSİZ ISO saat ("2026-08-05T23:00:00") temel biçimle AYNI kuraldan geçer — TZID varsa o dilimde, yoksa
  // öğlen çapası. Eskiden `new Date()` sunucunun yerel saatinde okuyup TZID'yi yok sayıyordu (İstanbul 23:00 → ertesi gün).
  const localIso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/i.exec(clean);
  if (localIso) {
    const [, y, mo, d, h, mi, sec] = localIso;
    return parseIcsDate(`${y}${mo}${d}T${h}${mi}${sec ?? "00"}`, tzid);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(clean);
  if (!iso || !isCalendarWallClock(Number(iso[1]), Number(iso[2]), Number(iso[3]), 0, 0, 0)) return null;
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** Takvimde VAR olan duvar saati mi (ay 1–12, gün ayın içinde, saat 0–23, dakika 0–59, saniye 0–60 — RFC 5545 artık saniye). */
function isCalendarWallClock(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/**
 * Decode common iCal escaped characters — TEK geçiş (gece-4 S6-08: sıralı değiştirmede `\\n` — kaçışlı ters eğik çizgi + "n" — satır sonuna
 * dönüyordu: "C:\\temp\\new" → "C:\temp\<satır>ew").
 */
function decodeIcsText(s: string): string {
  return s.replace(/\\([,;nN\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c)).trim();
}

/**
 * Parse an ICS string and return an array of reservation objects.
 * Skips VEVENTs that are missing required fields (DTSTART, DTEND).
 */
/**
 * Tek bir takvim beslemesinden alınacak EN FAZLA etkinlik sayısı.
 *
 * 🚨 Bu tavan yoktu ve ölçüldü: ağ katmanının 10 MB byte-cap'i (net/pinned-fetch)
 * içeriğe bakmaz — 10 MB'lık bir feed **118.978 rezervasyon satırı** üretiyordu.
 * İçe aktarma her satır için AYRI interaktif transaction + advisory lock + görev
 * yaratımı koştuğu için bu, TEK bir istekte yüz binlerce DB gidiş-dönüşü demekti:
 * bir Prisma bağlantısı yarım saat+ meşgul, on binlerce çöp görev satırı.
 * Besleme URL'i müşteri tarafından girildiği için tetiklemesi bedava.
 *
 * Kardeş ayrıştırıcı CSV'de bu tavan ZATEN vardı (`csv.ts MAX_ROWS = 10_000`) —
 * asimetri kapatıldı. 10.000 etkinlik, gerçek bir Airbnb/Booking takviminin çok
 * üstündedir (7 daire × yıllarca rezervasyon bile bunun altında kalır).
 */
const MAX_EVENTS = 10_000;

/**
 * 🚨 OKUMA EKSİK MİYDİ — kapalı küme (F16, Codex 09-05; düzeltme 09-26).
 *
 * Ayrıştırıcı eskiden yalnız bir dizi döndürüyordu: 10.000 tavanında SESSİZCE kesiliyor, tekrarlayan
 * etkinliği (RRULE) tek örnek sanıyor, tarihi okunamayan etkinliği iz bırakmadan atlıyordu. Dizi her
 * durumda "takvimin tamamı" gibi okunuyordu → eksik bir okuma iptal uzlaştırmasına ve müsaitlik
 * motorunun "boş" hükmüne dayanak olabiliyordu. Liste artık NEYİN okunamadığını da taşır:
 *   event_cap        — tavan aşıldı; ötesindeki etkinlikler okunmadı
 *   recurrence       — tekrarlayan etkinlik (RRULE / RDATE / EXDATE / RECURRENCE-ID). Tekrarlar AÇILMAZ
 *                      (bilinçli: sınırsız açılım bütçe ister, rezervasyon beslemesi tekrar kullanmaz) →
 *                      yalnız ilk örnek okunur, diğer geceler listede YOK
 *   unreadable_event — tarihi eksik / okunamayan / ters ya da sıfır süreli etkinlik, ya da yapısı bozuk
 *                      etkinlik (BEGIN/END eşleşmiyor → bir etkinlik kayboldu)
 *   duplicate_uid    — aynı UID farklı tarih ya da durumla iki kez: hangisinin geçerli olduğu bilinemez
 *                      (birebir aynı tekrar belirsizlik DEĞİLDİR, işaretlenmez)
 *   truncated        — dosya yarım: kapanmamış etkinlik ya da END:VCALENDAR yok
 * Okunabilen etkinlikler yine DÖNER (gerçek olgulardır); karar eksikliği bilen çağıranındır.
 */
export type IcsIncompleteReason = "truncated" | "event_cap" | "recurrence" | "duplicate_uid" | "unreadable_event";

/** Gösterim ve kayıt sırası (en ağır neden önce). */
export const ICS_INCOMPLETE_REASONS: readonly IcsIncompleteReason[] = [
  "truncated",
  "event_cap",
  "recurrence",
  "duplicate_uid",
  "unreadable_event",
];

export interface IcsParseResult {
  events: IcsReservation[];
  /** Boş = okunan liste takvimin tamamı. Tekrarsız, `ICS_INCOMPLETE_REASONS` sırasında. */
  incomplete: IcsIncompleteReason[];
}

const INCOMPLETE_CAUSE: Record<IcsIncompleteReason, string> = {
  truncated: "takvim dosyası yarım geldi",
  event_cap: "takvimde çok fazla kayıt var",
  recurrence: "tekrarlayan etkinlikler okunamıyor",
  duplicate_uid: "aynı kayıt farklı tarihlerle iki kez geçiyor",
  unreadable_event: "bazı kayıtların tarihi okunamadı",
};

/**
 * Eksik okumanın nedeni, host'un anlayacağı SADE sözle (teknik terim yok). TEK kaynak: takvim bağlantısının
 * özet satırı ve dosyadan içe aktarma önizlemesi aynı sözü kullanır.
 */
export function icsIncompleteCause(reason: IcsIncompleteReason): string {
  return INCOMPLETE_CAUSE[reason];
}

/** Bu ayrıştırıcının AÇMADIĞI tekrar özellikleri — biri varsa etkinliğin tüm geceleri listede değildir. */
const RECURRENCE_PROPERTIES = new Set(["RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"]);

export function parseIcs(text: string): IcsReservation[] {
  return parseIcsDetailed(text).events;
}

export function parseIcsDetailed(text: string): IcsParseResult {
  // NUL (U+0000) silinir — PostgreSQL `text` onu saklayamaz; NUL'lu ad / UID o kaynağın yazmasını HER senkronda düşürürdü (sağlayıcı
  // yolundaki `canonicalStr` kuralının aynısı; 10-01, 15 ajan incelemesi A09). Başka karaktere dokunulmaz.
  const unfolded = unfoldLines(text.replace(/\u0000/g, ""));
  const lines = unfolded.split(/\r\n|\n|\r/);

  const results: IcsReservation[] = [];
  const reasons = new Set<IcsIncompleteReason>();
  // UID → ilk okunan hâlin imzası (tarihler + durum): aynı UID FARKLI imzayla gelirse belirsizdir.
  const signatureByUid = new Map<string, string>();
  let inEvent = false;
  // Etkinliğin İÇİNDEKİ alt bileşen derinliği (VALARM, X-…): onların özellikleri etkinliğe YAZILMAZ (↓).
  let nested = 0;
  let calendarOpen = false;
  let capped = false;
  let current: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Takvim sınırları yalnız "dosya yarım mı" sorusu için izlenir (etkinlik okumasını değiştirmez).
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCALENDAR") {
      calendarOpen = true;
      continue;
    }
    if (upper === "END:VCALENDAR") {
      // Kapanmamış etkinlikle biten takvim: o etkinlik kayboldu.
      if (inEvent) reasons.add("unreadable_event");
      inEvent = false;
      calendarOpen = false;
      continue;
    }

    // Bileşen adları büyük/küçük harf duyarsızdır (RFC 5545 §3.1 — takvim sınırlarıyla aynı kural; küçük harfli "begin:vevent"
    // etkinliği sessizce düşürüyordu, inceleme b1 09-30).
    if (upper === "BEGIN:VEVENT") {
      // Önceki etkinlik END:VEVENT görmeden yenisi başladı → önceki etkinlik kayboldu.
      if (inEvent) reasons.add("unreadable_event");
      inEvent = true;
      nested = 0;
      current = {};
      continue;
    }

    if (upper === "END:VEVENT") {
      // Başlangıcı olmayan bitiş: bir etkinliğin BEGIN satırı kayıp (özellikleri okunmadan geçildi).
      // Eskiden ÖNCEKİ etkinliğin alanlarıyla ikinci kez işleniyordu (aynı etkinlik iki kez).
      if (!inEvent) {
        reasons.add("unreadable_event");
        continue;
      }
      inEvent = false;
      // Kapanmamış alt bileşenle biten etkinlik: yapısı bozuk (alt bileşenden sonraki özellikleri okunmadı).
      if (nested > 0) reasons.add("unreadable_event");
      nested = 0;

      // Extract key:value — the key may have params (e.g. DTSTART;TZID=Europe/Istanbul)
      const get = (baseKey: string): string | undefined => {
        // Find a key that starts with baseKey (possibly with params)
        const fullKey = Object.keys(current).find(
          (k) => k === baseKey || k.startsWith(baseKey + ";"),
        );
        return fullKey ? current[fullKey] : undefined;
      };

      // TZID anahtarın PARAMETRESİNDEDİR (`DTSTART;TZID=Europe/Istanbul:…`), o
      // yüzden değerin yanında anahtarı da çıkarmak gerekiyor — eski `get()`
      // yalnız değeri döndürüp parametreyi ATIYORDU (↑parseIcsDate gerekçesi).
      const tzidOf = (baseKey: string): string | null => {
        const fullKey = Object.keys(current).find((k) => k === baseKey || k.startsWith(baseKey + ";"));
        if (!fullKey) return null;
        return /(?:^|;)TZID=([^;:]+)/i.exec(fullKey)?.[1]?.trim() ?? null;
      };

      // Tekrarlayan etkinlik: yalnız ilk örneği okunabilir (aşağıda yine döner), diğer geceler YOK.
      if (Object.keys(current).some((k) => RECURRENCE_PROPERTIES.has(k.split(";")[0]))) reasons.add("recurrence");

      const dtStartRaw = get("DTSTART");
      const dtEndRaw = get("DTEND");

      // DTEND'siz (DURATION'lı ya da tek günlük) etkinlik okunmaz — ama artık İZ bırakır.
      if (!dtStartRaw || !dtEndRaw) {
        reasons.add("unreadable_event");
        continue;
      }

      const arrivalDate = parseIcsDate(dtStartRaw, tzidOf("DTSTART"));
      const departureDate = parseIcsDate(dtEndRaw, tzidOf("DTEND"));

      if (!arrivalDate || !departureDate) {
        reasons.add("unreadable_event");
        continue;
      }
      // Ters / sıfır süreli: hangi geceleri kastettiği bilinemez. Liste davranışı değişmez (satır döner,
      // senkron onu "atlandı" sayar) — yalnız okumanın eksik olduğu kaydedilir.
      if (departureDate.getTime() <= arrivalDate.getTime()) reasons.add("unreadable_event");

      // Guest name: from SUMMARY
      const summary = decodeIcsText(get("SUMMARY") ?? "");
      const guestName = summary || "Misafir";

      // Notes: from DESCRIPTION
      const descRaw = get("DESCRIPTION");
      const notes = descRaw ? decodeIcsText(descRaw) : null;

      // Source reference: from UID
      const uid = get("UID");
      const sourceReference = uid ? uid.trim() : null;

      // STATUS (RFC 5545): "CANCELLED" means the booking was removed on the OTA
      // side — the sync marks the local reservation cancelled instead of importing
      // it as a live stay.
      const statusRaw = get("STATUS");
      const status = statusRaw ? statusRaw.trim().toUpperCase() : null;

      // Tavan aşıldıysa kes — hata fırlatmak, meşru bir feed'in geçici olarak şişmesi hâlinde tüm
      // senkronu durdururdu. İlk 10.000 etkinlik her gerçek takvimi kapsıyor. Kesme artık SESSİZ
      // DEĞİL: okumanın eksik olduğu `event_cap` ile döner (F16).
      if (results.length >= MAX_EVENTS) {
        capped = true;
        break;
      }
      if (sourceReference) {
        const signature = `${arrivalDate.getTime()}|${departureDate.getTime()}|${status ?? ""}`;
        const seen = signatureByUid.get(sourceReference);
        if (seen === undefined) signatureByUid.set(sourceReference, signature);
        else if (seen !== signature) reasons.add("duplicate_uid");
      }
      results.push({
        guestName,
        arrivalDate,
        departureDate,
        sourceReference,
        notes,
        channel: "ics",
        status,
      });

      continue;
    }

    if (!inEvent) continue;

    // 🚨 ALT BİLEŞEN (VALARM / X-…, RFC 5545 §3.6.6) — özellikleri ETKİNLİĞİN değildir (10-01, 15 ajan incelemesi A09, ölçüldü):
    // eskiden düz okunuyordu → Google dışa aktarımındaki hatırlatıcının SUMMARY'si ("Alarm notification") misafir adı, iç
    // bileşendeki "STATUS:CANCELLED" rezervasyonu İPTAL yapıyordu (müsaitlik "boş" der → çift rezervasyon riski).
    if (upper.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (upper.startsWith("END:")) {
      // Açılmamış alt bileşenin bitişi: yapı bozuk (hangi özelliğin kime ait olduğu bilinemez).
      if (nested > 0) nested--;
      else reasons.add("unreadable_event");
      continue;
    }
    if (nested > 0) continue;

    // Parse property line: KEY;PARAM=val:VALUE
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx).toUpperCase();
    const valuePart = line.slice(colonIdx + 1);
    current[keyPart] = valuePart;
  }

  if (capped) {
    reasons.add("event_cap");
  } else if (inEvent || calendarOpen) {
    // Girdi bir etkinliğin ya da takvimin ORTASINDA bitti: yarım dosya (kesilmiş yanıt, bozuk dışa aktarım).
    reasons.add("truncated");
  }

  return { events: results, incomplete: ICS_INCOMPLETE_REASONS.filter((r) => reasons.has(r)) };
}
