import { readSessionCookie, verifySession } from "@/lib/auth/session";
import { isImpersonating } from "@/lib/auth/impersonation";

// ---------------------------------------------------------------------------
// DESTEK GÖRÜNÜMÜ MİSAFİR SOHBETİNE GİRMEZ (kurucu kararı 09-30). QR sohbeti her konaklamada onu İLK açan cihaza kilitlenir;
// bürünmüş operatörün bir göz atması gerçek misafiri dışarıda bırakırdı. Sayfa ve uçlar aynı yüklemi kullanır: istek, imzası
// doğrulanmış bir BÜRÜNME oturumu (`actorUserId`) taşıyorsa sohbet açılmaz, cihaz bağlanmaz. Çerez başlığından okunur
// (next/headers gerekmez — rota da sayfa da aynı kural). Yaprak modül: Next.js `route.ts` yalnız rota alanlarını dışa aktarır.
// ---------------------------------------------------------------------------

export const SUPPORT_VIEW_GUEST_CHAT_MESSAGE =
  "Destek görünümünde misafir sohbeti açılmaz — açmak misafirin sohbetini bu cihaza kilitlerdi. Konuşmaları panelde 'QR Misafir Sohbetleri' sayfasından okuyun.";

function cookieFromHeader(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** İstek bürünmüş operatörün tarayıcısından mı (imzası doğrulanmış oturum çerezi). Çerez yok / geçersiz → hayır (sıradan ziyaretçi). */
export async function isSupportViewCookieHeader(cookieHeader: string | null | undefined): Promise<boolean> {
  if (!cookieHeader) return false;
  const token = readSessionCookie((name) => cookieFromHeader(cookieHeader, name));
  return isImpersonating(await verifySession(token));
}
