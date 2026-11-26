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

/**
 * İşletmenin SAAT DİLİMİNDEKİ bugünden `daysFromToday` gün sonrası; yalnız tarih (00:00Z). Ürün "bugün giriş"i işletmenin takvim gününe göre
 * okur: UTC gününe göre kurulan fikstür (`stayDay`) İstanbul 00:00–02:59 arasında (UTC 21:00–23:59) bir gün geride kalır ve "bugün giriş"
 * dünün girişi olur (G1 tur 3 T3-B4, 11-20: istek yolu fikstürü o saatlerde kırmızıydı). "Bugün"e bakan bir yolu sınayan fikstür bunu kullanır.
 */
export function stayDayInZone(daysFromToday: number, timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((x) => x.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + daysFromToday));
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
