import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// DOĞRUDAN KANAL ↔ iCAL SAHİPLİĞİ (değişmez 6; kurucu gereksinimi 09-08 `docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md`).
// Aynı mülkte bir OTA'nın DOĞRUDAN bağlantısı (Airbnb / Booking / Vrbo Direct) varsa o kanalın rezervasyonlarının yetkili kaynağı odur;
// AYNI kanalın iCal'i YEDEK olur: çekilir (sağlık izlenir), ama rezervasyon YAZMAZ (oluşturma / güncelleme / iptal / kaybolma uzlaştırması
// yok), eski satırları SİLİNMEZ. Öteki kanalların iCal'i yazmaya devam eder. Bağlantı kalkınca iCal yeniden yetkili (geri alınabilir).
//
// Kurucu 10-11: "yalnız Airbnb Direct gelince" — Hospitable köprüsü (canlı köprü) bu kurala GİRMEZ; köprü bütün kanalları getirdiği için
// hangi kanalı gerçekten kapsadığı tahmine kalırdı. Bugün doğrudan bağlantı yok → davranış birebir aynı.
// iCal'in kanalı ETİKETTEN tahmin edilmez (gereksinim: "etiket tahmini yetmez"): yalnız besleme adresinin ALAN ADINDAN, kesin eşleşmeyle;
// tanınmayan adres her zaman yetkili kalır (sessiz birleştirme / sessiz susturma yok — değişmez 6, 10).
// ---------------------------------------------------------------------------

export type OtaChannel = "airbnb" | "booking" | "vrbo";

/** Doğrudan kanal bağlantısı sağlayıcıları (`ChannelConnection.provider`) → kapsadığı TEK OTA kanalı. Köprüler (hospitable) YOK. */
export const DIRECT_CONNECTION_CHANNEL: Readonly<Record<string, OtaChannel>> = Object.freeze({
  airbnb_direct: "airbnb",
  booking_direct: "booking",
  vrbo_direct: "vrbo",
});

/**
 * Airbnb'nin KENDİ ülke alan adları (kesin liste — Haiku 10-11: "airbnb.<herhangi 2-3 harf>" taklit `airbnb.xyz`yi de susturuyordu) +
 * iCal dışa aktarma yolu `/calendar/ical`. Listede olmayan alan adı tanınmaz → yetkili kalır (yanlış yönde hata = bugünkü davranış).
 */
const AIRBNB_SUFFIXES = [
  "com", "com.tr", "co.uk", "de", "fr", "es", "it", "nl", "ie", "pt", "gr", "at", "ch", "be", "dk", "se", "no", "fi", "pl", "cz",
  "hu", "ru", "ca", "com.au", "co.nz", "com.br", "mx", "com.mx", "com.ar", "cl", "co", "jp", "co.kr", "co.in", "com.sg", "com.hk",
];
const AIRBNB_HOST = new RegExp(`(?:^|\\.)airbnb\\.(?:${AIRBNB_SUFFIXES.map((s) => s.replace(/\./g, "\\.")).join("|")})$`);
const BOOKING_HOST = /(?:^|\.)booking\.com$/;
/** Vrbo ailesi (Expedia): vrbo, homeaway, abritel, fewo-direkt. */
const VRBO_HOST = /(?:^|\.)(?:vrbo\.com|homeaway\.(?:com|co\.uk|de|fr|es|it|nl|com\.au)|abritel\.fr|fewo-direkt\.de)$/;

/** Besleme adresinin kanalı — yalnız alan adından (Airbnb'de iCal yolu da), kesin; tanınmazsa `null` (yetkili kalır). */
export function icalChannelOfUrl(url: string): OtaChannel | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (AIRBNB_HOST.test(host)) return /^\/calendar\/ical\//i.test(parsed.pathname) ? "airbnb" : null;
  if (BOOKING_HOST.test(host)) return "booking";
  if (VRBO_HOST.test(host)) return "vrbo";
  return null;
}

/** Yedek mi yetkili mi: kanal biliniyor VE aynı kanalın etkin doğrudan bağlantısı bu mülkü kapsıyorsa yedek. */
export function icalWriteAuthority(icalChannel: OtaChannel | null, directChannels: readonly OtaChannel[]): "active" | "standby" {
  return icalChannel !== null && directChannels.includes(icalChannel) ? "standby" : "active";
}

/** Bu mülkü kapsayan ETKİN doğrudan kanal bağlantılarının kanalları (bağlantı kapsamlı ilan satırından — `ChannelListing`). */
export async function directChannelsForProperty(organizationId: string, propertyId: string): Promise<OtaChannel[]> {
  const providers = Object.keys(DIRECT_CONNECTION_CHANNEL);
  const rows = await prisma.channelListing.findMany({
    where: { organizationId, propertyId, connection: { organizationId, status: "active", provider: { in: providers } } },
    select: { connection: { select: { provider: true } } },
  });
  return [...new Set(rows.map((r) => DIRECT_CONNECTION_CHANNEL[r.connection.provider]).filter((c): c is OtaChannel => Boolean(c)))];
}

/** Yedek kaynağın panelde görünen sade özeti (rezervasyon yazmadığını ve nedenini söyler). */
export function standbySummary(channel: OtaChannel): string {
  const name = channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking.com" : "Vrbo";
  return `Yedek takvim — rezervasyonlar ${name} doğrudan bağlantısından geliyor; bu takvim rezervasyon eklemez veya değiştirmez`;
}
