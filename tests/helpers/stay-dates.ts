// ---------------------------------------------------------------------------
// KONAKLAMA FİKSTÜRÜ İÇİN BAĞIL TARİH (zaman bombası sınıfı, 11-13).
//
// Olay: dört entegrasyon testi konaklamayı sabit tarihle kuruyordu (12 → 15 Kasım 2026) ama sınadıkları ürün yolu saati KENDİSİ okuyor
// (`applyChannelAutoReply` → `stayEndedBefore(çıkış, new Date(), dilim)`; karar kartı → istenen gün < bugün). Yazıldıkları gün konaklama
// gelecekteydi; takvim o günlere gelince testler ürün değişmeden kırmızıya döner: biri 13 Kasım gecesi tam kapıda patladı ("bekliyor"
// yerine "süresi doldu"), öteki üçü 16 Kasım 00:00'da (İstanbul) "konaklama bitti"ye düşecekti.
//
// Kural: saati kendisi okuyan (teste `now` verilemeyen) bir yolu sınayan test konaklama tarihini SABİT yazmaz; buradan alır. Tarih her
// koşuda bugüne göre kurulur (yalnız tarih, 00:00Z — ürünün "yalnız tarih" saklama biçimi). Pin: `tests/unit/stay-fixture-dates.test.ts`.
// ---------------------------------------------------------------------------
import { shortStayRange } from "@/lib/host-channel/question-text";

/** Bugünden (UTC günü) `daysFromToday` gün sonrası; yalnız tarih (00:00Z). Eksi değer geçmiş gün. */
export function stayDay(daysFromToday: number, now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday));
}

/** Testlerin ortak "yaklaşan konaklama"sı: 12 gün sonra giriş, 3 gece (fikstürlerin yazıldığı günkü uzaklık). */
export function upcomingStay(now: Date = new Date()): { arrivalDate: Date; departureDate: Date } {
  return { arrivalDate: stayDay(12, now), departureDate: stayDay(15, now) };
}

/**
 * Ev sahibine giden kısa aralık metni ("12–15 Kas" / "30 Kas–3 Ara") — ürünün kendi biçimlendiricisiyle. Biçimin KENDİSİ sabit tarihle
 * `tests/unit/host-channel-core.test.ts`te pinlidir; burada yalnız "mesajdaki tarih bu konaklamanın tarihi mi" sorusu sınanır.
 */
export function stayRangeLabel(stay: { arrivalDate: Date; departureDate: Date }): string {
  const dm = (d: Date) => ({ day: d.getUTCDate(), month: d.getUTCMonth() + 1 });
  return shortStayRange(dm(stay.arrivalDate), dm(stay.departureDate));
}
