import "server-only";

import type { Prisma } from "@prisma/client";
import { recordIngestEvent } from "@/lib/ingest/events";
import { DELIVERY_PATH } from "@/lib/delivery-path";
import { CLOSING_HANDLED_REASON, CLOSING_OPEN_REASON } from "@/lib/conversation-attention";
import {
  QR_TURN_OPEN_PREFIX,
  partitionQrTurn,
  qrTurnCommitVerdict,
  qrTurnDoneId,
  qrTurnKeyOf,
  qrTurnOpenId,
  splitQrReply,
} from "@/lib/guest-chat-turn-core";

// ---------------------------------------------------------------------------
// QR'DA TEK CEVAP — veritabanı yarısı (çekirdek + gerekçe: `guest-chat-turn-core.ts`).
//
// İki işlem, ikisi de KONUŞMA KİLİDİ ALTINDA (çağıran `acquireGuestChatThreadLock` alır; ev sahibinin cevap rotası da aynı kilidi alır):
//  1. `persistQrTurnInbound` — misafir satırı modelden ÖNCE, "açık" işaretiyle yazılır; aynı işlemde tur (o an açık satırlar) okunur.
//  2. `commitQrTurn` — karar anı: açık satırlar yeniden okunur, hüküm (`qrTurnCommitVerdict`) uygulanır, satırlar "kararı verildi" olur.
// Kilit, iki işlemin sırasını kesinleştirir: bir isteğin kaydı ile öteki isteğin mesajı aynı anda "görülmemiş" kalamaz.
// ---------------------------------------------------------------------------

export interface QrTurnRow {
  id: string;
  body: string;
  createdAt: Date;
  externalId: string;
}

const TURN_ROW_SELECT = { id: true, body: true, createdAt: true, externalId: true } as const;

/** Konuşmanın açık (kararı verilmemiş) misafir satırları, yazılış sırasıyla. `(conversationId, externalId)` dizininde önek taraması. */
export async function loadOpenQrTurnRows(db: Prisma.TransactionClient, conversationId: string): Promise<QrTurnRow[]> {
  const rows = await db.message.findMany({
    where: { conversationId, direction: "inbound", externalId: { startsWith: QR_TURN_OPEN_PREFIX } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: TURN_ROW_SELECT,
  });
  return rows.map((r) => ({ ...r, externalId: r.externalId as string }));
}

/** Konuşmanın en yeni satırından KESİN sonra gelen an (satır sırası saatler arası kaymaya bağlı kalmasın). */
async function nextMessageInstant(tx: Prisma.TransactionClient, conversationId: string, now: Date): Promise<Date> {
  const latest = await tx.message.findFirst({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  return latest && latest.createdAt.getTime() >= now.getTime() ? new Date(latest.createdAt.getTime() + 1) : now;
}

async function markRowsDecided(tx: Prisma.TransactionClient, rows: readonly { id: string; externalId: string }[]): Promise<void> {
  for (const row of rows) {
    const key = qrTurnKeyOf(row.externalId);
    if (!key) continue;
    // Koşullu: yalnız hâlâ açık olan satır döner (kilit altında tek yazar; koşul savunma).
    await tx.message.updateMany({ where: { id: row.id, externalId: row.externalId }, data: { externalId: qrTurnDoneId(key) } });
  }
}

export interface PersistedQrTurn {
  /** Bu isteğin misafir satırı. */
  ownId: string;
  /** Satırın kararı ÖNCEKİ bir denemede verilmiş (aynı istek kimliği geç yeniden geldi) → yapılacak iş yok. */
  alreadyDecided: boolean;
  /** Bu isteğin turu: kendi satırı dahil, o an açık ve taze satırlar (yazılış sırasıyla). */
  turn: QrTurnRow[];
  /** Sahipsiz bulunup ev sahibine bırakılan satırlar (çağıran karar kaydı + uyarı üretir). */
  staleIds: string[];
}

/**
 * Misafir satırını "açık" işaretiyle yazar (aynı istek kimliğinin satırı varsa YENİDEN yazmaz — yarıda kalmış bir denemenin tekrarı aynı
 * satırı sürdürür) ve turu döner. Sahipsiz açık satırlar (`QR_TURN_FRESH_MS`) aynı işlemde ev sahibine bırakılır: kararı verildi + konuşma
 * "Yanıtınızı bekliyor". Çağıran konuşma kilidini ve silme sınırını bu çağrıdan ÖNCE almış olmalıdır.
 */
export async function persistQrTurnInbound(
  tx: Prisma.TransactionClient,
  input: { conversationId: string; organizationId: string; guestName: string; body: string; key: string; now?: Date },
): Promise<PersistedQrTurn> {
  const existing = await tx.message.findFirst({
    where: { conversationId: input.conversationId, externalId: { in: [qrTurnOpenId(input.key), qrTurnDoneId(input.key)] } },
    select: TURN_ROW_SELECT,
  });
  let own: QrTurnRow;
  if (existing) {
    own = { ...existing, externalId: existing.externalId as string };
    if (own.externalId === qrTurnDoneId(input.key)) return { ownId: own.id, alreadyDecided: true, turn: [], staleIds: [] };
  } else {
    const at = await nextMessageInstant(tx, input.conversationId, input.now ?? new Date());
    const created = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        direction: "inbound",
        authorType: "guest",
        senderName: input.guestName,
        body: input.body,
        language: "tr",
        externalId: qrTurnOpenId(input.key),
        // V0.4 provenance: misafirin satırı bir girişten geçti; iç sohbet → bağlantı kimliği yok (eski kayıt yoluyla aynı alanlar).
        ingestedAt: at,
        createdAt: at,
      },
      select: TURN_ROW_SELECT,
    });
    own = { ...created, externalId: created.externalId as string };
    await tx.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: at } });
    // V1 ürün akışı: misafir satırı bir alan olayıdır (`message.received`, aynı işlemde, kişisel veri taşımaz).
    await recordIngestEvent(tx, { organizationId: input.organizationId, provider: "qr_chat", connectionId: null }, "message", own.id, "message.received");
  }
  const open = await loadOpenQrTurnRows(tx, input.conversationId);
  const { turn, stale } = partitionQrTurn(open, own);
  if (stale.length > 0) {
    await markRowsDecided(tx, stale);
    await tx.conversation.update({ where: { id: input.conversationId }, data: { priority: "urgent" } });
  }
  return { ownId: own.id, alreadyDecided: false, turn, staleIds: stale.map((r) => r.id) };
}

export type QrTurnCommitOutcome =
  /** Hiçbir şey yazılmadı: karar başka istekte (ya da daha yeni mesajın isteğinde). */
  | { outcome: "superseded" }
  | {
      outcome: "committed";
      /** Misafire yazılan cevap parçaları (yoksa boş). */
      replyParts: string[];
      /** Cevap yazılacaktı ama tur değişti / ev sahibi devraldı → satırlar ev sahibine bırakıldı. */
      heldInstead: boolean;
    };

/**
 * Turun kararını yazar. `reply` misafire gidecek metin (yoksa `null`); `escalated` ev sahibine bırakma; `closing` sessiz kapanışın konuşma
 * izi (eski kayıt yoluyla AYNI alanlar: öncelik, kapanış gerekçesi + karar damgası son mesaja eşit). Konuşma kilidi çağıranda. Cevap
 * satırları konuşmanın son satırından kesin sonra damgalanır; uzun cevap iki satıra bölünür.
 */
export async function commitQrTurn(
  tx: Prisma.TransactionClient,
  input: {
    conversationId: string;
    ownId: string;
    seenIds: readonly string[];
    reply: string | null;
    escalated: boolean;
    closing: false | "handled" | "open";
    /** Ev sahibi devraldı (kilit altında okundu; yalnız cevap yazılacakken sorulur): cevap yazılmaz, satırlar ev sahibine kalır. */
    paused: boolean;
    now?: Date;
  },
): Promise<QrTurnCommitOutcome> {
  const open = await loadOpenQrTurnRows(tx, input.conversationId);
  const verdict = qrTurnCommitVerdict({
    ownId: input.ownId,
    seenIds: input.seenIds,
    openIds: open.map((r) => r.id),
    hasReply: input.reply !== null,
    escalated: input.escalated || input.paused,
  });
  if (verdict.action === "drop") return { outcome: "superseded" };
  const heldInstead = verdict.heldInstead || input.paused;
  const replyParts = verdict.writeReply && !input.paused && input.reply !== null ? splitQrReply(input.reply) : [];
  const now = input.now ?? new Date();
  await markRowsDecided(tx, open.filter((r) => verdict.rowIds.includes(r.id)));
  let touchedAt = now;
  if (replyParts.length > 0) {
    const first = await nextMessageInstant(tx, input.conversationId, now);
    await tx.message.createMany({
      data: replyParts.map((body, i) => ({
        conversationId: input.conversationId,
        direction: "outbound",
        authorType: "ai",
        senderName: "Lixus AI",
        body,
        language: "tr",
        createdAt: new Date(first.getTime() + i),
        deliveryPath: DELIVERY_PATH.qr,
      })),
    });
    touchedAt = new Date(first.getTime() + replyParts.length - 1);
  }
  const escalated = input.escalated || heldInstead;
  const closing = heldInstead ? false : input.closing;
  await tx.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageAt: touchedAt,
      ...(escalated ? { priority: "urgent" } : {}),
      ...(closing === "handled" ? { skippedReason: CLOSING_HANDLED_REASON, autoReplyAttemptedAt: touchedAt } : {}),
      ...(closing === "open" ? { skippedReason: CLOSING_OPEN_REASON } : {}),
    },
  });
  return { outcome: "committed", replyParts, heldInstead };
}
