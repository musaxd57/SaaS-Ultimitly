// ---------------------------------------------------------------------------
// GEÇ İÇERİ ALINAN MİSAFİR MESAJINI YAPAY ZEKÂ DEĞERLENDİRSİN (S2, kurucu kararı 11-11; anahtar `AI_LATE_MESSAGE_REPLY_ENABLED` KAPALI —
// ölçüm sonucu görülmeden açılmaz; tasarım `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §2.1).
//
// Bugün: konuşma mesajın YAZILDIĞI ana göre sıralanır. Misafirin cevabımızdan önce yazıp bize sonra ulaşan mesajı (`lateGuestMessages`)
// sırada cevabımızın ÖNÜNE düşer → "son mesaj giden" → otomatik cevap akışı `already_answered` der (S1, 11-04: konuşma "Yeni" kalır, acil
// ağı tarar, ev sahibi görür). Misafir sonradan yeni mesaj yazsa bile geç mesaj "cevaplanmış geçmiş" gibi okunur.
//
// Burası: otomatik cevap akışının OKUDUĞU dizide, şartlar sağlanıyorsa geç mesajları kaçırdıkları cevabın ARDINA koyar. Veritabanındaki
// sıra, ekranlar ve satırın kendi `createdAt`i değişmez (tarih okuması mesajın yazıldığı ana göre kalır). Sonrası bugünkü akışın aynısı:
// tur sınırı konumsaldır (`messages.slice(sonCevap + 1)`), yani kapanış denetimi, anlama katmanı, istek öğeleri, kapılar ve gönderim
// kimliği (`auto:<konuşma>:<son misafir mesajı>`) kendiliğinden geç mesajı "cevapsız tur" olarak görür.
//
// Şartlar (hepsi; biri sağlanmazsa dizi AYNEN döner → bugünkü davranış):
//   1. Kaçırılan cevap (en yeni cevaplayan giden) BİZİM ve yazarı yapay zekâ. Ev sahibinin cevabından sonraki geç mesaja yapay zekâ karışmaz.
//   2. İlk geç mesajdan sonra yapay zekâ dışında cevaplayan giden mesaj yok (ev sahibi / yazarı bilinmeyen).
//   3. Her geç mesaj en çok 24 saat önce yazılmış (karar anına göre) — biri bile aşıyorsa tur buraya girmez.
// "İlk bağlantıdaki toplu geçmiş" kendiliğinden dışarıda: geç sayılmak için mesaj BİZİM bir cevabımızdan sonra içeri alınmış olmalı.
// Saf; girdi `createdAt` ARTAN (akışın `threadView` çıktısı).
// ---------------------------------------------------------------------------

import { isAnsweringOutbound, lateGuestMessages } from "@/lib/message-author";

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function lateMessageReplyEnabled(): boolean {
  return process.env.AI_LATE_MESSAGE_REPLY_ENABLED === "1";
}

/** Geç mesajın yazılmasından karar anına kadar geçebilecek en uzun süre. */
export const LATE_MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type LateRow = { id: string; direction: string; authorType?: string | null; createdAt: Date; ingestedAt: Date | null };

/**
 * `messages` (eskiden yeniye): şartlar sağlanıyorsa geç misafir mesajları kaçırdıkları yapay zekâ cevabının hemen ardına taşınmış yeni dizi
 * (`late` = taşınanlar, yazılma sırasıyla); sağlanmıyorsa AYNI dizi nesnesi ve boş `late`.
 */
export function lateTurnView<T extends LateRow>(messages: readonly T[], now: Date): { messages: readonly T[]; late: readonly T[] } {
  const same = { messages, late: [] as T[] };
  const at = messages.findLastIndex((m) => isAnsweringOutbound(m));
  if (at < 0) return same;
  // Şart 1: kaçırılan cevap yapay zekânın (bizim yazdığımız — `ingestedAt` boş — olduğunu `lateGuestMessages` zaten şart koşar).
  // Yazar alanı BİREBİR okunur (eski, yazarı boş satır ad kuralıyla "yapay zekâ"ya çevrilmez): şüphede taşınmaz. İçeri alınma anı taşıyan
  // konuşmalarda otomatik cevap satırı yazar alanıyla yazılır, yani bu darlık gerçek bir geç mesajı dışarıda bırakmaz.
  if (messages[at].authorType !== "ai") return same;
  const lateIds = new Set(lateGuestMessages([...messages].reverse()).map((m) => m.id));
  if (lateIds.size === 0) return same;
  const first = messages.findIndex((m) => lateIds.has(m.id));
  const moved = messages.filter((m) => lateIds.has(m.id));
  // Şart 3: yaş. `createdAt` misafirin yazdığı an (sağlayıcı damgası).
  if (moved.some((m) => now.getTime() - m.createdAt.getTime() > LATE_MESSAGE_MAX_AGE_MS)) return same;
  // Şart 2: ilk geç mesajdan sonra ev sahibi (ya da yazarı bilinmeyen biri) cevap yazmış → konuşma onun elinde.
  if (messages.slice(first).some((m) => isAnsweringOutbound(m) && m.authorType !== "ai")) return same;
  return {
    messages: [...messages.slice(0, at + 1).filter((m) => !lateIds.has(m.id)), ...moved, ...messages.slice(at + 1)],
    late: moved,
  };
}
