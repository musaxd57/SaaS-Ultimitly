import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { LEGACY_AI_RESUME_SENDER, LEGACY_AI_SENDER_NAMES, historyAuthorOf } from "@/lib/message-author";
import {
  ITEM_SOURCES,
  URGENT_RISK_TYPES,
  effectiveStatus,
  isItemKind,
  isItemSensitivity,
  isItemStatus,
  isOpenForHost,
  maySupersede,
  mergeItemFacts,
  nextStatus,
  labelCovers,
  topicsCompatible,
  type BuiltItem,
  type EffectiveItemStatus,
  type ItemEvent,
  type ItemKind,
  type ItemSensitivity,
  type ItemSource,
  type ItemStatus,
} from "./core";
import type { TurnWithdrawal } from "./extract";
import { itemOrdinalEnabled } from "./flag";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";

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
  /** Migration 84: aynı mesajda aynı türden kaçıncı istek (yalnız > 0 iken alan var). */
  ordinal?: number;
  /** Kısa konu etiketi (misafir kaynaklı; yalnız varsa alan var). */
  topic?: string;
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
  ordinal?: number;
  topic?: string | null;
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
    ...(r.ordinal ? { ordinal: r.ordinal } : {}),
    ...(r.topic ? { topic: r.topic } : {}),
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
      // Migration 84: sıra kipinde aynı türden ikinci istek ayrı satır; etiket yalnız ilk yazımda (çakışan satıra dokunulmaz).
      ordinal: it.ordinal ?? 0,
      ...(it.topic ? { topic: it.topic } : {}),
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
        const row = rows.find((r) => r.messageId === m.messageId && r.kind === it.kind && r.ordinal === (it.ordinal ?? 0));
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
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }],
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
      // CAS hassaslığı da kapsar: okuma ile yazma arasında eşzamanlı uyarı geçişi öğeyi hassasa yükselttiyse hesaplanan geçiş artık
      // geçersizdir (hassas öğe yapay zekâ cevabıyla kapanmaz) → yazılmaz, öğe açık kalır (Claude kod incelemesi 10-21).
      where: { id: row.id, organizationId: input.organizationId, status: row.status, sensitivity: row.sensitivity },
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
 * Kalıcı kuyrukta cevap misafire HİÇ ulaşmadı (kesin teslim hatası · kanal engeli · gönderim anı vetosuyla iptal — Codex 10-23): o mesajla
 * "cevaplandı" kapanan öğeler ev sahibinde yeniden AÇIK olur (`pending_host`; gönderilmeyen cevapla ihtiyaç kapanmış görünmesin). Yalnız BU
 * mesajın kapattığı ve hâlâ `answered` olan satırlar — arada ev sahibi kapattıysa / başka geçiş değiştirdiyse dokunulmaz (durum koşulu).
 * Belirsiz teslim (`review`: gitmiş olabilir) burada DEĞİL. Dönüş: açılan öğe sayısı.
 */
export async function reopenItemsAnsweredBy(db: Db, input: { organizationId: string; messageId: string }): Promise<number> {
  // Cevap mesajı bağı KORUNUR: aynı mesaj sonradan teslim edilirse (yeniden kuyruğa alma) öğe yeniden kapanır (↓`recloseItemsDeliveredBy`).
  const res = await db.conversationItem.updateMany({
    where: { organizationId: input.organizationId, answeredByMessageId: input.messageId, status: "answered" },
    data: { status: "pending_host", resolvedAt: null },
  });
  return res.count;
}

/**
 * Teslim edilen yapay zekâ cevabı, kendisi düştüğü için ev sahibinde yeniden açılmış öğeleri yeniden kapatır (Haiku 10-23 öğle: kalıcı
 * hatadan sonra yeniden kuyruğa alınıp teslim edilen cevapta öğe açık kalıyor, ev sahibi cevaplanmış ihtiyacı açık iş görüyordu). Yalnız
 * bu mesajın kapattığı ve hâlâ `pending_host` olanlar — ev sahibinin arada kapattığına / başka mesajla cevaplanana dokunulmaz.
 */
export async function recloseItemsDeliveredBy(db: Db, input: { organizationId: string; messageId: string; now: Date }): Promise<number> {
  const res = await db.conversationItem.updateMany({
    where: { organizationId: input.organizationId, answeredByMessageId: input.messageId, status: "pending_host" },
    data: { status: "answered", resolvedAt: input.now },
  });
  return res.count;
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
  const ordinalMode = itemOrdinalEnabled();
  for (const w of input.withdrawals) {
    const rows = await db.conversationItem.findMany({
      where: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        kind: w.kind,
        status: { in: OPEN_STATUSES },
        ...("messageId" in w ? { messageId: w.messageId } : { messageId: { notIn: [...input.turnMessageIds] } }),
      },
      select: { id: true, topic: true },
    });
    // Sıra kipi (migration 84): vazgeçme yalnız (mesaj, tür) taşır. Aynı türden FARKLI konulu iki açık öğe varsa ("Sauna açık mı? Havuz
    // açık mı?" → "Saunayı boşverin") hangisinden vazgeçildiği belli değil → hiçbiri kapanmaz (kurucu B: ilişki belirsizse kapatma yok).
    // Etiketsiz öğe (süzülmüş etiket / anahtar öncesi satır) de "aynı konu" sayılmaz — birden çok aday varken belirsizdir (Opus 10-23).
    if (ordinalMode && rows.length > 1 && (rows.some((r) => !r.topic) || new Set(rows.map((r) => r.topic)).size > 1)) continue;
    ids.push(...rows.map((r) => r.id));
  }
  ids.push(...(await faultGuardCompanions(db, input, ids)));
  return applyItemEvent(db, { organizationId: input.organizationId, ids: [...new Set(ids)], event: "withdrawn", now: input.now });
}

/**
 * Kodun eklediği arıza şikâyeti (`sources` "fault_guard", anahtar `AI_FAULT_GUARD_ENABLED`) anlama katmanının bildiği bir tür değildir —
 * misafir "TV düzeldi" deyince katman `appliance_help`i geri çeker, şikâyeti çekemez (Opus N10, 10-15 gece). Geri çekilen öğenin mesajında
 * başka AÇIK öğe kalmıyorsa o mesajın kod şikâyeti de geri çekilir; kalıyorsa (aynı mesajdaki başka istek hâlâ açık) dokunulmaz — temkinli yön.
 */
async function faultGuardCompanions(
  db: Db,
  input: { organizationId: string; conversationId: string },
  withdrawnIds: readonly string[],
): Promise<string[]> {
  if (withdrawnIds.length === 0) return [];
  const withdrawn = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, id: { in: [...withdrawnIds] } },
    select: { messageId: true },
  });
  const out: string[] = [];
  for (const messageId of new Set(withdrawn.map((w) => w.messageId))) {
    const open = await db.conversationItem.findMany({
      where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId, status: { in: OPEN_STATUSES } },
      select: { id: true, kind: true, sources: true },
    });
    // YALNIZ kodun eklediği şikâyet: başka bir kaynağın (kelime ağı / anlama katmanı) şikâyeti aynı satırda birleştiyse ("lexical,fault_guard")
    // dokunulmaz — o kaynağın kendi şikâyetidir (Opus gece-2 M11; modelin kendi şikâyeti kuralıyla aynı).
    const companion = open.find((o) => o.kind === "complaint_issue" && o.sources.split(",").every((src) => src === "fault_guard"));
    if (!companion) continue;
    if (open.every((o) => o.id === companion.id || withdrawnIds.includes(o.id))) out.push(companion.id);
  }
  return out;
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
  const ordinalMode = itemOrdinalEnabled();
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
      // Sıra kipi: yeni "havuz" isteği eski "sauna" öğesinin yerini almaz. Yer alma bir KAPATMADIR → yalnız iki etiket de var ve ortak
      // sözcük taşıyorsa; etiketi olmayan taraf ilişkiyi belirsiz bırakır (Opus 10-23; kurucu B). Bedeli: etiketsiz takip mesajının yeni
      // hassas öğesi eski öğenin bildirim damgasını devralmaz (o mesaj için ayrı bildirim olabilir).
      // R14: ortak TEK konu sözcüğü yetmez — iki etiket birbirinin bütün sözcüklerini taşımalı ("havuz ısıtmalı" ≠ "havuz açılıyor"; "havuz açık
      // mı" etiketi "havuz" da "havuz ısıtmalı"ya kapanmaz — Haiku 10-23 gece-2); fiil çekimi farkı aynıdır ("havuz açılır" ~ "havuz açılıyor").
      if (ordinalMode && !(older.topic && newer.topic && topicsCompatible(older.topic, newer.topic) && labelCovers(newer.topic, older.topic) && labelCovers(older.topic, newer.topic))) continue;
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

/**
 * Host Karar Motoru kartıyla giden mesajlar (bayrak açıkken). Karar mesajı YALNIZ kendi talebini yanıtlar (bağlı öğe "Tamamlandı"
 * yapılır); aynı turun öteki öğelerini "ev sahibi yazdı" ile kapatmaz — iade isteği, erken giriş onaylandı diye kaybolmasın.
 * Bayrak kapalıyken sorgu YOK (davranış birebir eski).
 */
async function decisionResultMessageIds(db: Db, organizationId: string, conversationIds: readonly string[]): Promise<string[]> {
  if (!hostDecisionsEnabled() || conversationIds.length === 0) return [];
  const rows = await db.decisionRequest.findMany({
    where: { organizationId, conversationId: { in: [...conversationIds] }, resultMessageId: { not: null } },
    select: { resultMessageId: true },
  });
  return rows.map((r) => r.resultMessageId).filter((v): v is string => v !== null);
}

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
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const items = rows.map(toPersisted);
  const decisionMessages = await decisionResultMessageIds(db, input.organizationId, [input.conversationId]);
  const [lastHost, messages] = await Promise.all([
    db.message.findFirst({
      where: {
        conversationId: input.conversationId,
        conversation: { property: { organizationId: input.organizationId } },
        ...HOST_OUTBOUND_WHERE,
        ...(decisionMessages.length > 0 ? { id: { notIn: decisionMessages } } : {}),
      },
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
  const decisionMessages = await decisionResultMessageIds(db, organizationId, convIds);
  const [hosts, messages] = await Promise.all([
    db.message.groupBy({
      by: ["conversationId"],
      where: {
        conversationId: { in: convIds },
        conversation: { property: { organizationId } },
        ...HOST_OUTBOUND_WHERE,
        ...(decisionMessages.length > 0 ? { id: { notIn: decisionMessages } } : {}),
      },
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
export async function openItemCounts(
  db: Db,
  input: {
    organizationId: string;
    conversationIds: readonly string[];
    /** Sayılmayacak öğeler (açık bir karar kartına bağlı — aynı talep "karar bekliyor" rozetinde zaten var). */
    excludeItemIds?: readonly string[];
  },
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (input.conversationIds.length === 0) return out;
  const rows = await db.conversationItem.findMany({
    where: {
      organizationId: input.organizationId,
      conversationId: { in: [...input.conversationIds] },
      status: { in: OPEN_STATUSES },
      ...(input.excludeItemIds && input.excludeItemIds.length > 0 ? { id: { notIn: [...input.excludeItemIds] } } : {}),
    },
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
  /** Ev sahibine ÖNCELİKLİ gösterilen istek var mı (acil ya da erişim kaybı — `URGENT_RISK_TYPES`, kurucu 10-29 gece GD4). */
  urgent: boolean;
  /** En eski bekleyen isteğin mesajının yazıldığı an. */
  oldestAt: Date;
}

/**
 * "Dikkat Gerektirenler" için: mülklerde ev sahibine BIRAKILMIŞ (hassas, açık, ev sahibinin henüz yazmadığı) istekler,
 * konuşma başına tek özet. Pencere öğenin kayıt anına göre (hiç unutmayan liste duvar kâğıdına döner).
 */
export async function heldRequestsByConversation(
  db: Db,
  input: {
    organizationId: string;
    propertyIds: readonly string[];
    since: Date;
    cap?: number;
    /** Sayılmayacak öğeler (açık bir karar kartına bağlı — pano o talebi "karar bekliyor" satırıyla gösterir). */
    excludeItemIds?: readonly string[];
  },
): Promise<HeldRequestSummary[]> {
  if (input.propertyIds.length === 0) return [];
  const rows = await db.conversationItem.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: OPEN_STATUSES },
      sensitivity: { in: ["sensitive", "emergency"] },
      createdAt: { gte: input.since },
      conversation: { propertyId: { in: [...input.propertyIds] } },
      ...(input.excludeItemIds && input.excludeItemIds.length > 0 ? { id: { notIn: [...input.excludeItemIds] } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }],
    take: input.cap ?? 500,
    select: {
      conversationId: true,
      messageId: true,
      status: true,
      createdAt: true,
      kind: true,
      sensitivity: true,
      riskType: true,
      conversation: { select: { propertyId: true, channel: true } },
    },
  });
  const byConversation = new Map<string, HeldRequestSummary>();
  const urgentRow = (r: { sensitivity: string; riskType: string | null }) =>
    r.sensitivity === "emergency" || (r.riskType !== null && URGENT_RISK_TYPES.has(r.riskType));
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
        urgent: urgentRow(r),
        oldestAt: r.messageAt,
      });
      continue;
    }
    cur.count++;
    if (!cur.kinds.includes(kind)) cur.kinds.push(kind);
    if (r.sensitivity === "emergency") cur.emergency = true;
    if (urgentRow(r)) cur.urgent = true;
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
