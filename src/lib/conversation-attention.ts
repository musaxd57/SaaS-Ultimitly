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
import { replyAuthorOf, type ClosingThreadMessage } from "@/lib/ai/closing-turn";

/** Kapanış kararının konuşmadaki izi (`persistRiskVisibility` / QR kaydı yazar). */
export const CLOSING_HANDLED_REASON = "closing_ack";

/**
 * Kapanış mesajına yine HİÇBİR ŞEY gönderilmedi, ama konuşmada açık iş olabilir (teklif kabulü, devirden sonraki
 * teşekkür, ev sahibine bırakılmış soru — `closingMayHide`): konuşma "cevap gerekmedi" diye GİZLENMEZ, görünür kalır.
 */
export const CLOSING_OPEN_REASON = "closing_ack_open";

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

/** Karar kaydının beyan alanı "…/defers" mi (misafire kararın ev sahibinde olduğu söylendi). Bozuk kanıt → hayır. */
function deferredToHost(kbEvidenceJson: string | null): boolean {
  if (!kbEvidenceJson) return false;
  try {
    const d = (JSON.parse(kbEvidenceJson) as { sc?: { d?: unknown } } | null)?.sc?.d;
    return typeof d === "string" && d.endsWith("/defers");
  } catch {
    return false;
  }
}

const DECISION_RANK: Readonly<Record<string, number>> = { auto_sent: 3, human_review: 2, no_reply: 1 };

/**
 * Son EV SAHİBİ mesajından sonra ev sahibine bırakılmış bir misafir mesajı var mı (kapanışta gizleme kapısı,
 * `closingMayHide`)? Mesaj başına en güçlü karar (`auto_sent` > `human_review` > `no_reply`): tutulan (`human_review`),
 * ya da gönderilmiş ama kararı ev sahibine bırakan (beyan `defers`; doğrulanmış onay / politika metni HARİÇ) mesaj açık
 * iştir. Kiracı kapsamlı; yalnız cevap yüzeyleri (kanal + QR). Okunamazsa AÇIK sayılır (gizleme yok = güvenli yön).
 */
export async function hasOpenHostWork(
  organizationId: string,
  messages: readonly (ClosingThreadMessage & { id: string })[],
): Promise<boolean> {
  let lastHost = -1;
  messages.forEach((m, i) => {
    if (replyAuthorOf(m) === "host") lastHost = i;
  });
  const ids = messages
    .slice(lastHost + 1)
    .filter((m) => m.direction === "inbound")
    .map((m) => m.id)
    .slice(-50);
  if (ids.length === 0) return false;
  try {
    const rows = await prisma.riskEvent.findMany({
      where: { organizationId, surface: { in: ["auto_reply", "guest_chat"] }, triggerId: { in: ids } },
      select: { triggerId: true, finalDecision: true, reason: true, kbEvidenceJson: true },
    });
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = best.get(r.triggerId);
      if (!cur || (DECISION_RANK[r.finalDecision] ?? 0) > (DECISION_RANK[cur.finalDecision] ?? 0)) best.set(r.triggerId, r);
    }
    for (const r of best.values()) {
      if (r.finalDecision === "human_review") return true;
      if (
        r.finalDecision === "auto_sent" &&
        r.reason !== "early_checkin_verified" &&
        r.reason !== "early_checkin_policy" &&
        deferredToHost(r.kbEvidenceJson)
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}
