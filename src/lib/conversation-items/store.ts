import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { LEGACY_AI_RESUME_SENDER, LEGACY_AI_SENDER_NAMES, historyAuthorOf } from "@/lib/message-author";
import {
  ITEM_SOURCES,
  effectiveStatus,
  isItemKind,
  isItemSensitivity,
  isItemStatus,
  isOpenForHost,
  maySupersede,
  mergeItemFacts,
  nextStatus,
  type BuiltItem,
  type EffectiveItemStatus,
  type ItemEvent,
  type ItemKind,
  type ItemSensitivity,
  type ItemSource,
  type ItemStatus,
} from "./core";
import type { TurnWithdrawal } from "./extract";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — KALICI KAYIT (09-26; migration 56). Karar kuralları `core.ts`te (saf); burası yalnız yazar/okur.
//  · Her sorgu `organizationId` ile (kiracı yalıtımı; davranışsal test).
//  · Bir mesajda her tür BİR satır (tekillik): iki geçiş aynı satırı BİRLEŞTİRİR, hassaslık yalnız yükselir.
//  · Geçişler iyimser kilitle (durum / `updatedAt` CAS): eşzamanlı ikinci yazıcı bir öğeyi geri açamaz, hassaslığı düşüremez.
//  · "Ev sahibi yazdı" SAKLANMAZ: okuma anında öğenin mesajından SONRAKİ ev sahibi mesajından türetilir.
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

const OPEN_STATUSES: ItemStatus[] = ["open", "pending_host"];

export interface PersistedItem {
  id: string;
  conversationId: string;
  messageId: string;
  requestIndex: number;
  kind: ItemKind;
  sensitivity: ItemSensitivity;
  riskType: string | null;
  sources: ItemSource[];
  status: ItemStatus;
  notifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type Row = {
  id: string;
  conversationId: string;
  messageId: string;
  requestIndex: number;
  kind: string;
  sensitivity: string;
  riskType: string | null;
  sources: string;
  status: string;
  notifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SOURCE_SET: ReadonlySet<string> = new Set(ITEM_SOURCES);

/**
 * Satırı kapalı kümelere geri çözer. Tanınmayan değer GÜVENLİ yöne düşer: tür → "other", hassaslık → "sensitive" (ev
 * sahibinde kalsın), durum → "open" (görünür kalsın). Satırları yalnız bu kod yazar; savunma elle düzenlemeye karşı.
 */
export function toPersisted(r: Row): PersistedItem {
  return {
    id: r.id,
    conversationId: r.conversationId,
    messageId: r.messageId,
    requestIndex: r.requestIndex,
    kind: isItemKind(r.kind) ? r.kind : "other",
    sensitivity: isItemSensitivity(r.sensitivity) ? r.sensitivity : "sensitive",
    riskType: r.riskType,
    sources: r.sources.split(",").filter((s): s is ItemSource => SOURCE_SET.has(s)),
    status: isItemStatus(r.status) ? r.status : "open",
    notifiedAt: r.notifiedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const TERMINAL: ReadonlySet<ItemStatus> = new Set(["answered", "withdrawn", "superseded", "done"]);

/**
 * Bu turun öğelerini yazar: yeni (mesaj, tür) oluşturulur (`open`), var olan BİRLEŞİR (hassaslık yalnız yükselir, ilk
 * gerekçe kalır, kaynaklar birleşir). Durum DEĞİŞMEZ. İdempotent. Dönüş: turun mesajlarının güncel satırları.
 */
export async function upsertTurnItems(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    messages: readonly { messageId: string; items: readonly BuiltItem[] }[];
    now: Date;
  },
): Promise<PersistedItem[]> {
  const data = input.messages.flatMap((m) =>
    m.items.map((it) => ({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: m.messageId,
      requestIndex: it.requestIndex,
      kind: it.kind,
      sensitivity: it.sensitivity,
      riskType: it.riskType,
      sources: it.sources.join(","),
      status: "open",
      // JS saatiyle kıyaslanan zaman kolonu şema varsayılanına BIRAKILMAZ (CLAUDE.md, ENQUEUE_CLOCK dersi).
      createdAt: input.now,
    })),
  );
  const messageIds = input.messages.map((m) => m.messageId);
  if (data.length === 0) return [];
  await db.conversationItem.createMany({ data, skipDuplicates: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await db.conversationItem.findMany({
      where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId: { in: messageIds } },
    });
    let lost = false;
    for (const m of input.messages) {
      for (const it of m.items) {
        const row = rows.find((r) => r.messageId === m.messageId && r.kind === it.kind);
        if (!row) continue;
        const cur = toPersisted(row);
        const merged = mergeItemFacts(cur, it);
        if (merged.sensitivity === cur.sensitivity && merged.riskType === cur.riskType && merged.sources.join(",") === cur.sources.join(",")) {
          continue;
        }
        const res = await db.conversationItem.updateMany({
          where: { id: row.id, organizationId: input.organizationId, updatedAt: row.updatedAt },
          data: { sensitivity: merged.sensitivity, riskType: merged.riskType, sources: merged.sources.join(",") },
        });
        if (res.count !== 1) lost = true;
      }
    }
    if (!lost) break;
  }
  const out = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId: { in: messageIds } },
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }],
  });
  return out.map(toPersisted);
}

/**
 * Öğelere olay uygular (`core.nextStatus`): değişmeyen satıra yazmaz; durum CAS'ı (eşzamanlı yazıcı kapanmış bir öğeyi
 * geri açamaz). Kapanışta `resolvedAt`. Dönüş: durumu değişen öğe sayısı.
 */
export async function applyItemEvent(
  db: Db,
  input: { organizationId: string; ids: readonly string[]; event: ItemEvent; now: Date; answeredByMessageId?: string | null },
): Promise<number> {
  if (input.ids.length === 0) return 0;
  const rows = await db.conversationItem.findMany({ where: { organizationId: input.organizationId, id: { in: [...input.ids] } } });
  let changed = 0;
  for (const row of rows) {
    const cur = toPersisted(row);
    const next = nextStatus(cur.status, cur.sensitivity, input.event);
    if (next === cur.status) continue;
    const res = await db.conversationItem.updateMany({
      where: { id: row.id, organizationId: input.organizationId, status: row.status },
      data: {
        status: next,
        ...(TERMINAL.has(next) ? { resolvedAt: input.now } : {}),
        ...(next === "answered" && input.answeredByMessageId ? { answeredByMessageId: input.answeredByMessageId } : {}),
      },
    });
    changed += res.count;
  }
  return changed;
}

/**
 * Misafirin vazgeçmeleri (anlama katmanı, `extract.ts`): bu turun mesajındaki öğe ya da ÖNCEKİ turların aynı türden açık
 * öğeleri. Acil öğe `core.nextStatus` gereği kapanmaz.
 */
export async function applyWithdrawals(
  db: Db,
  input: { organizationId: string; conversationId: string; withdrawals: readonly TurnWithdrawal[]; turnMessageIds: readonly string[]; now: Date },
): Promise<number> {
  const ids: string[] = [];
  for (const w of input.withdrawals) {
    const rows = await db.conversationItem.findMany({
      where: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: w.kind,
        status: { in: OPEN_STATUSES },
        ...("messageId" in w ? { messageId: w.messageId } : { messageId: { notIn: [...input.turnMessageIds] } }),
      },
      select: { id: true },
    });
    ids.push(...rows.map((r) => r.id));
  }
  return applyItemEvent(db, { organizationId: input.organizationId, ids: [...new Set(ids)], event: "withdrawn", now: input.now });
}

/**
 * Yeni öğe aynı türden ESKİ açık öğenin yerini alır (`core.maySupersede`: eski acil değil, yeni en az onun kadar hassas).
 * Eski öğe için ev sahibine e-posta gittiyse yenisi onu DEVRALIR (aynı istek için ikinci e-posta yok). `turnMessageOrder`:
 * bu turun mesajları kronolojik; turdaki daha erken mesajın öğesi de "eski"dir.
 */
export async function supersedeOlderItems(
  db: Db,
  input: { organizationId: string; conversationId: string; turnItems: readonly PersistedItem[]; turnMessageOrder: readonly string[]; now: Date },
): Promise<number> {
  let superseded = 0;
  const order = (messageId: string) => input.turnMessageOrder.indexOf(messageId);
  for (const newer of input.turnItems) {
    if (!OPEN_STATUSES.includes(newer.status)) continue;
    const candidates = await db.conversationItem.findMany({
      where: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: newer.kind,
        status: { in: OPEN_STATUSES },
        id: { not: newer.id },
        messageId: { not: newer.messageId },
      },
    });
    for (const row of candidates) {
      const older = toPersisted(row);
      const olderIdx = order(older.messageId);
      // Bu turdaki DAHA SONRAKİ mesajın öğesi "eski" değildir.
      if (olderIdx >= 0 && olderIdx > order(newer.messageId)) continue;
      if (!maySupersede(older, newer)) continue;
      const n = await applyItemEvent(db, { organizationId: input.organizationId, ids: [older.id], event: "superseded", now: input.now });
      if (n === 1 && older.notifiedAt && !newer.notifiedAt) {
        await db.conversationItem.updateMany({
          where: { id: newer.id, organizationId: input.organizationId, notifiedAt: null },
          data: { notifiedAt: older.notifiedAt },
        });
      }
      superseded += n;
    }
  }
  return superseded;
}

/**
 * Ev sahibine acil e-posta için ATOMİK claim (CLAIM-THEN-NOTIFY): yalnız ev sahibinde bekleyen, henüz bildirilmemiş öğe.
 * Dönüş: claim anı (başarısız e-postada `releaseItemNotification` ile geri alınır) ya da null.
 */
export async function claimItemNotification(db: Db, input: { organizationId: string; id: string; now: Date }): Promise<Date | null> {
  const res = await db.conversationItem.updateMany({
    where: { id: input.id, organizationId: input.organizationId, notifiedAt: null, status: "pending_host" },
    data: { notifiedAt: input.now },
  });
  return res.count === 1 ? input.now : null;
}

/** E-posta gidemediyse claim geri alınır (yalnız bu claim'in damgası duruyorsa — başka yazıcıyı ezmez). */
export async function releaseItemNotification(db: Db, input: { organizationId: string; id: string; claimedAt: Date }): Promise<boolean> {
  const res = await db.conversationItem.updateMany({
    where: { id: input.id, organizationId: input.organizationId, notifiedAt: input.claimedAt },
    data: { notifiedAt: null },
  });
  return res.count === 1;
}

/** Ev sahibinin YAZDIĞI giden mesaj koşulu (güvenilir yazar; eski satırlar için türetme — `message-author.ts`). */
const HOST_OUTBOUND_WHERE: Prisma.MessageWhereInput = {
  direction: "outbound",
  OR: [
    { authorType: "host" },
    { authorType: null, senderName: { notIn: [...LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER] } },
  ],
};

export type ItemView = PersistedItem & {
  effective: EffectiveItemStatus;
  /** Öğenin mesajının yazıldığı an (mesaj bulunamazsa öğenin kendi zamanı). */
  messageAt: Date;
};

/**
 * Bir konuşmanın öğeleri + görünen durum ("ev sahibi yazdı" türetilir: öğenin mesajından SONRA ev sahibi yazdıysa).
 * Öğenin mesajı bulunamazsa (birleştirmede ayıklanmış kopya) öğenin kendi zamanı esas alınır.
 */
export async function listConversationItems(db: Db, input: { organizationId: string; conversationId: string }): Promise<ItemView[]> {
  const rows = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId },
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }],
  });
  if (rows.length === 0) return [];
  const items = rows.map(toPersisted);
  const [lastHost, messages] = await Promise.all([
    db.message.findFirst({
      where: { conversationId: input.conversationId, conversation: { property: { organizationId: input.organizationId } }, ...HOST_OUTBOUND_WHERE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, direction: true, senderName: true, authorType: true, systemEventType: true },
    }),
    db.message.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.messageId))] }, conversationId: input.conversationId },
      select: { id: true, createdAt: true },
    }),
  ]);
  const hostAt = lastHost && historyAuthorOf(lastHost) === "host" ? lastHost.createdAt : null;
  const messageAt = new Map(messages.map((m) => [m.id, m.createdAt]));
  return items.map((it) => {
    const at = messageAt.get(it.messageId) ?? it.createdAt;
    return { ...it, effective: effectiveStatus(it.status, hostAt !== null && at < hostAt), messageAt: at };
  });
}

type OpenRow = { conversationId: string; messageId: string; status: string; createdAt: Date };

/**
 * Satırlardan ev sahibinde GERÇEKTEN açık olanlar ("ev sahibi yazdı" düşülür) + mesajın yazıldığı an. Konuşma başına son
 * ev sahibi mesajı tek toplu sorguyla; kiracı kapsamı konuşmanın mülkünden.
 */
async function stillOpenForHost<R extends OpenRow>(db: Db, organizationId: string, rows: readonly R[]): Promise<(R & { messageAt: Date })[]> {
  if (rows.length === 0) return [];
  const convIds = [...new Set(rows.map((r) => r.conversationId))];
  const [hosts, messages] = await Promise.all([
    db.message.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: convIds }, conversation: { property: { organizationId } }, ...HOST_OUTBOUND_WHERE },
      _max: { createdAt: true },
    }),
    db.message.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.messageId))] }, conversationId: { in: convIds } },
      select: { id: true, createdAt: true },
    }),
  ]);
  const hostAt = new Map(hosts.map((h) => [h.conversationId, h._max.createdAt]));
  const messageAt = new Map(messages.map((m) => [m.id, m.createdAt]));
  const out: (R & { messageAt: Date })[] = [];
  for (const r of rows) {
    const status = isItemStatus(r.status) ? r.status : "open";
    const at = messageAt.get(r.messageId) ?? r.createdAt;
    const h = hostAt.get(r.conversationId) ?? null;
    if (isOpenForHost(effectiveStatus(status, h !== null && at < h))) out.push({ ...r, messageAt: at });
  }
  return out;
}

/** Konuşma başına ev sahibinde AÇIK öğe sayısı (liste rozeti; "ev sahibi yazdı" düşülür). */
export async function openItemCounts(db: Db, input: { organizationId: string; conversationIds: readonly string[] }): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (input.conversationIds.length === 0) return out;
  const rows = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: { in: [...input.conversationIds] }, status: { in: OPEN_STATUSES } },
    select: { conversationId: true, messageId: true, status: true, createdAt: true },
  });
  for (const r of await stillOpenForHost(db, input.organizationId, rows)) {
    out.set(r.conversationId, (out.get(r.conversationId) ?? 0) + 1);
  }
  return out;
}

export interface HeldRequestSummary {
  conversationId: string;
  propertyId: string;
  channel: string;
  /** Ev sahibinde bekleyen hassas isteklerin türleri (en eskiden yeniye, tekil). */
  kinds: ItemKind[];
  count: number;
  emergency: boolean;
  /** En eski bekleyen isteğin mesajının yazıldığı an. */
  oldestAt: Date;
}

/**
 * "Dikkat Gerektirenler" için: mülklerde ev sahibine BIRAKILMIŞ (hassas, açık, ev sahibinin henüz yazmadığı) istekler,
 * konuşma başına tek özet. Pencere öğenin kayıt anına göre (hiç unutmayan liste duvar kâğıdına döner).
 */
export async function heldRequestsByConversation(
  db: Db,
  input: { organizationId: string; propertyIds: readonly string[]; since: Date; cap?: number },
): Promise<HeldRequestSummary[]> {
  if (input.propertyIds.length === 0) return [];
  const rows = await db.conversationItem.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: OPEN_STATUSES },
      sensitivity: { in: ["sensitive", "emergency"] },
      createdAt: { gte: input.since },
      conversation: { propertyId: { in: [...input.propertyIds] } },
    },
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }],
    take: input.cap ?? 500,
    select: {
      conversationId: true,
      messageId: true,
      status: true,
      createdAt: true,
      kind: true,
      sensitivity: true,
      conversation: { select: { propertyId: true, channel: true } },
    },
  });
  const byConversation = new Map<string, HeldRequestSummary>();
  for (const r of await stillOpenForHost(db, input.organizationId, rows)) {
    const kind: ItemKind = isItemKind(r.kind) ? r.kind : "other";
    const cur = byConversation.get(r.conversationId);
    if (!cur) {
      byConversation.set(r.conversationId, {
        conversationId: r.conversationId,
        propertyId: r.conversation.propertyId,
        channel: r.conversation.channel,
        kinds: [kind],
        count: 1,
        emergency: r.sensitivity === "emergency",
        oldestAt: r.messageAt,
      });
      continue;
    }
    cur.count++;
    if (!cur.kinds.includes(kind)) cur.kinds.push(kind);
    if (r.sensitivity === "emergency") cur.emergency = true;
    if (r.messageAt < cur.oldestAt) cur.oldestAt = r.messageAt;
  }
  return [...byConversation.values()];
}

/**
 * KVKK (değişmez 14): öğeler misafir mesajından TÜRER → misafir verisiyle aynı saklama süresi; süre dolunca PURGE (satırda
 * PII yok, ama türetildiği veri artık yok). Sinyal emsali (`modules/intelligence/retention.ts`).
 */
export async function purgeExpiredConversationItems(db: Db, cutoff: Date): Promise<{ deleted: number }> {
  const r = await db.conversationItem.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: r.count };
}
