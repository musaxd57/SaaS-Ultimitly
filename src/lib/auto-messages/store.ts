import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { GUEST_DELIVERABLE_KB_WHERE } from "@/lib/kb-review";
import { AUTO_MESSAGE_KINDS, previewAutoMessage, type AutoMessageIssue, type AutoMessageKind } from "./render";

// ---------------------------------------------------------------------------
// OTOMATİK MESAJ METNİ — OKUMA / İZ (kurucu T4, 10-21). Gönderici, kuyruk işçisi ve önizlemeler metni YALNIZ buradan okur
// (`AutoMessageTemplate`, migration 80). Bilgi tabanı artık otomatik mesaj kaynağı DEĞİLDİR: kalem eklemek / düzenlemek / öğrenilen taslağı
// onaylamak misafire giden karşılama / giriş / çıkış metnini değiştirmez.
// ---------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

export interface LoadedAutoMessage {
  id: string;
  revision: number;
  /** Ham şablon metni (gövde gönderim anında `buildGuestMessageBody` ile kurulur). */
  content: string;
}

/** Dairenin bu türdeki otomatik mesajı; yoksa ya da metin BOŞSA null (gönderilmez — bugün "kalem yok" ile aynı). */
export async function loadAutoMessage(propertyId: string, kind: AutoMessageKind, db: Db = prisma): Promise<LoadedAutoMessage | null> {
  const row = await db.autoMessageTemplate.findUnique({
    where: { propertyId_kind: { propertyId, kind } },
    select: { id: true, revision: true, body: true },
  });
  if (!row || row.body.trim() === "") return null;
  return { id: row.id, revision: row.revision, content: row.body };
}

/**
 * Seçimle gönderim arasında metin DEĞİŞTİ mi (kalıcı kuyruk kapalı yol, talep işlemi içinde): kayıt silinmiş / boşaltılmış ya da sürüm artmışsa
 * false → bu geçişte gönderilmez, sonraki geçiş güncel metinle yeniden seçer (eski metin gitmez).
 */
export async function autoMessageStillAt(db: Db, id: string, revision: number): Promise<boolean> {
  const row = await db.autoMessageTemplate.findUnique({ where: { id }, select: { revision: true, body: true } });
  return row != null && row.revision === revision && row.body.trim() !== "";
}

/** Saatte en çok bir kez yazılır (gönderici her 2 dakikada koşar — yazma çoğalmasın). */
const SKIP_RECORD_EVERY_MS = 60 * 60_000;

/**
 * Metin doldurulamadığı için atlanan gönderimi KARTA yazar (kurucu: "boş veya çözülemeyen değişken taşıyan mesaj gönderilmesin; host uyarı
 * görsün"). En iyi çaba — gönderici akışını asla düşürmez. Ev sahibi metni kaydedince temizlenir.
 */
export async function recordAutoMessageSkip(id: string, reason: Exclude<AutoMessageIssue, "empty">, now: Date = new Date()): Promise<void> {
  await prisma.autoMessageTemplate
    .updateMany({
      where: {
        id,
        OR: [{ lastSkipReason: null }, { lastSkipReason: { not: reason } }, { lastSkippedAt: { lt: new Date(now.getTime() - SKIP_RECORD_EVERY_MS) } }],
      },
      data: { lastSkipReason: reason, lastSkippedAt: now },
    })
    .catch(() => {});
}

export interface AutoMessageView {
  kind: AutoMessageKind;
  body: string;
  /** 0 = henüz kayıt yok (ilk kayıt açar). */
  revision: number;
  needsReview: boolean;
  lastSkipReason: string | null;
  lastSkippedAt: Date | null;
  /** Bilgi tabanındaki aynı konulu kalem bu metinden SONRA değişti (ör. kapı kodu) — otomatik mesaj kendiliğinden değişmez. */
  kbChangedAfter: boolean;
  preview: ReturnType<typeof previewAutoMessage>;
}

/** Mülk sayfası kartı + GET rotası aynı görünümü okur (işletme kapsamı çağıranda doğrulanmış mülk için). */
export async function loadAutoMessagesView(
  organizationId: string,
  property: { id: string; name: string },
  signature: string | undefined,
): Promise<AutoMessageView[]> {
  const rows = await prisma.autoMessageTemplate.findMany({
    where: { propertyId: property.id, organizationId },
    select: { kind: true, body: true, revision: true, needsReview: true, lastSkipReason: true, lastSkippedAt: true, updatedAt: true },
  });
  // Sert inceleme T4 #5: iki kaynak ayrışabilir (kapı kodu bilgi tabanında güncellendi, otomatik mesajda eski) → kart hatırlatır.
  const kbLatest = await prisma.knowledgeBaseItem.groupBy({
    by: ["category"],
    where: { propertyId: property.id, category: { in: [...AUTO_MESSAGE_KINDS] }, ...GUEST_DELIVERABLE_KB_WHERE },
    _max: { updatedAt: true },
  });
  const kbAt = new Map(kbLatest.map((k) => [k.category, k._max.updatedAt]));
  return AUTO_MESSAGE_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    const body = row?.body ?? "";
    const kbUpdatedAt = kbAt.get(kind) ?? null;
    return {
      kind,
      body,
      revision: row?.revision ?? 0,
      needsReview: row?.needsReview ?? false,
      lastSkipReason: row?.lastSkipReason ?? null,
      lastSkippedAt: row?.lastSkippedAt ?? null,
      kbChangedAfter: row != null && kbUpdatedAt != null && kbUpdatedAt > row.updatedAt,
      preview: previewAutoMessage(body, property.name, signature),
    };
  });
}
