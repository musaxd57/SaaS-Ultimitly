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

/** Alan adı (son ekleri) → kanal. Airbnb ülke alan adları: airbnb.com, airbnb.com.tr, airbnb.co.uk, airbnb.de … */
const HOST_RULES: readonly [RegExp, OtaChannel][] = [
  [/(?:^|\.)airbnb\.(?:[a-z]{2,3}|com?\.[a-z]{2})$/, "airbnb"],
  [/(?:^|\.)booking\.com$/, "booking"],
  [/(?:^|\.)(?:vrbo\.com|homeaway\.com)$/, "vrbo"],
];

/** Besleme adresinin kanalı — yalnız alan adından, kesin; tanınmazsa `null` (yetkili kalır). */
export function icalChannelOfUrl(url: string): OtaChannel | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  for (const [re, channel] of HOST_RULES) if (re.test(host)) return channel;
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
