// ---------------------------------------------------------------------------
// SOHBET EKRANI MESAJ PENCERESİ (kurucu kararı 11-26 sabah, K2-S: "son 60 mesaj gözüksün üstte daha eski mesajları göster tuşu olsun";
// tasarım `docs/TASARIM-2026-11-26-sohbet-ekrani-son-60.md`). Konuşma sayfası mesajların yalnız EN YENİ penceresini okur; "Daha eski
// mesajları göster" adres parametresini (`?eski=N`) bir artırır ve pencere bir sayfa (60 mesaj) büyür. Sayfa 30 sn'de bir yenilenir; adres
// parametresi korunduğu için yenileme de yalnız gösterilen pencereyi okur.
//
// Sıra kesin: `(createdAt, id)` (yapay zekâ tarafının sırası). Pencere "en yeni N" = azalan sırada `take N + 1`, sonra ters çevrilir;
// fazladan satır yalnız "daha eski var" bilgisidir, gösterilmez.
//
// Pencereyle SONUCU değişebilecek sayfa hesapları (uzunluk uyarısı, hazır taslak, karar kartındaki "sonra yazdı" bilgisi) geriye doğru
// tarar ve ilk "sonlandırıcı" mesajda durur. `windowCoversTail` pencerenin bütün sonlandırıcıları içerdiğini söyler; içermiyorsa sayfa
// pencereden eski mesajları da okur (o hesaplar için; ekrana yine yalnız pencere gelir) → sonuç bütün geçmişle hesaplanan sonuçla AYNI.
// YAPRAK modül (yalnız yazar kuralını içe aktarır; veritabanı yok).
// ---------------------------------------------------------------------------

import { isAnsweringOutbound } from "@/lib/message-author";

/** Bir sayfadaki mesaj sayısı: sohbet ekranı ilk açılışta en yeni bu kadar mesajı gösterir. */
export const MESSAGE_WINDOW_PAGE = 60;

/**
 * "Daha eski" sayfa sayısının tavanı. Bu değere ulaşan adres BÜTÜN geçmişi gösterir (düğme kalkar): tavanda düğmenin "çalışmaz" hâle
 * gelmesi (aynı pencereye dönmek) yerine ev sahibi istediği her mesaja ulaşabilir — bütün geçmişi okumak bugünkü davranıştır.
 */
export const MAX_OLDER_PAGES = 20;

/** Adres parametresinin adı (`?eski=1` → 120 mesaj). */
export const OLDER_PAGES_PARAM = "eski";

/**
 * `?eski=` değeri → eklenecek eski sayfa sayısı (0 … `MAX_OLDER_PAGES`). Yalnız 1 … `MAX_OLDER_PAGES` arası ondalık tam sayı kabul edilir;
 * negatif, ondalık, boş, çöp ya da tavandan büyük değer → 0 (varsayılan pencere). Dizi gelirse (`?eski=1&eski=2`) ilki okunur
 * (`from` ile aynı kural).
 */
export function parseOlderPages(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !/^[0-9]{1,3}$/.test(v)) return 0;
  const n = Number(v);
  return n >= 1 && n <= MAX_OLDER_PAGES ? n : 0;
}

/** Okunacak en yeni mesaj sayısı; `null` = bütün geçmiş (tavan). */
export function messageWindowSize(olderPages: number): number | null {
  if (olderPages >= MAX_OLDER_PAGES) return null;
  return MESSAGE_WINDOW_PAGE * (Math.max(0, olderPages) + 1);
}

/**
 * Azalan sırada okunmuş satırlar (`take size + 1`) → kronolojik pencere + "daha eski var mı". `size` `null` ise satırlar bütün geçmiştir.
 */
export function windowFromNewestFirst<T>(newestFirst: readonly T[], size: number | null): { messages: T[]; hasOlder: boolean } {
  if (size === null || newestFirst.length <= size) return { messages: [...newestFirst].reverse(), hasOlder: false };
  return { messages: newestFirst.slice(0, size).reverse(), hasOlder: true };
}

/**
 * Pencere, geriye doğru tarayan sayfa hesaplarının hepsinin sonlandırıcısını içeriyor mu (pencere konuşmanın bir SONEKİDİR):
 *  · bir misafir mesajı — son gelen mesaj (karar tutuşu notu, "AI öner"in cevaplayacağı mesajın uzunluğu, karar kartının "sonra yazdı"sı);
 *  · iptal EDİLMEMİŞ bir cevap (giden, otomatik şablon değil) — cevapsız misafir mesajlarının uzunluk kontrolü (`isAnsweringOutbound`,
 *    iptalli satır da sayılır; iptalsiz cevap onu da karşılar) ve hazır taslağın "son cevaptan sonraki misafir metinleri" (görünen liste:
 *    iptalli satır sayılmaz).
 * İkisi de varsa her tarama pencere içinde durur → sonuç bütün geçmişle aynı. Biri yoksa çağıran pencereden eski mesajları da okur.
 */
export function windowCoversTail(
  window: readonly { id: string; direction: string; authorType?: string | null }[],
  canceledMessageIds: ReadonlySet<string>,
): boolean {
  let inbound = false;
  let reply = false;
  for (const m of window) {
    if (m.direction === "inbound") inbound = true;
    else if (isAnsweringOutbound(m) && !canceledMessageIds.has(m.id)) reply = true;
    if (inbound && reply) return true;
  }
  return false;
}

/** "Daha eski mesajları göster" bağlantısı: aynı konuşma, bir sayfa daha; geri hedefi (`from`) korunur. */
export function olderMessagesHref(conversationId: string, olderPages: number, from: string | null): string {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  q.set(OLDER_PAGES_PARAM, String(Math.min(MAX_OLDER_PAGES, Math.max(0, olderPages) + 1)));
  return `/inbox/${encodeURIComponent(conversationId)}?${q.toString()}`;
}
