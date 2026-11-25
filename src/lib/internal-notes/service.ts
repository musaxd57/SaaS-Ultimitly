import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { writeAuditInTx } from "@/lib/audit";
import { lockStayForGuestDerivedWrite } from "@/lib/erasure";
import { INTERNAL_NOTE_PAGE_MAX, canDeleteInternalNote, checkInternalNoteBody, internalNoteAuthorName } from "./core";

// ---------------------------------------------------------------------------
// İÇ NOT — TEK YAZICI (dilim D1, tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.1, tablo migration 99).
// `InternalNote` satırını yazan / silen TEK yer burasıdır (rota yalnız oturum + biçim denetler).
//
// İÇ NOT MESAJ DEĞİLDİR: burada `Message` yazılmaz; konuşmanın `lastMessageAt` / `status` / cevap damgaları DEĞİŞMEZ; konuşma öğesi, söz ya
// da görev açılmaz / kapanmaz; yapay zekâ çağrılmaz. Not ekibin kendi kaydıdır (telefon görüşmesi, kapıda söylenen, hatırlatma) — konuşma
// listesindeki sıra ve rozetler de bu yüzden değişmez. Bu dosyaya konuşma / öğe / görev yazan bir satır eklenirse
// `tests/integration/internal-notes.test.ts` "not mesaj değildir" testi kırmızıya döner.
//
// BAĞ SUNUCUDA ÇÖZÜLÜR: istek konuşma VEYA konaklama VEYA daire kimliği verir (öncelik bu sırayla; istemcinin yanında gönderdiği öteki
// kimlikler yok sayılır). Konuşma verildiyse daire ve konaklama KONUŞMADAN, konaklama verildiyse daire KONAKLAMADAN okunur. Her okuma
// işletme kapsamlıdır: başka işletmenin kimliği "bulunamadı"dır (varlık sızdırılmaz).
// ---------------------------------------------------------------------------

/** İsteğin işaret ettiği yer. Birden çok kimlik gelirse öncelik: konuşma → konaklama → daire. */
export interface InternalNoteTarget {
  conversationId?: string | null;
  reservationId?: string | null;
  propertyId?: string | null;
}

/** Sunucuda çözülmüş bağ: notun yazılacağı daire + (varsa) konaklama + (yalnız bağlam) konuşma. */
export interface InternalNoteBinding {
  propertyId: string;
  reservationId: string | null;
  conversationId: string | null;
}

/** İstemciye giden görünüm: istek kimliği ve yazan kişinin kimliği GİTMEZ (CLAUDE.md "API yanıtında gizli / iç alan yok"). */
export interface InternalNoteView {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
  /** Bu oturumdaki kişi bu notu silebilir mi (yazan ya da sahip). */
  canDelete: boolean;
}

export interface InternalNoteViewer {
  userId: string;
  role: string;
  /**
   * Denetim kaydının faili (`auditActor(session)` — bürünmede operatör; kural `tests/unit/audit-actor-scoping.test.ts`). Verilmezse
   * `userId` (oturum öncesi / iç çağrılar). Silme yetkisi ve yazan kişi yine `userId`'den.
   */
  auditActorId?: string;
}

/** Bağı işletme kapsamında çözer; bulunamazsa (yok ya da başka işletmenin) `null`. */
export async function resolveInternalNoteBinding(
  organizationId: string,
  target: InternalNoteTarget,
): Promise<InternalNoteBinding | null> {
  if (target.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: target.conversationId, property: { organizationId } },
      select: { id: true, propertyId: true, reservationId: true },
    });
    if (!conversation) return null;
    return { propertyId: conversation.propertyId, reservationId: conversation.reservationId, conversationId: conversation.id };
  }
  if (target.reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: target.reservationId, property: { organizationId } },
      select: { id: true, propertyId: true },
    });
    if (!reservation) return null;
    return { propertyId: reservation.propertyId, reservationId: reservation.id, conversationId: null };
  }
  if (target.propertyId) {
    const property = await prisma.property.findFirst({ where: { id: target.propertyId, organizationId }, select: { id: true } });
    if (!property) return null;
    return { propertyId: property.id, reservationId: null, conversationId: null };
  }
  return null;
}

/**
 * Bir bağın gösterdiği notlar (süzgeç):
 * - konaklama varsa konaklamanın notları; konuşmadan bakılıyorsa o konuşmadan konaklama bağlanmadan ÖNCE yazılmış notlar da (konuşma sonradan
 *   bir konaklamaya bağlanınca eski not kaybolmasın);
 * - konaklamasız konuşmada yalnız o konuşmadan yazılan daire notları (dairenin öteki notları bu konuşmaya karışmaz);
 * - yalnız daire verildiyse dairenin konaklamasız notları.
 */
function listWhere(organizationId: string, b: InternalNoteBinding): Prisma.InternalNoteWhereInput {
  if (b.reservationId) {
    return b.conversationId
      ? { organizationId, OR: [{ reservationId: b.reservationId }, { conversationId: b.conversationId, reservationId: null }] }
      : { organizationId, reservationId: b.reservationId };
  }
  if (b.conversationId) return { organizationId, conversationId: b.conversationId, reservationId: null };
  return { organizationId, propertyId: b.propertyId, reservationId: null };
}

const VIEW_SELECT = { id: true, body: true, authorName: true, authorUserId: true, createdAt: true } as const;

function toView(row: { id: string; body: string; authorName: string; authorUserId: string | null; createdAt: Date }, viewer: InternalNoteViewer): InternalNoteView {
  return { id: row.id, body: row.body, authorName: row.authorName, createdAt: row.createdAt, canDelete: canDeleteInternalNote(row, viewer) };
}

export type ListInternalNotesResult =
  | { kind: "ok"; notes: InternalNoteView[]; nextCursor: string | null }
  | { kind: "not_found" };

/**
 * Liste: yeniden eskiye (aynı anda yazılanlar kimlikle kesinleşir), sayfa en çok 50. `cursor` önceki sayfanın son notunun kimliğidir;
 * bu bağa ait olmayan / silinmiş imleç boş sayfa verir (↓ imleç denetimi).
 */
export async function listInternalNotes(input: {
  organizationId: string;
  viewer: InternalNoteViewer;
  target: InternalNoteTarget;
  limit?: number;
  cursor?: string | null;
}): Promise<ListInternalNotesResult> {
  const binding = await resolveInternalNoteBinding(input.organizationId, input.target);
  if (!binding) return { kind: "not_found" };
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? INTERNAL_NOTE_PAGE_MAX)), INTERNAL_NOTE_PAGE_MAX);
  const where = listWhere(input.organizationId, binding);
  // Prisma imleci süzgeçten bağımsız çözer (imleç satırının sıralama değerleriyle karşılaştırır): başka bağın / işletmenin notu imleç
  // verilirse o notun zamanından eski KENDİ notlar dönerdi. İmleç bu süzgecin satırı değilse boş sayfa.
  if (input.cursor && (await prisma.internalNote.count({ where: { AND: [where, { id: input.cursor }] } })) === 0) {
    return { kind: "ok", notes: [], nextCursor: null };
  }
  const rows = await prisma.internalNote.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: VIEW_SELECT,
  });
  const page = rows.slice(0, limit);
  return {
    kind: "ok",
    notes: page.map((r) => toView(r, input.viewer)),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export type CreateInternalNoteResult =
  | { kind: "created" | "replayed"; note: InternalNoteView }
  | { kind: "invalid"; reason: "empty" | "too_long" }
  | { kind: "not_found" }
  /** Aynı istek kimliği daha önce BAŞKA bir notla kullanıldı (farklı metin ya da bağ): eski not sessizce dönmez, yeni not da yazılmaz. */
  | { kind: "conflict" };

/** Aynı istek mi: metin (temizlenmiş) + çözülmüş bağın üçü de aynı. */
function sameRequest(
  stored: { body: string; propertyId: string; reservationId: string | null; conversationId: string | null },
  body: string,
  b: InternalNoteBinding,
): boolean {
  return stored.body === body && stored.propertyId === b.propertyId && stored.reservationId === b.reservationId && stored.conversationId === b.conversationId;
}

/**
 * Not yazma işleminin süre sınırı (K22): konaklama satırı kilidi, o konaklamanın silmesini ya da satırı güncelleyen bir senkron işlemini
 * BEKLEYEBİLİR — Prisma'nın 5 sn varsayılanı kısa beklemeyi 500'e çevirirdi (QR yazma işlemiyle aynı sınır).
 */
const NOTE_WRITE_TX = { timeout: 30_000, maxWait: 10_000 } as const;

const REPLAY_SELECT ={ ...VIEW_SELECT, propertyId: true, reservationId: true, conversationId: true } as const;

/**
 * Not ekler. Yazan oturumdaki kişidir; adı o anki `User.name`'den kopyalanır (kişi bulunamazsa — silinmiş — oturumdaki ad).
 * TEKRAR GÜVENLİĞİ: `clientRequestId` (işletme kapsamında tekil, migration 99) verilirse aynı kimliğin ikinci gelişi yeni satır yazmaz —
 * aynı metin + aynı bağsa var olan not döner (`replayed`), değilse `conflict`. Eşzamanlı iki istekte ön okuma ikisinde de boş görünebilir;
 * ikinci yazım tekil dizine çarpar (P2002, YALNIZ bu dizin) ve var olan satır yeniden okunur — sonuç yine tek satır.
 */
export async function createInternalNote(input: {
  organizationId: string;
  viewer: InternalNoteViewer;
  /** Oturumdaki ad — kişi satırı okunamazsa yedek. */
  sessionName: string;
  target: InternalNoteTarget;
  body: string;
  clientRequestId?: string | null;
}): Promise<CreateInternalNoteResult> {
  const checked = checkInternalNoteBody(input.body);
  if (!checked.ok) return { kind: "invalid", reason: checked.reason };
  const body = checked.body;
  const binding = await resolveInternalNoteBinding(input.organizationId, input.target);
  if (!binding) return { kind: "not_found" };
  const requestId = input.clientRequestId ?? null;

  const replay = async (): Promise<CreateInternalNoteResult | null> => {
    if (!requestId) return null;
    const prior = await prisma.internalNote.findUnique({
      where: { organizationId_clientRequestId: { organizationId: input.organizationId, clientRequestId: requestId } },
      select: REPLAY_SELECT,
    });
    if (!prior) return null;
    return sameRequest(prior, body, binding) ? { kind: "replayed", note: toView(prior, input.viewer) } : { kind: "conflict" };
  };

  const early = await replay();
  if (early) return early;
  if (__internalNoteHooks.afterReplayCheck) await __internalNoteHooks.afterReplayCheck();

  // Kişi satırı kimlikle okunur (üyelik modeli M-2: kişinin "ana işletmesi" oturumun işletmesi olmayabilir — oturum üyelikten doğrulandı).
  const author = await prisma.user.findUnique({ where: { id: input.viewer.userId }, select: { id: true, name: true } });
  try {
    const created = await prisma.$transaction(async (tx) => {
      // K22 (Codex 11-25): misafir silmesi konaklamanın notlarını siler ama konaklama satırı (maskeli) kalır — silmeyle yarışan ya da
      // silmeden sonra gelen not, silinmiş konaklamaya misafirin adını / numarasını GERİ yazıyordu. Konaklama satırı bu işlemde kilitlenir
      // ve maske işlem içinde okunur (`erasure.ts` "GEÇ GELEN YAZIM SINIRI"); maskeliyse not yazılmaz → "bulunamadı" (misafirin verisi yok).
      if (binding.reservationId && (await lockStayForGuestDerivedWrite(tx, binding.reservationId))) return null;
      const note = await tx.internalNote.create({
        data: {
          organizationId: input.organizationId,
          propertyId: binding.propertyId,
          reservationId: binding.reservationId,
          conversationId: binding.conversationId,
          authorUserId: author?.id ?? null,
          authorName: internalNoteAuthorName(author?.name ?? input.sessionName),
          body,
          clientRequestId: requestId,
        },
        select: VIEW_SELECT,
      });
      // Denetim kaydı: kim, hangi bağa — METİN YOK (ayar denetim kalıbı: alan adları / kimlikler, değerler değil).
      await writeAuditInTx(tx, {
        organizationId: input.organizationId,
        actorUserId: input.viewer.auditActorId ?? input.viewer.userId, // fail: çağıranın `auditActor(session)`ı (bürünmede operatör)
        action: "internal_note.create",
        metadata: {
          noteId: note.id,
          propertyId: binding.propertyId,
          ...(binding.reservationId ? { reservationId: binding.reservationId } : {}),
          ...(binding.conversationId ? { conversationId: binding.conversationId } : {}),
        },
      });
      return note;
    }, NOTE_WRITE_TX);
    if (!created) return { kind: "not_found" };
    return { kind: "created", note: toView(created, input.viewer) };
  } catch (err) {
    if (requestId && isUniqueViolation(err, ["organizationId", "clientRequestId"])) {
      const again = await replay();
      if (again) return again;
    }
    throw err;
  }
}

export type DeleteInternalNoteResult = { kind: "deleted" } | { kind: "not_found" } | { kind: "forbidden" };

/**
 * Siler: yazan kişi ya da sahip (`canDeleteInternalNote`). Başka işletmenin notu "bulunamadı"; aynı işletmede yetkisiz silme "yasak".
 * Okuma + silme + denetim tek işlemde; iki eşzamanlı silmeden ikincisi "bulunamadı" alır (ikinci denetim satırı yazılmaz).
 */
export async function deleteInternalNote(input: {
  organizationId: string;
  viewer: InternalNoteViewer;
  noteId: string;
}): Promise<DeleteInternalNoteResult> {
  return prisma.$transaction(async (tx) => {
    const note = await tx.internalNote.findFirst({
      where: { id: input.noteId, organizationId: input.organizationId },
      select: { id: true, authorUserId: true, propertyId: true, reservationId: true, conversationId: true },
    });
    if (!note) return { kind: "not_found" } as const;
    if (!canDeleteInternalNote(note, input.viewer)) return { kind: "forbidden" } as const;
    const removed = await tx.internalNote.deleteMany({ where: { id: note.id, organizationId: input.organizationId } });
    if (removed.count === 0) return { kind: "not_found" } as const;
    await writeAuditInTx(tx, {
      organizationId: input.organizationId,
      actorUserId: input.viewer.auditActorId ?? input.viewer.userId, // fail: çağıranın `auditActor(session)`ı (bürünmede operatör)
      action: "internal_note.delete",
      metadata: {
        noteId: note.id,
        propertyId: note.propertyId,
        ...(note.reservationId ? { reservationId: note.reservationId } : {}),
        ...(note.conversationId ? { conversationId: note.conversationId } : {}),
        ...(note.authorUserId !== input.viewer.userId ? { byOwner: true } : {}),
      },
    });
    return { kind: "deleted" } as const;
  });
}

/** Yalnız testler: ön tekrar okumasından SONRA bekleme noktası (eşzamanlı iki isteğin tekil dizine çarpması şansa kalmasın). */
export const __internalNoteHooks: { afterReplayCheck: null | (() => Promise<void>) } = { afterReplayCheck: null };
