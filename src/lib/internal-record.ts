import "server-only";

import { deliveryOutcomeOfRoute, resolveOutboundRoute } from "@/lib/channels/outbound";
import type { Prisma } from "@prisma/client";
import { isDemoOrg } from "@/lib/demo-tenant/constants";

// ---------------------------------------------------------------------------
// "İÇ KAYIT" — ALICISI OLMAYAN KONUŞMA (kurucu 11-18 akşam: "'Gönder' yalnız gerçek bir alıcı varsa görünür … Eskiden açılan yerel kayıtlar
// silinmez veya rastgele bir kanala bağlanmaz; 'İç kayıt' olarak korunur"; tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.2,
// dilim D3).
//
// Gerçek alıcı iki türdür: kanal konuşması (kanal kimliği var) ve iç QR sohbeti (misafir sohbet sayfasında görür). İkisi de olmayan konuşma
// eskiden "Yeni konuşma" formuyla elle açılmış yerel kayıttır (form 11-18'de kaldırıldı): misafire gidecek hiçbir yolu yoktur. Böyle bir
// kayıtta yazma kutusu, yapay zekâ önerisi ve karar kartı gösterilmez; sunucu da cevap / karar isteğini REDDEDER (arayüz gizlese de eski
// sekmeden istek gelebilir). Kayıt silinmez: eski mesajlar okunur, iç not eklenebilir.
//
// TEK KURAL burada — gönderimle AYNI rota çözümünden (`resolveOutboundRoute`): sayfa, liste ve rotalar bu yüklemi kullanır.
//
// Demo hesabı MUAF: demo konuşmaları tasarım gereği kanala bağlı değildir (kurgusal veri, hiçbir şey dışarı çıkmaz) ve ürünü gösterebilmek
// için yazma / karar akışı orada bugünkü gibi çalışır (cevap "kaydedildi, gönderilmedi" diye duyurulur).
// ---------------------------------------------------------------------------

/** Etiket (liste satırı + konuşma başlığı). */
export const INTERNAL_RECORD_LABEL = "İç kayıt";

/** Ret yanıtının makine kodu (istemci metne değil buna bakar). */
export const INTERNAL_RECORD_CODE = "internal_record";

/** Eski sekmeden gelen cevap / karar isteğine dönen metin (arayüz bu kayıtta gönderme yüzeyi göstermez). */
export const INTERNAL_RECORD_NO_SEND_TEXT = "Bu kayıt bir kanala bağlı değil. Misafire buradan mesaj gönderilemez.";

/** Saf: konuşmanın gerçek bir alıcısı yok mu (kanal değil, iç QR değil) — demo hesabı hariç. */
export function isInternalRecord(conversation: { externalReservationId?: string | null }, organizationId: string): boolean {
  if (isDemoOrg(organizationId)) return false;
  return deliveryOutcomeOfRoute(resolveOutboundRoute(conversation)) === "local_only";
}

/**
 * Yüklemin SORGU İKİZİ: gerçek alıcısı olan konuşma (kanal konuşması ya da iç QR sohbeti) — iç kayıt dışarıda. "Cevap bekleyen" sayaçları,
 * panelin bekleyen listesi ve Dikkat panelinin cevapsız adayları bunu yayar (D3b): iç kayıtta bekleyen misafir yok, yazılabilecek cevap
 * yok. Demo hesabında süzgeç YOK (yüklemle aynı muafiyet). Doğruluk tablosu yüklemle aynı testte (`internal-record-page.test.ts`).
 * Boş dize de iç kayıttır (rota çözümü `!externalReservationId`).
 */
export function hasRecipientWhere(organizationId: string): Prisma.ConversationWhereInput {
  if (isDemoOrg(organizationId)) return {};
  return { AND: [{ externalReservationId: { not: null } }, { NOT: { externalReservationId: "" } }] };
}
