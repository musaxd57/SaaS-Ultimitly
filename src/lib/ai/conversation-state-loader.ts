import "server-only";

import { prisma } from "@/lib/db";
import {
  conversationStateBlock,
  buildConversationState,
  conversationStateEnabled,
  replyAuthor,
  STATE_DECISION_WINDOW,
  type ConversationStateSummary,
  type StateMessage,
} from "./conversation-state";
import { LEGACY_AI_RESUME_SENDER, LEGACY_AI_SENDER_NAMES } from "@/lib/message-author";
import { conversationPhaseFacts } from "./conversation-phase";
import { loadConversationPhase } from "@/lib/operator-replies";
import { reportError } from "@/lib/report-error";
import { extendThread, readThreadTail } from "@/lib/channel-thread-window";

// ---------------------------------------------------------------------------
// Konuşma Anlama Durumu v1 dilim B — yükleyici. Bayrak kapalıyken HİÇ sorgu atmaz (istem bayt bayt aynı).
// Karar kayıtları ve yaşam döngüsü damgaları KİRACI kapsamlı okunur (`organizationId`), karar kayıtları yalnız cevap
// yüzeylerinden (kanal `auto_reply` + QR `guest_chat`): `alerts` yüzeyi kelime ağının kararıdır — etiketleri konu adı
// olmaz (↑`conversation-state.ts`). Asla fırlatmaz: okunamazsa durum YOK (cevap akışı durmaz; blok yazılmaz = bugünkü
// davranış).
// ---------------------------------------------------------------------------

const STATE_SURFACES = ["auto_reply", "guest_chat"];

/** Henüz kaydedilmemiş (cevabıyla birlikte yazılacak) misafir mesajının yer tutucu kimliği — karar kaydı sorgusuna girmez. */
const PENDING_GUEST_MESSAGE_ID = "pending-guest-message";

/**
 * İstem bu kayıtlardan "KONUŞMA KAYITLARI" bloğu kurdu mu (pencere dışı konu / sayaç = eski hafıza)? Üretim izi tanısı istemle AYNI
 * koşulu kullansın diye burada — `conversation-state` modülünü yalnız istem / tip / yükleyici / anlama girişi içe aktarır (izolasyon pini).
 */
/** Kanal oto-yanıtının sınırlı okuması bu anahtar açıkken konuşmayı başa kadar okur (toplamlar konuşmanın tamamından — madde 10). */
export { conversationStateEnabled };

/**
 * Kanal oto-yanıtının sınırlı okuması (madde 10): konuşmanın SONUNDAN bir kesit konuşma kayıtlarına yetiyor mu — son
 * `STATE_DECISION_WINDOW` misafir mesajı (karar kayıtları + konu durumu) ve son cevap (cevapsız misafir sayısı, "sonra ev sahibi
 * yazdı mı") kesitte. Toplamlar kesit dışından sayılır (↓`conversationStatePriorTotals`). Anahtar kapalıyken her kesit yeter.
 */
export function conversationStateWindowSufficient(messages: readonly StateMessage[]): boolean {
  if (!conversationStateEnabled()) return true;
  return messages.filter((m) => m.direction === "inbound").length >= STATE_DECISION_WINDOW && messages.some((m) => replyAuthor(m) !== null);
}

/** JS `String.prototype.trim()`'in sildiği karakterlerin TAMAMI (WhiteSpace + LineTerminator; Unicode Zs) — "gövde boş mu" birebir. */
export const BLANK_BODY_RE = "^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$";

/**
 * Kesitten ÖNCEKİ kısmın cevap toplamları — `replyAuthor` kuralının veritabanı karşılığı (giden · sistem olayı değil · gövde boş
 * değil · yazar yapay zekâ / ev sahibi; yazar alanı yoksa görünen ad kuralı `deriveMessageAuthor`). Teslim edilmemiş taslaklar
 * (`excludedIds`) sayılmaz — kesitle aynı süzgeç. Kural eşitliği gerçek PostgreSQL'de özellik testiyle sabit.
 */
export async function conversationStatePriorTotals(input: {
  conversationId: string;
  /** Kesitin en eski satırı (yalnız kimliği kullanılır; satır veritabanında okunur). */
  before: { id: string };
  excludedIds: readonly string[];
}): Promise<{ outbound: number; hostOutbound: number }> {
  const rows = await prisma.$queryRaw<{ outbound: number; hostOutbound: number; found: number; encoding: string }[]>`
    SELECT current_setting('server_encoding') AS "encoding",
           count(*) FILTER (WHERE a IN ('ai', 'host'))::int AS "outbound",
           count(*) FILTER (WHERE a = 'host')::int AS "hostOutbound",
           (SELECT count(*) FROM "Message" s WHERE s."id" = ${input.before.id} AND s."conversationId" = ${input.conversationId})::int AS "found"
    FROM (
      SELECT COALESCE(
               NULLIF("authorType", ''),
               CASE WHEN "senderName" = ${LEGACY_AI_RESUME_SENDER} THEN 'system'
                    WHEN "senderName" = ANY(${[...LEGACY_AI_SENDER_NAMES]}::text[]) THEN 'ai'
                    ELSE 'host' END
             ) AS a
      FROM "Message"
      WHERE "conversationId" = ${input.conversationId}
        AND "direction" = 'outbound'
        AND ("systemEventType" IS NULL OR "systemEventType" = '')
        -- Sınır, kesitin en eski SATIRININ kendisinden okunur (parametre olarak tarih bağlanmaz): ham SQL'e bağlanan tarih oturum
        -- saat dilimine göre kayıyordu — UTC+14'te sayım 2 yerine 56 (Haiku 10-12; conversation-state-prior-totals.test.ts).
        AND ("createdAt", "id") < (SELECT b."createdAt", b."id" FROM "Message" b WHERE b."id" = ${input.before.id})
        AND NOT ("id" = ANY(${[...input.excludedIds]}::text[]))
        AND "body" !~ ${BLANK_BODY_RE}
    ) t`;
  // Sınır satırı yoksa (okumadan sonra silindi) karşılaştırma NULL olur ve sayım SESSİZCE 0 döner — "misafire giden mesaj" küçülürdü
  // (Haiku son tur 10-12). Fırlatılır: çağıran (`loadConversationState`) yakalar, kayıt bloğu yazılmaz (okunamayan durum = blok yok).
  const r = rows[0];
  if (!r || r.found !== 1) throw new Error("conversation-state prior totals: kesit sınırı satırı bulunamadı");
  // Boşluk kalıbı Unicode karakter içerir: UTF8 dışı kodlamada (SQL_ASCII) bayt bazında eşleşir ve U+200B gibi karakterleri "boş"
  // sayar (CI #1420'de ölçüldü). Canlı UTF8; başka kodlamada sayım YAPILMAZ → çağıran kayıt bloğunu yazmaz.
  if (r.encoding !== "UTF8") throw new Error(`conversation-state prior totals: veritabanı kodlaması UTF8 değil (${r.encoding})`);
  return { outbound: r.outbound, hostOutbound: r.hostOutbound };
}

export function conversationRecordsInPrompt(records: Parameters<typeof conversationStateBlock>[0]): boolean {
  return conversationStateBlock(records) !== "";
}

export async function loadConversationState(input: {
  organizationId: string;
  /** Konuşmanın tamamı ya da sonundan kesintisiz pencere, `(createdAt, id)` artan. */
  messages: readonly StateMessage[];
  /** Otomatik bilgilendirme damgaları bu rezervasyondan okunur (yoksa yaşam döngüsü satırı yazılmaz). */
  reservationId?: string | null;
  /** Verilirse YETKİLİ konuşma durumu (aşama, teslim edilen cevap, son cevaptan geçen süre) konuşmanın TAMAMINDAN eklenir. */
  conversationId?: string;
  timeZone?: string;
  /** Zaman bağlamının "şimdi"si: cevaplanan misafir mesajının anı (yeniden işlenen turda işleme anı aralığı şişirmesin — Haiku 10-09). */
  now?: Date;
  /** Henüz kaydedilmemiş, şu an cevaplanan misafir mesajı (QR). */
  pendingGuestText?: string | null;
  /** `messages` konuşmanın sonundan bir kesitse: kesitin en eski satırı + süzülen satırlar → kesit öncesi cevap toplamları sayılır. */
  priorBefore?: { row: { id: string }; excludedIds: readonly string[] };
}): Promise<ConversationStateSummary | undefined> {
  if (!conversationStateEnabled()) return undefined;
  try {
    const guestIds = input.messages
      .filter((m) => m.direction === "inbound" && m.id !== PENDING_GUEST_MESSAGE_ID)
      .slice(-STATE_DECISION_WINDOW)
      .map((m) => m.id);
    const [decisions, lifecycle] = await Promise.all([
      guestIds.length === 0
        ? []
        : prisma.riskEvent.findMany({
            where: { organizationId: input.organizationId, surface: { in: STATE_SURFACES }, triggerId: { in: guestIds } },
            select: { triggerId: true, surface: true, finalDecision: true, reason: true, riskType: true, kbEvidenceJson: true },
          }),
      input.reservationId
        ? prisma.reservation.findFirst({
            where: { id: input.reservationId, property: { organizationId: input.organizationId } },
            select: { welcomeSentAt: true, checkinSentAt: true, checkoutSentAt: true },
          })
        : null,
    ]);
    const priorTotals =
      input.priorBefore && input.conversationId
        ? await conversationStatePriorTotals({
            conversationId: input.conversationId,
            before: input.priorBefore.row,
            excludedIds: input.priorBefore.excludedIds,
          })
        : undefined;
    const summary = buildConversationState({ messages: input.messages, decisions, lifecycle, priorTotals });
    if (input.conversationId && input.timeZone) {
      const phase = await loadConversationPhase(input.conversationId, input.pendingGuestText);
      if (phase) summary.phase = conversationPhaseFacts(phase, input.now ?? new Date(), input.timeZone);
    }
    return summary;
  } catch (err) {
    // Okunamayan durum = blok yok (cevap akışı durmaz) — ama SESSİZ değil (Haiku 10-12: kodlama / sınır hatası görünmeden kayboluyordu).
    void reportError("conversation-state-load", err);
    return undefined;
  }
}

/**
 * QR kayıt okumasının üst sınırı (satır). Eskiden son 200 satır okunuyordu; artık kesit kayıtların koşuluna (son cevap + karar penceresi)
 * kadar genişler — hiç cevap olmayan uzun bir konuşmada (yapay zekâ durdurulmuş, ev sahibi QR'da yazmıyor) bu her turda bütün konuşma
 * demekti (Haiku 10-12). Sınırda koşul sağlanmadıysa blok YAZILMAZ (yanlış sayı yerine sayı yok) ve hata kaydı düşer.
 */
export const QR_STATE_MAX_ROWS = 2_000;

export async function loadConversationStateForConversation(input: {
  organizationId: string;
  conversationId: string;
  reservationId?: string | null;
  /**
   * Cevaplanan misafir mesajı henüz kaydedilmediyse (QR: mesaj cevabıyla birlikte yazılır) sayıma katılır. Kanal ve gelen
   * kutusunda mesaj zaten kayıtlıdır → "son giden mesajdan sonraki misafir mesajı" üç yüzeyde aynı anlamı taşır.
   */
  pendingGuestMessage?: boolean;
  /** Bekleyen mesajın METNİ (aşama / kapanış hükmüne katılır). */
  pendingGuestText?: string | null;
  timeZone?: string;
}): Promise<ConversationStateSummary | undefined> {
  if (!conversationStateEnabled()) return undefined;
  try {
    // Kiracı kapsamı ÖNCE (başka işletmenin konuşması → boş kesit, bugünkü gibi boş özet). Sonra kanalla aynı sınırlı okuyucu:
    // eskiden son 200 satır okunup toplamlar ("misafire giden mesaj", "son cevaptan sonra misafirin yazdığı") YALNIZ o pencereden
    // sayılıyordu (Haiku 10-12) → kesit kayıtların kendi koşuluna kadar genişler, kesit öncesi cevaplar veritabanında sayılır.
    const owned = await prisma.conversation.findFirst({
      where: { id: input.conversationId, property: { organizationId: input.organizationId } },
      select: { id: true },
    });
    // Başka işletmenin konuşması: konuşma kimliği / saat dilimi / rezervasyon AKTARILMAZ — aşama okuyucusu (`loadConversationPhase`)
    // kiracı süzgeci taşımıyor, yabancı konuşmanın aşaması ve son cevap süresi sızardı (Haiku 10-12; bugünkü çağıran kendi konuşmasını verir).
    if (!owned) return await loadConversationState({ organizationId: input.organizationId, messages: [] });
    let thread = await readThreadTail(input.conversationId);
    while (!thread.complete && !conversationStateWindowSufficient(thread.rows)) {
      if (thread.rows.length >= QR_STATE_MAX_ROWS) {
        void reportError(
          "conversation-state-qr-window-cap",
          new Error(`conversationId=${input.conversationId} rows=${thread.rows.length}`),
        );
        return undefined;
      }
      thread = await extendThread(input.conversationId, thread);
    }
    const messages: StateMessage[] = thread.rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      senderName: m.senderName,
      authorType: m.authorType,
      systemEventType: m.systemEventType,
      body: m.body,
    }));
    const priorBefore = thread.complete ? undefined : { row: thread.rows[0], excludedIds: [] as string[] };
    if (input.pendingGuestMessage) {
      messages.push({ id: PENDING_GUEST_MESSAGE_ID, direction: "inbound", senderName: "", body: "" });
    }
    return await loadConversationState({
      organizationId: input.organizationId,
      messages,
      reservationId: input.reservationId,
      conversationId: input.conversationId,
      timeZone: input.timeZone,
      pendingGuestText: input.pendingGuestMessage ? input.pendingGuestText : null,
      ...(priorBefore ? { priorBefore } : {}),
    });
  } catch (err) {
    // Kardeşi gibi: blok yok (cevap akışı durmaz) ama sessiz değil.
    void reportError("conversation-state-load", err);
    return undefined;
  }
}
