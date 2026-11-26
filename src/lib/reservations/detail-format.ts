import type { BookingRowSourceClass } from "@/lib/booking-row-source";
import { RESERVATION_CHANNEL } from "@/lib/constants";

// ---------------------------------------------------------------------------
// REZERVASYON SAYFALARININ ORTAK BİÇİMLEYİCİLERİ (saf; veritabanı yok). Karşılaştırma sayfası (`reservations/compare/[key]`) ve rezervasyon
// detay sayfası (`reservations/[id]`, kurucu 11-20 öğlen B-2) AYNI kaynak etiketini kullanır — iki sayfa ayrışmasın.
// ---------------------------------------------------------------------------

/** Kaynak satırı — UA-1 tasarımı §2'deki etiketler AYNEN (karşılaştırma sayfası). */
export function bookingSourceLabel(row: { sourceClass: BookingRowSourceClass; calendarSourceLabel: string | null }): string {
  switch (row.sourceClass) {
    case "manual":
      return "Elle girildi";
    case "file":
      return "Dosyadan içe aktarıldı";
    case "calendar":
      return row.calendarSourceLabel ? `Takvimden geliyor: ${row.calendarSourceLabel}` : "Takvimden geliyor";
    case "channel":
      return "Kanaldan geliyor";
  }
}

/** Kanal adı eklenen kanallar (bilinen OTA etiketi). "Elle" / "Diğer" / "ics" kanal adı değildir; bilinmeyen değer ham gösterilmez. */
const NAMED_CHANNELS: ReadonlySet<string> = new Set(["airbnb", "booking", "direct"]);

/**
 * Detay sayfasının kaynak satırı (tasarım `docs/TASARIM-2026-11-20-rezervasyon-detay-ekrani.md` §4): kanal sınıfında bilinen kanal adı eklenir —
 * "Kanaldan geliyor · Airbnb". Öteki sınıflar karşılaştırma sayfasıyla AYNI metin.
 */
export function bookingSourceLabelWithChannel(row: {
  sourceClass: BookingRowSourceClass;
  calendarSourceLabel: string | null;
  channel: string;
}): string {
  const base = bookingSourceLabel(row);
  return row.sourceClass === "channel" && NAMED_CHANNELS.has(row.channel) ? `${base} · ${RESERVATION_CHANNEL.label(row.channel)}` : base;
}

/** Takvim günü anahtarı ("2026-11-23") → "23 Kas 2026" (gün anahtarı zaten işletmenin günü; UTC'de biçimlenir, kaymaz). */
export function dayKeyLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Yarı açık [giriş, çıkış) gece sayısı — iki gün anahtarı arası (ters ya da aynı gün → 0). */
export function nightsBetweenKeys(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.round((ms(to) - ms(from)) / 86_400_000));
}

/**
 * Kişi / evcil hayvan satırı (kurucu 11-20 öğlen: "kişi sayısını görmek isterim kalabalık olmasın"). Sayılar YALNIZ sağlayıcının kendi sayı
 * alanından gelir (migration 86); yetişkin sayısı bilinmiyorsa (null) kişi sayısı YAZILMAZ — tahmin yok. Evcil hayvan yalnız > 0 ise.
 * Dönen parçalar misafir adının ardına " · " ile eklenir ("Ada Lale · 3 kişi · 1 evcil hayvan").
 */
export function partyParts(p: { adults: number | null; children: number | null; infants: number | null; pets: number | null }): string[] {
  const out: string[] = [];
  if (p.adults !== null && p.adults > 0) out.push(`${p.adults + Math.max(0, p.children ?? 0) + Math.max(0, p.infants ?? 0)} kişi`);
  if (p.pets !== null && p.pets > 0) out.push(`${p.pets} evcil hayvan`);
  return out;
}
