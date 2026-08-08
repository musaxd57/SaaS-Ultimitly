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
  return text.replace(/\r?\n[ \t]/g, "");
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
    if (z === "Z") {
      return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
    }
    const [ny, nmo, nd, nh, nmi, ns] = [y, mo, d, h, mi, s].map((v) => parseInt(v, 10));
    if (tzid) {
      // Duvar saati NAMED ZONE'da okunur → doğru UTC anı (DST dâhil, iki geçiş).
      const at = zonedWallClockToUtc(ny, nmo, nd, nh, nmi, ns, tzid);
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

  // Fallback: try native Date parse
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** Decode common iCal escaped characters. */
function decodeIcsText(s: string): string {
  return s
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/gi, "\n")
    .replace(/\\\\/g, "\\")
    .trim();
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

export function parseIcs(text: string): IcsReservation[] {
  const unfolded = unfoldLines(text);
  const lines = unfolded.split(/\r?\n/);

  const results: IcsReservation[] = [];
  let inEvent = false;
  let current: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;

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

      const dtStartRaw = get("DTSTART");
      const dtEndRaw = get("DTEND");

      if (!dtStartRaw || !dtEndRaw) continue;

      const arrivalDate = parseIcsDate(dtStartRaw, tzidOf("DTSTART"));
      const departureDate = parseIcsDate(dtEndRaw, tzidOf("DTEND"));

      if (!arrivalDate || !departureDate) continue;

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

      // Tavan aşıldıysa SESSİZCE kes — hata fırlatmak, meşru bir feed'in geçici
      // olarak şişmesi hâlinde tüm senkronu durdururdu. İlk 10.000 etkinlik
      // zaten her gerçek takvimi kapsıyor.
      if (results.length >= MAX_EVENTS) break;
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

    // Parse property line: KEY;PARAM=val:VALUE
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx).toUpperCase();
    const valuePart = line.slice(colonIdx + 1);
    current[keyPart] = valuePart;
  }

  return results;
}
