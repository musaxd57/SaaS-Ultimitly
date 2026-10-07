import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { LEGACY_AI_RESUME_SENDER, LEGACY_AI_SENDER_NAMES } from "@/lib/message-author";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import {
  DECISION_SENDING_STALE_MS,
  effectiveDecisionStatus,
  isDecisionKind,
  isDecisionStatus,
  isOpenDecision,
  liveDecisionDayKey,
  type DecisionKind,
  type DecisionStatus,
  type EffectiveDecisionStatus,
} from "./core";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KALICI KAYIT (migration 59). Karar kuralları `core.ts`te (saf); burası yalnız yazar / okur.
//  · Her sorgu `organizationId` ile (kiracı yalıtımı; davranışsal test).
//  · Kimlik (konuşma, mesaj, tür) tekil: aynı mesaj iki kez işlense de TEK kart, TEK bildirim.
//  · Her durum geçişi CAS (`status` + `version`): eşzamanlı ikinci karar / çift tıklama 0 satır günceller → 409.
//  · "Ev sahibi yazdı" SAKLANMAZ: okuma anında talepten SONRAKİ ev sahibi mesajından türetilir — karar kartıyla giden
//    mesajlar hariç (bir kartın onayı aynı konuşmadaki başka bir kartı "yanıtladınız" yapmasın).
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

// Açık iş olabilecek SAKLI durumlar (görünen durum ayrıca türetilir): bekleyen, gönderimi doğrulanamayan ve yarıda kalmış olabilecek
// gönderim (`sending`; taze ise açık sayılmaz — `effectiveDecisionStatus`).
const OPEN_STORED: DecisionStatus[] = ["pending", "send_unverified", "sending"];

export interface DecisionToOpen {
  kind: DecisionKind;
  messageId: string;
  itemId: string | null;
  requestedTime: string | null;
  dayKey: string | null;
}

export interface PersistedDecision {
  id: string;
  conversationId: string;
  messageId: string;
  itemId: string | null;
  reservationId: string | null;
  kind: DecisionKind;
  requestedTime: string | null;
  dayKey: string | null;
  lang: string;
  status: DecisionStatus;
  version: number;
  decidedTime: string | null;
  decidedAt: Date | null;
  resultMessageId: string | null;
  notifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type Row = Prisma.DecisionRequestGetPayload<object>;

function toPersisted(r: Row): PersistedDecision | null {
  if (!isDecisionKind(r.kind) || !isDecisionStatus(r.status)) return null;
  return {
    id: r.id,
    conversationId: r.conversationId,
    messageId: r.messageId,
    itemId: r.itemId,
    reservationId: r.reservationId,
    kind: r.kind,
    requestedTime: r.requestedTime,
    dayKey: r.dayKey,
    lang: r.lang,
    status: r.status,
    version: r.version,
    decidedTime: r.decidedTime,
    decidedAt: r.decidedAt,
    resultMessageId: r.resultMessageId,
    notifiedAt: r.notifiedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Bu turun karar kartlarını açar (yoksa) ve aynı konuşmadaki AYNI türden daha ESKİ bekleyen kartı "yeni istekle değişti" yapar
 * (misafir saati değiştirdi: 13:00 → 12:00 — tek açık kart kalır). Var olan kart yeniden açılmaz / ezilmez; yalnız boş saat / gün
 * doldurulur (ilk okuma eksikse). Dönüş: bu turun kartları (yeni ya da var olan).
 */
export async function openTurnDecisions(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    reservationId: string | null;
    lang: string;
    decisions: readonly DecisionToOpen[];
    now: Date;
  },
): Promise<PersistedDecision[]> {
  const out: PersistedDecision[] = [];
  for (const d of input.decisions) {
    const where = { conversationId_messageId_kind: { conversationId: input.conversationId, messageId: d.messageId, kind: d.kind } };
    let row = await db.decisionRequest.findUnique({ where });
    if (row && row.organizationId !== input.organizationId) continue;
    if (!row) {
      // Misafir aynı talebi değiştirdi (13:00 → 12:00): yerine geçilen BEKLEYEN kart bildirildiyse yeni kart da bildirilmiş sayılır
      // — kurucu: "host'a bir bildirim gider; tekrar tekrar gönderilmez" (kart panelde güncellenir).
      const prior = await db.decisionRequest.findFirst({
        where: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          kind: d.kind,
          status: "pending",
          notifiedAt: { not: null },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { notifiedAt: true },
      });
      try {
        row = await db.decisionRequest.create({
          data: {
            organizationId: input.organizationId,
            conversationId: input.conversationId,
            messageId: d.messageId,
            itemId: d.itemId,
            reservationId: input.reservationId,
            kind: d.kind,
            requestedTime: d.requestedTime,
            dayKey: d.dayKey,
            lang: input.lang,
            notifiedAt: prior?.notifiedAt ?? null,
          },
        });
      } catch (err) {
        // Eşzamanlı geçiş aynı kartı önce yazdı → onu kullan (tek kart).
        if (!isUnique(err)) throw err;
        row = await db.decisionRequest.findUnique({ where });
        if (!row || row.organizationId !== input.organizationId) continue;
      }
    } else if (row.status === "pending" && ((row.requestedTime === null && d.requestedTime) || (row.dayKey === null && d.dayKey))) {
      const res = await db.decisionRequest.updateMany({
        where: { id: row.id, organizationId: input.organizationId, status: "pending", version: row.version },
        data: {
          ...(row.requestedTime === null && d.requestedTime ? { requestedTime: d.requestedTime } : {}),
          ...(row.dayKey === null && d.dayKey ? { dayKey: d.dayKey } : {}),
          version: { increment: 1 },
        },
      });
      if (res.count === 1) row = await db.decisionRequest.findUnique({ where });
    }
    if (!row) continue;
    // Aynı türden daha eski BEKLEYEN kart (başka mesaj) → yerini yeni istek aldı.
    await db.decisionRequest.updateMany({
      where: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: d.kind,
        status: "pending",
        id: { not: row.id },
        createdAt: { lte: row.createdAt },
      },
      data: { status: "superseded", version: { increment: 1 } },
    });
    const p = toPersisted(row);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Doğrulanmış OTOMATİK onay gitti (erken giriş kanıt modeli, kod metni): kart "otomatik onaylandı" olarak kaydedilir — bekleyen
 * kart kalmaz, aynı türden eski bekleyen kart kapanır; onaylanan saat yapısal kayıttır (geç çıkışta sonraki misafirin erken giriş
 * kontrolü okur). Var olan BEKLEYEN kart da çözülür (aynı mesaj yeniden değerlendirildi).
 */
export async function resolveDecisionByPolicy(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    reservationId: string | null;
    lang: string;
    kind: DecisionKind;
    messageId: string;
    itemId: string | null;
    dayKey: string | null;
    decidedTime: string;
    now: Date;
  },
): Promise<void> {
  const where = { conversationId_messageId_kind: { conversationId: input.conversationId, messageId: input.messageId, kind: input.kind } };
  const existing = await db.decisionRequest.findUnique({ where });
  if (existing && existing.organizationId !== input.organizationId) return;
  if (!existing) {
    try {
      await db.decisionRequest.create({
        data: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          itemId: input.itemId,
          reservationId: input.reservationId,
          kind: input.kind,
          requestedTime: input.decidedTime,
          dayKey: input.dayKey,
          lang: input.lang,
          status: "resolved_by_policy",
          decidedTime: input.decidedTime,
          decidedAt: input.now,
        },
      });
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  } else if (existing.status === "pending") {
    await db.decisionRequest.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, status: "pending", version: existing.version },
      data: { status: "resolved_by_policy", decidedTime: input.decidedTime, decidedAt: input.now, version: { increment: 1 } },
    });
  }
  await db.decisionRequest.updateMany({
    where: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      kind: input.kind,
      status: "pending",
      NOT: { messageId: input.messageId },
    },
    data: { status: "superseded", version: { increment: 1 } },
  });
}

/**
 * Bu turun mesajlarına bağlı, AYNI türden en yeni kart (yerine geçilmiş kartlar hariç) — misafir aynı talebe "?" / "teşekkürler"
 * eklediğinde yeni kart açılmasın; doğrulanmış otomatik onay ev sahibinin elindeki kartı ezmesin.
 */
export async function findTurnDecision(
  db: Db,
  input: { organizationId: string; conversationId: string; kind: DecisionKind; messageIds: readonly string[] },
): Promise<PersistedDecision | null> {
  if (input.messageIds.length === 0) return null;
  const row = await db.decisionRequest.findFirst({
    where: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      kind: input.kind,
      messageId: { in: [...input.messageIds] },
      status: { not: "superseded" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return row ? toPersisted(row) : null;
}

/**
 * Doğrulanmış OTOMATİK erken giriş onayı göndermeden HEMEN önce bu turun kartını sahiplenir (CAS: bekleyen → "otomatik onaylandı").
 * Ev sahibi kartta karar verdiyse / veriyorsa (gönderiliyor, onaylandı, reddedildi, doğrulanamadı, kapatıldı) ya da yarış
 * kaybedildiyse `ok: false` → otomatik onay GİTMEZ (misafir çelişen iki mesaj almasın). Kart yoksa `ok: true` + `claimed: null`.
 */
export async function claimTurnDecisionForPolicy(
  db: Db,
  input: { organizationId: string; conversationId: string; kind: DecisionKind; messageIds: readonly string[]; decidedTime: string; now: Date },
): Promise<{ ok: boolean; claimed: { id: string; version: number } | null }> {
  const card = await findTurnDecision(db, input);
  if (!card) return { ok: true, claimed: null };
  if (card.status !== "pending") return { ok: false, claimed: null };
  const res = await db.decisionRequest.updateMany({
    where: { id: card.id, organizationId: input.organizationId, status: "pending", version: card.version },
    data: { status: "resolved_by_policy", decidedTime: input.decidedTime, decidedAt: input.now, version: { increment: 1 } },
  });
  return res.count === 1 ? { ok: true, claimed: { id: card.id, version: card.version + 1 } } : { ok: false, claimed: null };
}

/**
 * Otomatik onay gönderilemedi: KESİN hata (hiçbir şey gitmedi) → kart yeniden "karar bekliyor"; BELİRSİZ (ulaşmış olabilir) →
 * "gönderim doğrulanamadı" (ev sahibi kanaldan bakar; kör tekrar yok). Yalnız bu talebin sürümü duruyorsa.
 */
export async function releasePolicyClaim(
  db: Db,
  input: { organizationId: string; id: string; version: number; outcome: "reopen" | "unverified" },
): Promise<void> {
  await db.decisionRequest.updateMany({
    where: { id: input.id, organizationId: input.organizationId, status: "resolved_by_policy", version: input.version },
    data:
      input.outcome === "reopen"
        ? { status: "pending", decidedTime: null, decidedAt: null, version: { increment: 1 } }
        : { status: "send_unverified", version: { increment: 1 } },
  });
}

/** "Karar bekliyor" e-postası için atomik talep (yalnız henüz bildirilmemiş BEKLEYEN kart). */
export async function claimDecisionNotification(db: Db, input: { organizationId: string; id: string; now: Date }): Promise<boolean> {
  const res = await db.decisionRequest.updateMany({
    where: { id: input.id, organizationId: input.organizationId, notifiedAt: null, status: "pending" },
    data: { notifiedAt: input.now },
  });
  return res.count === 1;
}

/** E-posta gidemediyse talep geri alınır (yalnız bu talebin damgası duruyorsa). */
export async function releaseDecisionNotification(db: Db, input: { organizationId: string; id: string; claimedAt: Date }): Promise<void> {
  await db.decisionRequest.updateMany({
    where: { id: input.id, organizationId: input.organizationId, notifiedAt: input.claimedAt },
    data: { notifiedAt: null },
  });
}

/** Ev sahibinin YAZDIĞI giden mesaj koşulu (öğelerle aynı: güvenilir yazar; eski satırlar için türetme — `message-author.ts`). */
const HOST_OUTBOUND_WHERE: Prisma.MessageWhereInput = {
  direction: "outbound",
  OR: [
    { authorType: "host" },
    { authorType: null, senderName: { notIn: [...LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER] } },
  ],
};

export type DecisionView = PersistedDecision & {
  effective: EffectiveDecisionStatus;
  /** Talebin mesajının yazıldığı an (mesaj bulunamazsa kartın kendi zamanı). */
  messageAt: Date;
  /** Konuşmanın mülkü ve kanalı (pano satırının bağlantısı / kapsamı). */
  propertyId: string;
  channel: string;
};

/**
 * Kartların görünen durumu: talepten SONRA (karar kartıyla gitmeyen) ev sahibi mesajı var mı, rezervasyon iptal mi, hedef gün
 * geçti mi. Hedef gün CANLI (rezervasyonun bugünkü tarihlerinden — `liveDecisionDayKey`); görünümün `dayKey`i budur. Kart başına
 * mesaj zamanı ve konuşma başına son ev sahibi mesajı tek toplu sorguyla (öğelerin `stillOpenForHost`iyle AYNI koşul; tavan yok —
 * çok konuşmalı gelen kutusunda kesilen liste bir cevabı gizleyemez); kiracı kapsamı konuşmanın mülkünden.
 */
async function withEffective(
  db: Db,
  organizationId: string,
  rows: readonly PersistedDecision[],
  ctx: { timeZone: string; now: Date },
): Promise<DecisionView[]> {
  if (rows.length === 0) return [];
  const conversationIds = [...new Set(rows.map((r) => r.conversationId))];
  const [messages, conversations, resultIds] = await Promise.all([
    db.message.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.messageId))] }, conversationId: { in: conversationIds } },
      select: { id: true, createdAt: true },
    }),
    db.conversation.findMany({
      where: { id: { in: conversationIds }, property: { organizationId } },
      select: {
        id: true,
        propertyId: true,
        channel: true,
        reservation: { select: { id: true, status: true, arrivalDate: true, departureDate: true } },
      },
    }),
    db.decisionRequest.findMany({
      where: { organizationId, conversationId: { in: conversationIds }, resultMessageId: { not: null } },
      select: { resultMessageId: true },
    }),
  ]);
  const messageAt = new Map(messages.map((m) => [m.id, m.createdAt]));
  const convById = new Map(conversations.map((c) => [c.id, c]));
  const decisionMessages = resultIds.map((r) => r.resultMessageId).filter((v): v is string => v !== null);
  const pendingConvs = [...new Set(rows.filter((r) => r.status === "pending").map((r) => r.conversationId))].filter((id) => convById.has(id));
  const hosts =
    pendingConvs.length > 0
      ? await db.message.groupBy({
          by: ["conversationId"],
          where: {
            conversationId: { in: pendingConvs },
            conversation: { property: { organizationId } },
            ...HOST_OUTBOUND_WHERE,
            ...(decisionMessages.length > 0 ? { id: { notIn: decisionMessages } } : {}),
          },
          _max: { createdAt: true },
        })
      : [];
  const lastHostAt = new Map(hosts.map((h) => [h.conversationId, h._max.createdAt]));
  const today = todayKey(ctx.now, ctx.timeZone);
  return rows.flatMap((r) => {
    const conv = convById.get(r.conversationId);
    if (!conv) return [];
    const at = messageAt.get(r.messageId) ?? r.createdAt;
    const host = lastHostAt.get(r.conversationId) ?? null;
    const res = conv.reservation;
    const dayKey = liveDecisionDayKey(
      r,
      res
        ? {
            id: res.id,
            arrivalKey: calendarDateOf(res.arrivalDate, ctx.timeZone).key,
            departureKey: calendarDateOf(res.departureDate, ctx.timeZone).key,
          }
        : null,
    );
    return [
      {
        ...r,
        dayKey,
        messageAt: at,
        propertyId: conv.propertyId,
        channel: conv.channel,
        effective: effectiveDecisionStatus(r.status, {
          hostRepliedAfter: host !== null && host > at,
          reservationCancelled: /cancel/i.test(res?.status ?? ""),
          dayKey,
          todayKey: today,
          sendingStale: r.status === "sending" && ctx.now.getTime() - r.updatedAt.getTime() > DECISION_SENDING_STALE_MS,
        }),
      },
    ];
  });
}

/** Bir konuşmanın kartları (en yeni önce), görünen durumla. */
export async function listConversationDecisions(
  db: Db,
  input: { organizationId: string; conversationId: string; timeZone: string; now: Date },
): Promise<DecisionView[]> {
  const rows = await db.decisionRequest.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  const persisted = rows.map(toPersisted).filter((r): r is PersistedDecision => r !== null);
  return withEffective(db, input.organizationId, persisted, input);
}

/**
 * Gelen kutusu rozeti: konuşma başına AÇIK (karar bekleyen / gönderimi doğrulanamayan) kart sayısı + bu kartların bağlı olduğu
 * konuşma öğeleri (aynı talep "açık iş" rozetinde İKİNCİ kez sayılmasın — öğe sayımı bunları düşer).
 */
export async function openDecisionCounts(
  db: Db,
  input: { organizationId: string; conversationIds: readonly string[]; timeZone: string; now: Date },
): Promise<{ counts: Map<string, number>; unverified: Map<string, number>; itemIds: string[] }> {
  const counts = new Map<string, number>();
  const unverified = new Map<string, number>();
  const itemIds: string[] = [];
  if (input.conversationIds.length === 0) return { counts, unverified, itemIds };
  const rows = await db.decisionRequest.findMany({
    where: { organizationId: input.organizationId, conversationId: { in: [...input.conversationIds] }, status: { in: OPEN_STORED } },
  });
  const persisted = rows.map(toPersisted).filter((r): r is PersistedDecision => r !== null);
  for (const v of await withEffective(db, input.organizationId, persisted, input)) {
    if (!isOpenDecision(v.effective)) continue;
    counts.set(v.conversationId, (counts.get(v.conversationId) ?? 0) + 1);
    if (v.effective === "send_unverified") unverified.set(v.conversationId, (unverified.get(v.conversationId) ?? 0) + 1);
    if (v.itemId) itemIds.push(v.itemId);
  }
  return { counts, unverified, itemIds };
}

/**
 * Komşu konaklamaların kartları (aynı gün devir: önceki misafirin geç çıkışı ↔ sonraki misafirin erken girişi) — görünen
 * durumla. Yalnız verilen türler; boş girdide sorgu yok.
 */
export async function decisionsForReservations(
  db: Db,
  input: { organizationId: string; reservationIds: readonly string[]; kinds: readonly DecisionKind[]; timeZone: string; now: Date },
): Promise<DecisionView[]> {
  if (input.reservationIds.length === 0 || input.kinds.length === 0) return [];
  const rows = await db.decisionRequest.findMany({
    where: {
      organizationId: input.organizationId,
      reservationId: { in: [...input.reservationIds] },
      kind: { in: [...input.kinds] },
      // `sending` da: gönderim sürerken komşu kartta "onaylandı" saati görünsün (kilit onay saatini yazar; ret saat taşımaz).
      status: { in: ["pending", "sending", "send_unverified", "approved", "resolved_by_policy"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  const persisted = rows.map(toPersisted).filter((r): r is PersistedDecision => r !== null);
  return withEffective(db, input.organizationId, persisted, input);
}

/**
 * "Dikkat Gerektirenler" için: org'daki AÇIK kartlar. EN YENİ önce okunur (tavan 200): günü geçmiş / yanıtlanmış eski kartlar
 * saklı durumda "pending" kalır ve süzgeç onları okumadan eleyemez — en eski önce okuyan tavan yeni talepleri dışarıda bırakırdı.
 */
export async function openDecisionsForOrg(
  db: Db,
  input: { organizationId: string; timeZone: string; now: Date; limit?: number },
): Promise<DecisionView[]> {
  const rows = await db.decisionRequest.findMany({
    where: { organizationId: input.organizationId, status: { in: OPEN_STORED } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(input.limit ?? 200, 1), 500),
  });
  const persisted = rows.map(toPersisted).filter((r): r is PersistedDecision => r !== null);
  return (await withEffective(db, input.organizationId, persisted, input)).filter((v) => isOpenDecision(v.effective));
}
