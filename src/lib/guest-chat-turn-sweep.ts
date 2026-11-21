import "server-only";

import { prisma } from "@/lib/db";
import { acquireGuestChatThreadLock } from "@/lib/guest-chat";
import { sendQrEscalationAlertBounded } from "@/lib/guest-chat-alerts";
import { recordRiskEvent } from "@/lib/risk-events";
import { reportError } from "@/lib/report-error";
import { QR_TURN_FRESH_MS, QR_TURN_OPEN_PREFIX, qrTurnDoneId, qrTurnKeyOf, qrTurnMergeEnabled } from "@/lib/guest-chat-turn-core";

// ---------------------------------------------------------------------------
// QR TEK CEVAP KİPİ — SAHİPSİZ AÇIK MESAJ SÜPÜRGESİ (ana oturum incelemesi 11-20; `docs/TASARIM-2026-11-20-qr-tek-cevap.md` §7 açılış şartı).
//
// Kip açıkken misafir satırı modelden ÖNCE yazılır. Satır yazıldıktan sonra istek beklenmedik biçimde biterse (çökme / dağıtım, veritabanı
// hatası, zaman aşımı) ve misafir yeniden göndermezse satır "açık" kalır: ev sahibi mesajı konuşmada görür ama işaret ve uyarı gitmezdi
// (sahipsiz satır yalnız misafirin SONRAKİ mesajında ev sahibine bırakılıyordu). Bu süpürge zamanlanmış turda `QR_TURN_FRESH_MS`ten eski
// açık satırları ev sahibine bırakır: satır "kararı verildi" olur, konuşma "Yanıtınızı bekliyor", satır başına karar kaydı
// (`qr_turn_abandoned`), konuşma başına TEK uyarı. Süren gerçek bir istek o kadar sürmez (çalışan kilit 120 sn); sürerse kendi kaydında
// "satırım artık açık değil" görür ve hiçbir şey yazmaz (cevap yerine ev sahibi — güvenli yön).
//
// Maliyet: mesaj tablosu taranmaz. Önce son 24 saatte hareket görmüş QR konuşmaları (dizinli), sonra yalnız o konuşmalarda açık işaretli
// satırlar (`(conversationId, externalId)` dizininde önek). Kip kapalıyken HİÇ sorgu yok. Asla fırlatmaz.
// ---------------------------------------------------------------------------

/** Süpürgenin baktığı pencere: bundan eski konuşmada açık satır kalmışsa misafir konaklamayı çoktan sürdürmüştür (yeni mesajı onu düşürür). */
export const QR_TURN_SWEEP_WINDOW_MS = 24 * 3_600_000;
/** Tur başına en çok bu kadar konuşma (kalanı sonraki turda). */
export const QR_TURN_SWEEP_BATCH = 50;

export async function sweepAbandonedQrTurns(now: Date = new Date()): Promise<{ conversations: number; rows: number }> {
  if (!qrTurnMergeEnabled()) return { conversations: 0, rows: 0 };
  let conversations = 0;
  let rows = 0;
  try {
    const staleBefore = new Date(now.getTime() - QR_TURN_FRESH_MS);
    const candidates = await prisma.message.findMany({
      where: {
        direction: "inbound",
        externalId: { startsWith: QR_TURN_OPEN_PREFIX },
        createdAt: { lt: staleBefore },
        conversation: { channel: "chat", lastMessageAt: { gte: new Date(now.getTime() - QR_TURN_SWEEP_WINDOW_MS) } },
      },
      distinct: ["conversationId"],
      take: QR_TURN_SWEEP_BATCH,
      select: { conversationId: true },
    });
    for (const { conversationId } of candidates) {
      try {
        const settled = await prisma.$transaction(async (tx) => {
          // Misafir rotasının ve ev sahibi cevabının aldığı AYNI konuşma kilidi: süren bir kayıtla yarışmaz.
          await acquireGuestChatThreadLock(tx, conversationId);
          const stale = await tx.message.findMany({
            where: { conversationId, direction: "inbound", externalId: { startsWith: QR_TURN_OPEN_PREFIX }, createdAt: { lt: staleBefore } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, externalId: true },
          });
          if (stale.length === 0) return null;
          for (const row of stale) {
            const key = qrTurnKeyOf(row.externalId);
            if (key) await tx.message.updateMany({ where: { id: row.id, externalId: row.externalId }, data: { externalId: qrTurnDoneId(key) } });
          }
          const conv = await tx.conversation.update({
            where: { id: conversationId },
            data: { priority: "urgent" },
            select: { reservationId: true, property: { select: { id: true, name: true, organizationId: true } } },
          });
          return { ids: stale.map((r) => r.id), conv };
        });
        if (!settled) continue;
        conversations += 1;
        rows += settled.ids.length;
        for (const id of settled.ids) {
          await recordRiskEvent({
            organizationId: settled.conv.property.organizationId,
            propertyId: settled.conv.property.id,
            conversationId,
            surface: "guest_chat",
            triggerId: id,
            finalDecision: "human_review",
            reason: "qr_turn_abandoned",
          });
        }
        if (settled.conv.reservationId) {
          await sendQrEscalationAlertBounded({
            organizationId: settled.conv.property.organizationId,
            propertyName: settled.conv.property.name,
            reservationId: settled.conv.reservationId,
            eventId: `turn-abandoned:${settled.ids[0]}`,
            reason: "ai_escalated",
            critical: false,
          });
        }
      } catch (err) {
        void reportError("qr-turn-sweep conversation", err);
      }
    }
  } catch (err) {
    void reportError("qr-turn-sweep", err);
  }
  return { conversations, rows };
}
