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
// Şartlar (hepsi; biri sağlanmazsa dizi AYNEN döner → bugünkü davranış: konuşma "Yeni" kalır, ev sahibi görür):
//   1. Kaçırılan cevap (en yeni cevaplayan giden) BİZİM ve yazarı yapay zekâ; ilk geç mesajdan sonra yapay zekâ dışında cevaplayan giden
//      mesaj yok (ev sahibi / yazarı bilinmeyen). Ev sahibinin TESLİM EDİLEMEMİŞ denemesi de sayılır (`attempts` — akışın süzmeden önceki
//      satırları): o turu ev sahibi almak istemiştir; gönderim anı vetosu da ("tetikten sonra ev sahibi yazdı") o satırı sayar.
//   2. Her geç mesaj en çok 24 saat önce yazılmış (karar anına göre) — biri bile aşıyorsa tur buraya girmez.
//   3. Geç mesajlar cevabımızdan önceki EN YENİ misafir mesajları: ilk geç mesaj ile cevabımız arasında geç OLMAYAN misafir mesajı yok
//      (Opus 11-12 S2-4a). Öyle bir mesaj varsa cevabımız onu görüp yazılmıştır ve geç mesajdan YENİDİR → gönderim kimliği geç mesaja
//      bağlanınca kuyruk vetosu ("tetikten sonra misafir yazdı") taslağı her turda iptal eder, tur 24 saat boyunca yeniden modellenirdi.
//   4. Cevabımız misafirden bir cevap BEKLEMİYOR (soru / teklif — kapanış denetiminin `invitesAnswer` kuralı; Opus 11-12 S2-2a). Geç
//      mesaj o cevaptan ÖNCE yazıldı; ardına konunca "Evet lütfen" o teklifin kabulü gibi okunurdu.
// "İlk bağlantıdaki toplu geçmiş" kendiliğinden dışarıda: geç sayılmak için mesaj BİZİM bir cevabımızdan sonra içeri alınmış olmalı.
// Saf; girdi `createdAt` ARTAN (akışın `threadView` çıktısı).
// ---------------------------------------------------------------------------

import { invitesAnswer } from "@/lib/ai/closing-turn";
import { isAnsweringOutbound, lateGuestMessages } from "@/lib/message-author";

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function lateMessageReplyEnabled(): boolean {
  return process.env.AI_LATE_MESSAGE_REPLY_ENABLED === "1";
}

/** Geç mesajın yazılmasından karar anına kadar geçebilecek en uzun süre. */
export const LATE_MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type LateRow = { id: string; direction: string; authorType?: string | null; body: string; createdAt: Date; ingestedAt: Date | null };
type AttemptRow = { direction: string; authorType?: string | null; createdAt: Date };

/** Konuşmayı yanıtlayan ve yazarı yapay zekâ OLMAYAN giden mesaj (ev sahibi / sistem / yazarı bilinmeyen — şüphede "bizim değil"). */
const answeredByOther = (m: AttemptRow) => isAnsweringOutbound(m) && m.authorType !== "ai";

/**
 * `messages` (eskiden yeniye): şartlar sağlanıyorsa geç misafir mesajları kaçırdıkları yapay zekâ cevabının hemen ardına taşınmış yeni dizi
 * (`late` = taşınanlar, yazılma sırasıyla); sağlanmıyorsa AYNI dizi nesnesi ve boş `late`. `attempts`: akışın görünümden SÜZDÜĞÜ satırları
 * da taşıyan ham dizi — `messages`ı KAPSAMALI (teslim edilememiş ev sahibi denemesi şart 1'de sayılır); verilmezse `messages`.
 */
export function lateTurnView<T extends LateRow>(
  messages: readonly T[],
  now: Date,
  attempts: readonly AttemptRow[] = messages,
): { messages: readonly T[]; late: readonly T[] } {
  const same = { messages, late: [] as T[] };
  const at = messages.findLastIndex((m) => isAnsweringOutbound(m));
  if (at < 0) return same;
  // Kaçırılan cevabın bizim yazdığımız (`ingestedAt` boş) olduğunu `lateGuestMessages` şart koşar; geç mesajlar hep ondan ÖNCE yazılmıştır.
  const lateIds = new Set(lateGuestMessages([...messages].reverse()).map((m) => m.id));
  if (lateIds.size === 0) return same;
  const first = messages.findIndex((m) => lateIds.has(m.id));
  const moved = messages.filter((m) => lateIds.has(m.id));
  // Şart 2: yaş. `createdAt` misafirin yazdığı an (sağlayıcı damgası).
  if (moved.some((m) => now.getTime() - m.createdAt.getTime() > LATE_MESSAGE_MAX_AGE_MS)) return same;
  // Şart 1: ilk geç mesajdan sonra yapay zekâ dışında biri cevap yazmış (kaçırılan cevabın kendisi dahil — o da bu dilimdedir). Yazar alanı
  // BİREBİR okunur (eski, yazarı boş satır ad kuralıyla "yapay zekâ"ya çevrilmez): şüphede taşınmaz.
  // `attempts` görünümü KAPSAR (ham dizi ya da görünümün kendisi) → tek tarama; görünümde ilk geç mesajdan sonraki her satır da buradadır.
  const since = moved[0].createdAt.getTime();
  if (attempts.some((m) => m.createdAt.getTime() >= since && answeredByOther(m))) return same;
  // Şart 3: ilk geç mesaj ile cevabımız arasında geç olmayan misafir mesajı (gövdesiz satır dahil — veto onu da sayar).
  if (messages.slice(first, at).some((m) => m.direction === "inbound" && !lateIds.has(m.id))) return same;
  // Şart 4: cevabımız soru / teklifle bitiyorsa geç mesaj onun cevabı gibi okunmasın.
  if (invitesAnswer(messages[at].body)) return same;
  return {
    messages: [...messages.slice(0, at + 1).filter((m) => !lateIds.has(m.id)), ...moved, ...messages.slice(at + 1)],
    late: moved,
  };
}
