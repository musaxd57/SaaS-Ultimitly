import type { Message, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAnsweringOutbound, isAutomationMessage } from "@/lib/message-author";
import { replyAuthorOf } from "@/lib/ai/closing-turn";
import { HISTORY_MESSAGE_CAP } from "@/lib/ai/limits";
import { UNDERSTANDING_MAX_CONTEXT } from "@/lib/ai/semantic/understanding-schema";
import { MAX_CONTEXT_MESSAGES as GUARD_CONTEXT_MESSAGES } from "@/lib/ai/semantic/guard";
import { CARRY_HISTORY_MESSAGES } from "@/lib/ai/retrieval/select";
import { OPEN_WORK_WINDOW } from "@/lib/conversation-attention";

// ---------------------------------------------------------------------------
// KANAL OTO-YANITI — SINIRLI KONUŞMA OKUMASI (kurucu talimatı 2026-09-07, bağlam sözleşmesi madde 10: "Fetch only the rows needed
// by the context contract … keyset/bounded queries"; kurucu kararı 10-12 "Şimdi yap"; envanter `docs/TASARIM-2026-10-12-madde-10-
// sinirli-okuma.md`).
//
// Konuşma sondan, `(conversationId, createdAt)` indeksiyle SAYFA SAYFA okunur. Okuma, yüklenen son kesit her tüketiciye konuşmanın
// TAMAMIYLA AYNI sonucu verecek kadar ilerler (`threadWindowSufficient`) — misafire giden cevap, kapı, kayıtlar değişmez. Konuşma
// ilk sayfaya sığıyorsa (bugün neredeyse her konuşma) dizi bugünküyle birebir aynıdır. Eşdeğerlik kâhin testiyle sabit:
// `tests/integration/channel-thread-window-oracle.test.ts` (aynı konuşma tam okuma ↔ 1–7 satırlık sayfalarla, bütün çıktılar).
// ---------------------------------------------------------------------------

/** Sayfa boyu. İlk sayfa tüketicilerin en geniş penceresini (açık iş taraması 200 misafir mesajı) karşılayacak kadar. */
export const CHANNEL_THREAD_PAGE = 200;

let pageSizeOverride: number | null = null;
/** Yalnız test: sayfa boyunu küçültüp sayfalamayı her konuşmada zorlar (kâhin testi). */
export function __setChannelThreadPageForTests(size: number | null): void {
  pageSizeOverride = size;
}
function pageSize(): number {
  return pageSizeOverride ?? CHANNEL_THREAD_PAGE;
}

type ThreadRow = Pick<Message, "direction" | "body" | "authorType" | "senderName"> & {
  systemEventType?: string | null;
};

const nonEmpty = (m: { body: string }) => m.body.trim().length > 0;
/** Anlama katmanı ve konaklama bekçisinin bağlam satırı sayısının büyüğü (ikisi de boş gövdeleri atar). */
const CONTEXT_ROWS = Math.max(GUARD_CONTEXT_MESSAGES, UNDERSTANDING_MAX_CONTEXT);

/**
 * SAF: yüklenmiş son kesit (süzülmüş — teslim edilmemiş taslaklar ve sondaki otomatik mesajlar çıkarılmış) konuşmanın tamamıyla
 * AYNI sonucu vermeye yetiyor mu. Her koşul bir tüketicinin baktığı en eski satırı kesitin içine alır:
 *  · istem / kapı penceresi (`selectHistoryForPrompt`): son `HISTORY_MESSAGE_CAP` satır + son cevaplayan giden mesaj;
 *  · cevapsız misafir mesajları, uzun mesaj kuralı, dil sinyali, getirme alt sorguları, öğe turu: son cevaplayan giden mesaj;
 *  · anlama katmanı (`understandingWindow`, boş gövdeler atılır): son DOLU cevaplayan giden mesaja kadar `UNDERSTANDING_MAX_CONTEXT`
 *    dolu satır; konaklama bekçisi: son cevaplayan giden mesaja (boş olabilir — aynı ya da DAHA YENİ satır) kadar
 *    `GUARD_CONTEXT_MESSAGES` dolu satır. Tek koşul: son dolu cevaba kadar ikisinin BÜYÜĞÜ kadar dolu satır — daha yeni bir noktadan
 *    sayılan bekçi penceresi bundan eskiye uzanamaz; son cevaplayan giden mesaj (bekleyen pencereler) da bu satırdan sonradır;
 *  · kapanış (`closableAfter` / `closingMayHide`): son cevap (yapay zekâ / ev sahibi) + ilk cevaptan ÖNCE bir misafir mesajı
 *    (`hasPriorReply`: konuşmada misafirden sonra cevap var mı);
 *  · açık iş (`hasOpenHostWork`): son ev sahibi cevabı ya da ondan sonraki son `OPEN_WORK_WINDOW` misafir mesajı;
 *  · getirme bağlamı (`carryMessages`): son `CARRY_HISTORY_MESSAGES` misafir mesajı.
 * Biri karşılanmıyorsa bir sayfa daha okunur; konuşmanın başına varılınca kesit konuşmanın kendisidir.
 */
export function threadWindowSufficient(m: readonly ThreadRow[]): boolean {
  if (m.length < HISTORY_MESSAGE_CAP) return false;
  // Kesitte son dolu cevap yoksa (-1) sayım 0'dır → yetmez.
  const lastFullAnswer = m.findLastIndex((x) => isAnsweringOutbound(x) && nonEmpty(x));
  if (m.slice(0, lastFullAnswer + 1).filter(nonEmpty).length < CONTEXT_ROWS) return false;
  const firstReply = m.findIndex((x) => replyAuthorOf(x) !== null);
  if (firstReply < 0) return false;
  if (!m.slice(0, firstReply).some((x) => x.direction === "inbound")) return false;
  const inbound = m.filter((x) => x.direction === "inbound").length;
  // Bugün (sabit 2) bir üstteki koşul + "son satır misafir" (çağıran `already_answered` ile garanti eder) bunu zaten sağlar —
  // EŞDEĞER mutant (gerekçeli); sabit büyürse bağlayıcı olur.
  if (inbound < CARRY_HISTORY_MESSAGES) return false;
  if (!m.some((x) => replyAuthorOf(x) === "host") && inbound < OPEN_WORK_WINDOW) return false;
  return true;
}

export interface ThreadWindow {
  /** Okunan satırlar, `(createdAt, id)` ARTAN — konuşmanın sonundan kesintisiz bir kesit. */
  rows: Message[];
  /** Konuşmanın başına varıldı: `rows` konuşmanın TAMAMI. */
  complete: boolean;
}

/** `(createdAt, id)` anahtarı `row`dan küçük satırlar (keyset; eşit damgada kimlik kopma noktası — sıralamayla aynı). */
function keysetBefore(row: Pick<Message, "createdAt" | "id">): Prisma.MessageWhereInput {
  return { OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] };
}

/** `(createdAt, id)` anahtarı `row`dan büyük satırlar. */
export function keysetAfter(row: Pick<Message, "createdAt" | "id">): Prisma.MessageWhereInput {
  return { OR: [{ createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: row.id } }] };
}

async function readPage(conversationId: string, before: Message | null): Promise<{ rows: Message[]; more: boolean }> {
  const size = pageSize();
  const desc = await prisma.message.findMany({
    where: { conversationId, ...(before ? keysetBefore(before) : {}) },
    // (createdAt, id): aynı milisaniyedeki iki mesajda "son mesaj" deterministik ve yeniden değerlendirme taramasıyla
    // (`recheck.ts`, createdAt+id) AYNI — kilit başka mesaja bakmasın (inceleme 09-24).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
  });
  const more = desc.length > size;
  return { rows: desc.slice(0, size).reverse(), more };
}

/** İlk sayfa (konuşmanın sonu). */
export async function readThreadTail(conversationId: string): Promise<ThreadWindow> {
  const page = await readPage(conversationId, null);
  return { rows: page.rows, complete: !page.more };
}

/** Bir sayfa daha (daha eski) — kesitin başına eklenir. */
export async function extendThread(conversationId: string, w: ThreadWindow): Promise<ThreadWindow> {
  if (w.complete || w.rows.length === 0) return { ...w, complete: true };
  const page = await readPage(conversationId, w.rows[0]);
  return { rows: [...page.rows, ...w.rows], complete: !page.more };
}

/**
 * Kesitin DIŞINDA (daha eski) teslim edilmemiş biçimli giden satır var mı (`externalId` yok) — kalıcı outbox süzgecinin konuşma
 * çapındaki tetikleyicisi bugün konuşmanın tamamına bakıyordu.
 */
export async function undeliveredShapedOutboundBefore(conversationId: string, oldest: Message): Promise<boolean> {
  const row = await prisma.message.findFirst({
    where: { conversationId, direction: "outbound", externalId: null, ...keysetBefore(oldest) },
    select: { id: true },
  });
  return row !== null;
}

/** Kesitten ÖNCEKİ (okunmamış) satır sayısı, süzülen satırlar hariç — bağlam tanısının "atlanan" sayısı konuşmanın tamamından. */
export async function countRowsBefore(conversationId: string, oldest: Message, excludedIds: ReadonlySet<string>): Promise<number> {
  return prisma.message.count({
    where: { conversationId, ...keysetBefore(oldest), ...(excludedIds.size > 0 ? { id: { notIn: [...excludedIds] } } : {}) },
  });
}

/** Süzülmüş görünüm: teslim edilmemiş taslaklar çıkar, sondaki otomatik şablon mesajları kesilir (K7). Sıra bugünküyle aynı. */
export function threadView(rows: readonly Message[], undeliveredIds: ReadonlySet<string>): Message[] {
  const kept = undeliveredIds.size > 0 ? rows.filter((m) => !undeliveredIds.has(m.id)) : [...rows];
  let end = kept.length;
  while (end > 0 && isAutomationMessage(kept[end - 1])) end--;
  return end < kept.length ? kept.slice(0, end) : kept;
}
