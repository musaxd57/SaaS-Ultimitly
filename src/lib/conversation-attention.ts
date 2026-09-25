// ---------------------------------------------------------------------------
// "CEVAP GEREKMEDİ" HÂLİ (kurucu kuralı 09-25). Misafir yalnız teşekkür / onay / övgü yazdı ve cevapsız başka bir
// soru/istek yoktu → yapay zekâ BİLEREK hiçbir şey göndermedi (`ai/closing-turn.ts`). Böyle bir konuşma ev sahibinin
// "yeni / cevap bekliyor" listelerinde görünmemeli.
//
// DURUM DEĞİŞTİRİLMEZ, hâl TÜRETİLİR:
//  · `answered` yazılamaz — senkron konuşma durumunu son mesajın yönünden yeniden kurar, sıradaki senkronda `new`e döner;
//  · `closed` yazılamaz — senkron onu korur, misafir YENİDEN yazınca bile konuşma açılmazdı;
//  · "Sorunlu" hiçbir zaman gizlenmez.
// Hâl = kapanış kararı (`skippedReason = closing_ack`) + karar damgası son mesaja yetişmiş (`autoReplyAttemptedAt >=
// lastMessageAt`). Misafir yeniden yazınca `lastMessageAt` damgayı geçer → konuşma kendiliğinden yeniden "yeni" olur.
// Damgayı kanal oto-yanıtı (`runDueChannelAutoReplies`) ve QR rotası kararın verildiği mesajın zamanıyla yazar.
// ---------------------------------------------------------------------------

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Kapanış kararının konuşmadaki izi (`persistRiskVisibility` / QR kaydı yazar). */
export const CLOSING_HANDLED_REASON = "closing_ack";

/** Ev sahibine görünen etiket (gelen kutusu satırı). Sade; teknik gerekçe yok. */
export const CLOSING_HANDLED_LABEL = "Cevap gerekmedi";

/**
 * "Sorunlu" hiçbir zaman bu hâle girmez (host'un açık kararı / yükseltme). Başka durumlar girebilir: kanal konuşması
 * `new` kalır; QR sohbeti ise her zaman `answered` tutulur (kanal sayaçlarına sızmasın diye) — onun "cevapsız" görünmemesi
 * de aynı kurala bağlıdır ("Dikkat gerektirenler" durum süzmez).
 */
const NEVER_HIDDEN_STATUS = "problem";

export interface ClosingHandledFields {
  status: string;
  skippedReason: string | null;
  autoReplyAttemptedAt: Date | null;
  lastMessageAt: Date;
}

/** Konuşma "cevap gerekmedi" hâlinde mi (liste satırı / sayaç için; SQL ikizi `notClosingHandledWhere`). */
export function isClosingHandled(c: ClosingHandledFields): boolean {
  return (
    c.status !== NEVER_HIDDEN_STATUS &&
    c.skippedReason === CLOSING_HANDLED_REASON &&
    c.autoReplyAttemptedAt !== null &&
    c.autoReplyAttemptedAt.getTime() >= c.lastMessageAt.getTime()
  );
}

/**
 * "Cevap gerekmedi" hâlinde OLMAYAN konuşmalar (`isClosingHandled`in SQL tersi). 🚨 NULL güvenli yazılır: `NOT {…}` ya da
 * `not: "closing_ack"` SQL'de NULL satırı da düşürür (`NULL <> x` → NULL) — `skippedReason` boş her konuşma listeden
 * kaybolurdu. `AND: [notClosingHandledWhere()]` biçiminde eklenir (çağıranın kendi `OR`uyla çakışmasın).
 */
export function notClosingHandledWhere(): Prisma.ConversationWhereInput {
  return {
    OR: [
      { status: NEVER_HIDDEN_STATUS },
      { skippedReason: null },
      { skippedReason: { not: CLOSING_HANDLED_REASON } },
      { autoReplyAttemptedAt: null },
      { autoReplyAttemptedAt: { lt: prisma.conversation.fields.lastMessageAt } },
    ],
  };
}
