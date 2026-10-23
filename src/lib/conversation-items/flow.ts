import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { emailService } from "@/lib/email";
import { REPLY_WAITING_MAIL_PREFIX, replyWaitingSettled } from "@/lib/host-reply-waiting";
import { complaintEscalationEmail } from "@/lib/email-templates";
import { detectRiskTypes } from "@/lib/ai/fallback";
import { contextLabels } from "@/lib/ai/hazard-evidence";
import type { MessageUnderstanding, UnderstandingHistoryEntry } from "@/lib/ai/semantic/understanding-schema";
import { NO_NOTIFY_KINDS, buildLexicalItems, hasEmergency, isOpenForHost, labelsHoldWholeTurn, type BuiltItem, type ItemKind, type ItemsGateInput } from "./core";
import { extractTurnItems, type ItemsDegradedReason } from "./extract";
import { itemOrdinalEnabled } from "./flag";
import type { ReplyItemsInput } from "./reply-block";
import { composeItemsPlan, faultRequestsOf, hintKey, relationFactsOf } from "./plan";
import { kbRecipeTopics } from "./relation";
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
  /**
   * Yalnız BU turun mesajlarındaki tutulan hassas öğeler (K8, kurucu kararı 09-30): cevap modelinin risk sinyali yalnız bunlara
   * atfedilir — önceki turun tutulan öğesi bugünkü mesajdaki YENİ riski açıklamaz, o risk ayrı öğe olur.
   */
  turnHeld: PersistedItem[];
  /** Cevaplanabilir istekler: kimlik (R1…) → öğe. */
  answerable: { ref: string; item: PersistedItem }[];
  replyItems: ReplyItemsInput;
  gateItems: ItemsGateInput;
  /** Bu turun öğelerinin HEPSİ hassas → cevap modeline öğe bloğu verilmez; cevap ev sahibinde kalır. */
  allHeld: boolean;
  /** Cevap parçaları kipinde bu okumanın üretmediği, önceki okumadan kalmış açık güvenli satırlar (`plan.staleOpen`; Soru 10). */
  staleOpen?: PersistedItem[];
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
    /**
     * Cevap modeline giden bilgi tabanı kalemleri (getirmenin seçtiği): arıza çözümü yalnız bunların içinde o konunun TARİFİ varsa
     * sunulur (`relation.kbRecipeTopics`, karar 23 kör doğrulaması). Verilmezse hiçbir arıza çözümü sunulmaz.
     */
    knowledgeBase?: readonly { title: string; content: string }[];
    /**
     * 51 (kurucu onayı 10-02 akşam, `ai/hazard-evidence.ts`): kelime ağının fiziksel tehlike etiketi bağlamla KALDIRILDI (olası / anılış
     * düzeyi + anlama katmanı "acil değil"). O etiket öğe kurmaz ve turu acil yola çevirmez — kapı da aynı hükmü kullanır.
     */
    hazardCleared?: boolean;
    /** Kalkan etiket olası fiziksel tehlikedendi → acil öğe yerine şikâyet öğesi (`contextLabels`). */
    hazardClearedAsIssue?: boolean;
  },
): Promise<ItemsTurn> {
  // Sıra kipi (migration 84): yeniden işlenen mesajın istekleri mevcut satırlarla eşlenir (çoğaltma yok). Anahtar kapalıyken sorgu yok.
  const ordinalMode = itemOrdinalEnabled();
  const existingItems = ordinalMode
    ? await db.conversationItem.findMany({
        where: { organizationId: input.organizationId, conversationId: input.conversationId, messageId: { in: [...input.expectedMessageIds] } },
        select: { messageId: true, kind: true, ordinal: true, topic: true },
      })
    : [];
  // Konu etiketine misafirin adının parçası giremez (anlama katmanı sorguda adı zaten maskeler; bu kodun yedeği).
  const guest = ordinalMode
    ? await db.conversation.findFirst({
        where: { id: input.conversationId, property: { organizationId: input.organizationId } },
        select: { guestIdentifier: true, reservation: { select: { guestName: true, guestGivenName: true } } },
      })
    : null;
  const extracted = extractTurnItems({
    history: input.history,
    guestMessage: input.guestMessage,
    understanding: input.understanding,
    ...(existingItems.length > 0 ? { existingItems } : {}),
    ...(guest ? { guestNames: [guest.guestIdentifier, guest.reservation?.guestName, guest.reservation?.guestGivenName] } : {}),
    ...(input.hazardCleared
      ? {
          labelsOf: (body: string) =>
            contextLabels(detectRiskTypes(body), { lexicalCleared: true, clearedAsIssue: input.hazardClearedAsIssue === true }),
        }
      : {}),
  });
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
  const inTurn = new Set(turnMessageIds);
  const turnHeld = held.filter((h) => inTurn.has(h.messageId));
  const hints = new Map<string, string>();
  for (const m of extracted.messages) for (const it of m.items) if (it.hint) hints.set(hintKey(m.messageId, it.kind, it.ordinal), it.hint);
  // Konu bazlı "bilgim yok" (kurucu 10-22 Soru 1): isteğin bütün sorguları (yalnız anahtar açıkken plan okur).
  const needQueries = new Map<string, readonly string[]>();
  for (const m of extracted.messages) for (const [kind, qs] of Object.entries(m.queries ?? {})) if (qs) needQueries.set(hintKey(m.messageId, kind as ItemKind), qs);
  // İlişki kipi (kurucu kararı 10-01 sabah): anlama katmanı istek başına işaret verdiyse olgular plana gider; yoksa bugünkü liste kuralı.
  const relations = relationFactsOf(extracted.messages);
  const faultRequests = faultRequestsOf(extracted.messages);
  const heldForPlan = held.map((h) => ({ ...h, earlier: !inTurn.has(h.messageId) }));
  return {
    mode: "items",
    turnItems,
    held,
    turnHeld,
    ...composeItemsPlan({
      turnItems,
      held: heldForPlan,
      hints,
      needQueries,
      ...(relations ? { relations, kbRecipeTopics: kbRecipeTopics(input.knowledgeBase ?? []) } : {}),
      ...(faultRequests ? { faultRequests } : {}),
      producedKeys: new Set(extracted.messages.flatMap((m) => m.items.map((it) => hintKey(m.messageId, it.kind, it.ordinal)))),
    }),
  };
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
    /** Cevabı taşıyan giden mesaj: kalıcı kuyrukta teslim düşerse yalnız bu mesajın kapattığı öğeler geri açılır (`reopenItemsAnsweredBy`). */
    answeredByMessageId?: string | null;
  },
): Promise<void> {
  const heldIds = input.turnItems.filter((i) => i.sensitivity !== "none").map((i) => i.id);
  await applyItemEvent(db, { organizationId: input.organizationId, ids: heldIds, event: "held", now: input.now });
  if (input.answeredRefs && input.answeredRefs.length > 0) {
    const ids = input.answerable.filter((a) => input.answeredRefs!.includes(a.ref)).map((a) => a.item.id);
    await applyItemEvent(db, { organizationId: input.organizationId, ids, event: "answered", now: input.now, answeredByMessageId: input.answeredByMessageId ?? null });
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

/**
 * Bildirim sonucu (mesaj kimlikleri): e-posta gitti · e-posta düştü (claim geri alındı) · ev sahibinde tutulan · YALNIZ sessiz türden
 * (`NO_NOTIFY_KINDS`, kaynak / asistan sorusu) tutulan öğesi olan — panelde açık, e-posta YOK (bekleyen cevap e-postası da).
 */
export interface HeldItemsNotice {
  mailed: string[];
  failed: string[];
  held: string[];
  quiet: string[];
  /** Sessiz türden OLMAYAN açık / bekleyen işi olan mesajlar (verilen sırayla) — turun sessizliği bunlara bakar (Opus güvenlik 10-23 F5). */
  loud: string[];
}

/**
 * MESAJ BAŞINA E-POSTA TALEBİ (K9 ikinci tur, Codex 10-01): öğe düzeyindeki claim, aynı mesajın İKİ hassas öğesini (ödeme + şikâyet)
 * eşzamanlı iki çağrının ayrı ayrı sahiplenmesine izin veriyordu → iki e-posta. E-postayı yalnız mesajın talep satırını (benzersiz
 * `SystemLock` adı; `create` yarışını tek kazanan — `host-reply-waiting.ts` ile aynı ilke) alan çağrı atar. Talep e-posta gidemezse
 * geri verilir; süresi dolan talep fırsatçı süpürülür (oto-yanıt bu kadar eski mesajı modellemez).
 */
/** Hassas öğe e-postasının mesaj başına talep öneki ("Karar bekliyor" e-postası bu talep varsa gitmez — mesaj başına tek bildirim). */
export const HELD_MAIL_PREFIX = "held-items-mail:";
const HELD_MAIL_TTL_MS = 45 * 24 * 60 * 60 * 1000;
async function claimMessageMail(db: Db, messageId: string, now: Date): Promise<"claimed" | "taken" | "unavailable"> {
  try {
    await db.systemLock.create({ data: { name: `${HELD_MAIL_PREFIX}${messageId}`, lockedUntil: new Date(now.getTime() + HELD_MAIL_TTL_MS) } });
    return "claimed";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "taken";
    return "unavailable";
  }
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
  const notice: HeldItemsNotice = { mailed: [], failed: [], held: [], quiet: [], loud: [] };
  if (input.messageIds.length === 0) return notice;
  const rows = await db.conversationItem.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversation.id, messageId: { in: [...input.messageIds] } },
    select: { id: true, messageId: true, status: true, sensitivity: true, notifiedAt: true, kind: true },
  });
  const alreadyNotified = new Set(rows.filter((r) => r.notifiedAt !== null).map((r) => r.messageId));
  const byMessage = new Map<string, string[]>();
  // Sessiz türden OLMAYAN açık işi olan mesajlar (Opus 10-23): "Wi-Fi şifresi? Bunu nereden biliyorsun?" — Wi-Fi cevaplanamadıysa
  // açık iştir; kaynak sorusunun sessizliği onun bildirimini de susturmaz.
  const loud = new Set<string>();
  for (const r of rows) {
    // Kurucu 10-23: kaynak / asistan sorusu panelde açık kalır, e-posta istemez.
    if (r.status === "pending_host" && NO_NOTIFY_KINDS.has(r.kind)) {
      if (!notice.quiet.includes(r.messageId)) notice.quiet.push(r.messageId);
      continue;
    }
    if (r.status === "open" || r.status === "pending_host") loud.add(r.messageId);
    if (r.status !== "pending_host" || r.sensitivity === "none") continue;
    if (!notice.held.includes(r.messageId)) notice.held.push(r.messageId);
    if (r.notifiedAt !== null) continue;
    byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r.id]);
  }
  // Yalnız mesajın BÜTÜN açık işleri sessiz türdeyse "sessiz" (bekleyen cevap e-postası da gitmez).
  notice.quiet = notice.quiet.filter((m) => !notice.held.includes(m) && !loud.has(m));
  notice.loud = input.messageIds.filter((m) => loud.has(m));
  if (!input.to) return notice;
  if (byMessage.size > 0) {
    await db.systemLock.deleteMany({ where: { name: { startsWith: HELD_MAIL_PREFIX }, lockedUntil: { lt: input.now } } }).catch(() => {});
  }
  for (const messageId of input.messageIds) {
    const ids = byMessage.get(messageId);
    if (!ids) continue;
    const claimed: string[] = [];
    for (const id of ids) {
      if (await claimItemNotification(db, { organizationId: input.organizationId, id, now: input.now })) claimed.push(id);
    }
    if (claimed.length === 0 || alreadyNotified.has(messageId)) continue;
    // Mesaj düzeyinde TEK kazanan (↑claimMessageMail). Kaybeden çağrı kendi öğe damgalarını geri verir: kazananın e-postası
    // giderse sonraki geçiş onları sessizce damgalar (e-posta yok); gidemezse hepsi yeniden denenir.
    const lock = await claimMessageMail(db, messageId, input.now);
    if (lock !== "claimed") {
      for (const id of claimed) await releaseItemNotification(db, { organizationId: input.organizationId, id, claimedAt: input.now });
      if (lock === "unavailable") notice.failed.push(messageId);
      continue;
    }
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
      await db.systemLock.deleteMany({ where: { name: `${HELD_MAIL_PREFIX}${messageId}` } }).catch(() => {});
      notice.failed.push(messageId);
      continue;
    }
    notice.mailed.push(messageId);
  }
  return notice;
}

/** Sessiz kalan açık ihtiyacın satır başına kalıcı bildirim kaydı öneki (kurucu 10-23 sabah, Soru 10). */
export const OPEN_NEED_MAIL_PREFIX = "open-need-mail:";
/**
 * Kaydın ömrü (Haiku 10-23 sabah): 45 günlük talep süresi dolunca ev sahibi hâlâ yazmamışsa aynı satır yeniden bildirilebiliyordu; kurucu
 * "aynı açık ihtiyaç için daha önce bildirim gittiyse yeniden gitmesin" → bir yıl (satır saklama süresinin ötesi, kayıtta metin yok).
 */
const OPEN_NEED_MAIL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** `mailed` / `deduped` (o mesaja e-posta zaten gitmişti — kayıt kalır) · `none` (bildirilecek açık ihtiyaç yok) · `not_sent` (kayıt geri alındı). */
export type OpenNeedNotice = "mailed" | "deduped" | "none" | "not_sent";

/**
 * SESSİZ KALAN AÇIK İHTİYAÇ (kurucu 10-23 sabah, Soru 10: "amaç 'eski bir kayıt bulduk' diye alarm vermek değil, unutulmuş gerçek bir soruyu
 * görünür yapmak"). Tur tutuldu, misafire hiçbir şey gitmedi ve hiçbir bildirim yolu çalışmadı; turun mesajlarında hâlâ açık bir ihtiyaç
 * satırı var (parça kipinde bu okumanın üretmediği satır):
 *  · Yalnız GERÇEK açık ihtiyaç: satırın GÜNCEL durumu açık (cevaplandı · vazgeçildi — anlama katmanının `withdrawn` okuması · yerine
 *    geçildi · bitti DEĞİL), kaynak / asistan sorusu değil. Ev sahibi bu mesajlardan sonra yazdıysa mesajlar tura girmez.
 *  · ÖNCE kalıcı kayıt: satır başına benzersiz talep satırı (`SystemLock`, `create` yarışını tek kazanan — eşzamanlı ya da yeniden işlenen
 *    geçişte ikinci e-posta yok). Kaydı zaten olan satır e-posta tetiklemez.
 *  · SONRA mevcut yol (`notify` = "Misafir cevabınızı bekliyor", mesaj başına tek e-posta). E-posta gitmezse kayıtlar geri alınır (sonraki
 *    geçiş yeniden dener — e-posta gitmemişti); o mesaja e-posta zaten gittiyse (`deduped`) kayıtlar kalır.
 * Asla fırlatmaz (talep deposu okunamazsa e-posta GİTMEZ — fail-closed, konuşma panelde görünür).
 */
export async function notifyOpenNeeds(
  db: Db,
  input: {
    organizationId: string;
    items: readonly PersistedItem[];
    now: Date;
    notify: (messageId: string) => Promise<"mailed" | "deduped" | "in_flight" | "no_recipient" | "failed" | "unavailable">;
  },
): Promise<OpenNeedNotice> {
  const claimed: string[] = [];
  const release = () => db.systemLock.deleteMany({ where: { name: { in: claimed.map((id) => `${OPEN_NEED_MAIL_PREFIX}${id}`) } } }).catch(() => {});
  try {
    const candidates = input.items.filter((i) => !NO_NOTIFY_KINDS.has(i.kind));
    if (candidates.length === 0) return "none";
    // Güncel durum (plan ile bildirim arasında cevaplanmış / vazgeçilmiş satır bildirilmez).
    const live = await db.conversationItem.findMany({
      where: { organizationId: input.organizationId, id: { in: candidates.map((c) => c.id) }, status: { in: [...OPEN] } },
      select: { id: true },
    });
    const liveIds = new Set(live.map((r) => r.id));
    const open = candidates.filter((c) => liveIds.has(c.id));
    if (open.length === 0) return "none";
    await db.systemLock.deleteMany({ where: { name: { startsWith: OPEN_NEED_MAIL_PREFIX }, lockedUntil: { lt: input.now } } }).catch(() => {});
    const claimedMessages: string[] = [];
    for (const it of open) {
      try {
        await db.systemLock.create({ data: { name: `${OPEN_NEED_MAIL_PREFIX}${it.id}`, lockedUntil: new Date(input.now.getTime() + OPEN_NEED_MAIL_TTL_MS) } });
        claimed.push(it.id);
        claimedMessages.push(it.messageId);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        await release();
        return "not_sent";
      }
    }
    if (claimedMessages.length === 0) return "none";
    // Hedef: kaydı alınan satırların mesajlarından "Misafir cevabınızı bekliyor" e-postası HENÜZ gitmemiş en yenisi (Opus 10-23 sabah F8: hep
    // son mesaj seçilince o mesaja e-posta önceden gittiyse ötekinin ihtiyacı hiç bildirilmiyordu). Hepsine gittiyse bildirim zaten yapılmıştır.
    const mailed = await db.systemLock.findMany({
      where: { name: { in: claimedMessages.map((m) => `${REPLY_WAITING_MAIL_PREFIX}${m}`) } },
      select: { name: true, holder: true, updatedAt: true },
    });
    const mailedSet = new Set(mailed.map((r) => r.name.slice(REPLY_WAITING_MAIL_PREFIX.length)));
    const target = [...claimedMessages].reverse().find((m) => !mailedSet.has(m));
    if (!target) {
      // Codex 10-23 (bildirim yarışı): öteki yolun e-postası UÇUŞTAYSA (talep var, "gönderildi" onayı yok) sonucu belli değil — o e-posta
      // düşerse bu ihtiyaç hiç bildirilmezdi. Kayıtlar geri verilir; sonraki geçiş onaylıyı "bildirildi", silineni yeniden dener.
      if (mailed.some((r) => !replyWaitingSettled(r, input.now))) {
        await release();
        return "not_sent";
      }
      return "deduped";
    }
    const outcome = await input.notify(target);
    if (outcome === "mailed" || outcome === "deduped") return outcome;
    await release();
    return "not_sent";
  } catch {
    await release();
    return "not_sent";
  }
}

/**
 * Bugünkü "Misafir cevabınızı bekliyor" yolu (devir / cevapsız parça) e-postayı gönderdiyse ya da o mesaja zaten gönderilmişse turun açık
 * ihtiyaçları da BİLDİRİLMİŞ sayılır (Opus 10-23 sabah F8): sonraki turda aynı satır bayat açık kalırsa ikinci e-posta gitmez. Kayıt yazılamazsa
 * (zaten var / depo okunamadı) sessizce geçilir — bu kayıt yalnız tekrarı önler.
 */
export async function recordOpenNeedsNotified(db: Db, input: { items: readonly PersistedItem[]; now: Date }): Promise<void> {
  for (const it of input.items) {
    if (NO_NOTIFY_KINDS.has(it.kind) || !OPEN.has(it.status)) continue;
    await db.systemLock
      .create({ data: { name: `${OPEN_NEED_MAIL_PREFIX}${it.id}`, lockedUntil: new Date(input.now.getTime() + OPEN_NEED_MAIL_TTL_MS) } })
      .catch(() => {});
  }
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
