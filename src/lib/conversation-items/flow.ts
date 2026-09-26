import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { emailService } from "@/lib/email";
import { complaintEscalationEmail } from "@/lib/email-templates";
import { detectRiskTypes } from "@/lib/ai/fallback";
import type { MessageUnderstanding, UnderstandingHistoryEntry } from "@/lib/ai/semantic/understanding-schema";
import { buildLexicalItems, hasEmergency, isOpenForHost, labelsHoldWholeTurn, type BuiltItem, type ItemsGateInput } from "./core";
import { extractTurnItems, type ItemsDegradedReason } from "./extract";
import type { ReplyItemsInput } from "./reply-block";
import { composeItemsPlan, hintKey } from "./plan";
import {
  applyItemEvent,
  applyWithdrawals,
  claimItemNotification,
  listConversationItems,
  releaseItemNotification,
  supersedeOlderItems,
  toPersisted,
  upsertTurnItems,
  type PersistedItem,
} from "./store";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — AKIŞ (09-26, kurucu kararları; bayrak `AI_CONVERSATION_ITEMS_ENABLED` + anlama katmanı açık).
// Kanal oto-yanıtı turu buradan planlar: öğeleri yazar (vazgeçme + yerine geçme dahil), acil / enjeksiyon turunu bugünkü
// yola bırakır, hassas öğeleri SESSİZCE ev sahibinde tutar (misafire otomatik "kaydedildi" GİTMEZ), güvenli istekleri cevap
// modeline kimlikli verir. Karar kuralları saf çekirdekte; burası yalnız sıralar ve yazar.
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

export interface ItemsTurnPlan {
  mode: "items";
  /** Bu turun açık öğeleri (vazgeçme / yerine geçme sonrası), mesaj sırasıyla. */
  turnItems: PersistedItem[];
  /** Ev sahibinde tutulan hassas öğeler (bu tur + önceki turlar; ev sahibinin yazdıkları düşülür; acil yok). */
  held: PersistedItem[];
  /** Cevaplanabilir istekler: kimlik (R1…) → öğe. */
  answerable: { ref: string; item: PersistedItem }[];
  replyItems: ReplyItemsInput;
  gateItems: ItemsGateInput;
  /** Bu turun öğelerinin HEPSİ hassas → cevap modeline öğe bloğu verilmez; cevap ev sahibinde kalır. */
  allHeld: boolean;
}

export type ItemsTurn =
  | ItemsTurnPlan
  /** Acil / enjeksiyon: tur bugünkü yoldan (Sorunlu + acil e-posta); öğeler görünürlük için yazıldı. */
  | { mode: "turn_level"; turnItems: PersistedItem[] }
  /**
   * Tur öğeye bölünmedi → bugünkü konuşma düzeyi kapı, HİÇBİR yazma yapılmadı: anlama katmanı yok/düştü/emin değil
   * (`ItemsDegradedReason`), katmanın gördüğü cevapsız mesajlar çağıranın kapıya verdiği kümeyle aynı değil
   * (`message_set_mismatch`) ya da bu turda öğe yok (`no_items`).
   */
  | { mode: "off"; reason: ItemsDegradedReason | "message_set_mismatch" | "no_items" };

const OPEN = new Set(["open", "pending_host"]);

/**
 * Turu planla: anlama sonucu + kelime ağı → öğeler (yazılır), vazgeçme + yerine geçme uygulanır. Emin olunmayan tur
 * öğeye BÖLÜNMEZ (`off` → bugünkü kapı, hiçbir yazma yapılmaz). `expectedMessageIds`: çağıranın kapıya verdiği cevapsız
 * misafir mesajları (kronolojik) — öğeler TAM bu kümeyi kapsamıyorsa tur bölünmez (kapının taramadığı mesaj kalmasın).
 */
export async function planItemsTurn(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    history: readonly UnderstandingHistoryEntry[];
    guestMessage: string;
    understanding: MessageUnderstanding | null | undefined;
    expectedMessageIds: readonly string[];
    now: Date;
  },
): Promise<ItemsTurn> {
  const extracted = extractTurnItems({ history: input.history, guestMessage: input.guestMessage, understanding: input.understanding });
  if (extracted.mode === "degraded") return { mode: "off", reason: extracted.reason };
  const turnMessageIds = extracted.messages.map((m) => m.messageId);
  if (
    turnMessageIds.length !== input.expectedMessageIds.length ||
    turnMessageIds.some((id, i) => id !== input.expectedMessageIds[i])
  ) {
    return { mode: "off", reason: "message_set_mismatch" };
  }
  const base = { organizationId: input.organizationId, conversationId: input.conversationId, now: input.now };
  const persisted = await upsertTurnItems(db, { ...base, messages: extracted.messages });
  await applyWithdrawals(db, { ...base, withdrawals: extracted.withdrawals, turnMessageIds });
  await supersedeOlderItems(db, { ...base, turnItems: persisted, turnMessageOrder: turnMessageIds });

  const built: BuiltItem[] = extracted.messages.flatMap((m) => m.items);
  const turnLabels = extracted.messages.flatMap((m) => m.labels);
  const fresh = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId: { in: turnMessageIds } },
  });
  const turnItems = fresh
    .map(toPersisted)
    .filter((p) => OPEN.has(p.status))
    .sort((a, b) => turnMessageIds.indexOf(a.messageId) - turnMessageIds.indexOf(b.messageId) || a.requestIndex - b.requestIndex);
  if (hasEmergency(built) || labelsHoldWholeTurn(turnLabels)) return { mode: "turn_level", turnItems };
  if (turnItems.length === 0) return { mode: "off", reason: "no_items" };

  // Tutulanlar: ev sahibinde AÇIK görünen hassas öğeler (ev sahibinin öğenin mesajından sonra yazdığı düşülür — o iş
  // ev sahibinin elinde). Bu turun hassas öğeleri henüz "open" olabilir; ikisi birlikte.
  const views = await listConversationItems(db, { organizationId: input.organizationId, conversationId: input.conversationId });
  const held: PersistedItem[] = views.filter((v) => v.sensitivity === "sensitive" && isOpenForHost(v.effective));
  const hints = new Map<string, string>();
  for (const m of extracted.messages) for (const it of m.items) if (it.hint) hints.set(hintKey(m.messageId, it.kind), it.hint);
  return { mode: "items", turnItems, held, ...composeItemsPlan({ turnItems, held, hints }) };
}

/**
 * Turun sonucunu öğelere yazar: bu turun hassas öğeleri ev sahibinde TUTULUR; cevap gittiyse YALNIZ `answeredRefs`
 * (cevabın kapsadığı güvenli istekler) "cevaplandı" — kapsanmayan güvenli istek ev sahibinde açık kalır. Hassas öğe
 * `core.nextStatus` gereği cevapla kapanmaz.
 */
export async function settleItemsTurn(
  db: Db,
  input: {
    organizationId: string;
    turnItems: readonly PersistedItem[];
    answerable: readonly { ref: string; item: PersistedItem }[];
    now: Date;
    answeredRefs: readonly string[] | null;
  },
): Promise<void> {
  const heldIds = input.turnItems.filter((i) => i.sensitivity !== "none").map((i) => i.id);
  await applyItemEvent(db, { organizationId: input.organizationId, ids: heldIds, event: "held", now: input.now });
  if (input.answeredRefs && input.answeredRefs.length > 0) {
    const ids = input.answerable.filter((a) => input.answeredRefs!.includes(a.ref)).map((a) => a.item.id);
    await applyItemEvent(db, { organizationId: input.organizationId, ids, event: "answered", now: input.now });
  }
}

/**
 * Acil / enjeksiyon turu (bugünkü yol bildirir): öğeler tutulur ve e-posta claim'i SESSİZCE alınır — sonraki bir turun
 * öğe bildirimi bu mesaj için ikinci (bayat) bir e-posta göndermesin.
 */
export async function holdTurnLevelItems(
  db: Db,
  input: { organizationId: string; turnItems: readonly PersistedItem[]; now: Date },
): Promise<void> {
  const ids = input.turnItems.map((i) => i.id);
  await applyItemEvent(db, { organizationId: input.organizationId, ids, event: "held", now: input.now });
  for (const id of ids) await claimItemNotification(db, { organizationId: input.organizationId, id, now: input.now });
}

/**
 * Cevap modelinin öğelere atfedilemeyen sinyalleri (`core.unattributedModelItems`) son mesaja yazılır ve ev sahibinde
 * TUTULUR (öğe kipinde "Sorunlu" YOK — kurucu: yalnız acil durdurur). Dönüş: yazılan öğeler.
 */
export async function recordModelItems(
  db: Db,
  input: { organizationId: string; conversationId: string; messageId: string; items: readonly BuiltItem[]; now: Date },
): Promise<PersistedItem[]> {
  if (input.items.length === 0) return [];
  const rows = await upsertTurnItems(db, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    messages: [{ messageId: input.messageId, items: input.items }],
    now: input.now,
  });
  const ids = rows.filter((r) => r.sensitivity !== "none").map((r) => r.id);
  await applyItemEvent(db, { organizationId: input.organizationId, ids, event: "held", now: input.now });
  return rows;
}

/** Bildirim sonucu (mesaj kimlikleri): e-posta gitti · e-posta düştü (claim geri alındı) · ev sahibinde tutulan. */
export interface HeldItemsNotice {
  mailed: string[];
  failed: string[];
  held: string[];
}

/**
 * Ev sahibinde bekleyen, henüz bildirilmemiş hassas öğeler için ACİL e-posta (kurucu: "acil e-posta aynen"): verilen
 * mesajlarla sınırlı, mesaj başına EN FAZLA bir e-posta — mesajın başka bir öğesi için e-posta zaten gittiyse yeni öğenin
 * claim'i sessizce alınır. Gönderilemezse claim geri alınır (sonraki geçiş yeniden dener). Alıcı yoksa claim de yapılmaz.
 */
export async function notifyHeldItems(
  db: Db,
  input: {
    organizationId: string;
    to: string | null;
    orgName: string;
    conversation: { id: string; guestIdentifier: string; channel: string };
    property: { name: string; address: string | null; city: string | null };
    messageIds: readonly string[];
    now: Date;
  },
): Promise<HeldItemsNotice> {
  const notice: HeldItemsNotice = { mailed: [], failed: [], held: [] };
  if (input.messageIds.length === 0) return notice;
  const rows = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversation.id, messageId: { in: [...input.messageIds] } },
    select: { id: true, messageId: true, status: true, sensitivity: true, notifiedAt: true },
  });
  const alreadyNotified = new Set(rows.filter((r) => r.notifiedAt !== null).map((r) => r.messageId));
  const byMessage = new Map<string, string[]>();
  for (const r of rows) {
    if (r.status !== "pending_host" || r.sensitivity === "none") continue;
    if (!notice.held.includes(r.messageId)) notice.held.push(r.messageId);
    if (r.notifiedAt !== null) continue;
    byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r.id]);
  }
  if (!input.to) return notice;
  for (const messageId of input.messageIds) {
    const ids = byMessage.get(messageId);
    if (!ids) continue;
    const claimed: string[] = [];
    for (const id of ids) {
      if (await claimItemNotification(db, { organizationId: input.organizationId, id, now: input.now })) claimed.push(id);
    }
    if (claimed.length === 0 || alreadyNotified.has(messageId)) continue;
    const message = await db.message.findFirst({ where: { id: messageId, conversationId: input.conversation.id }, select: { body: true } });
    const html = complaintEscalationEmail(
      { id: input.conversation.id, guestIdentifier: input.conversation.guestIdentifier, channel: input.conversation.channel, priority: "urgent" },
      message?.body ?? "",
      input.property,
      input.orgName,
    );
    const mail = await emailService.sendReporting(
      input.to,
      `⚠️ Acil misafir mesajı — ${input.conversation.guestIdentifier} (${input.property.name})`,
      html,
    );
    if (!mail.ok) {
      for (const id of claimed) await releaseItemNotification(db, { organizationId: input.organizationId, id, claimedAt: input.now });
      notice.failed.push(messageId);
      continue;
    }
    notice.mailed.push(messageId);
  }
  return notice;
}

/** Senkron uyarı geçişi (model yok): kelime ağının mesaj etiketleri → öğeler (yalnız kelime ağı), tutulur. */
export async function recordLexicalAlertItems(
  db: Db,
  input: { organizationId: string; conversationId: string; messageId: string; body: string; now: Date },
): Promise<PersistedItem[]> {
  const rows = await upsertTurnItems(db, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    messages: [{ messageId: input.messageId, items: buildLexicalItems(detectRiskTypes(input.body)) }],
    now: input.now,
  });
  const ids = rows.filter((r) => r.sensitivity !== "none").map((r) => r.id);
  await applyItemEvent(db, { organizationId: input.organizationId, ids, event: "held", now: input.now });
  return rows;
}
