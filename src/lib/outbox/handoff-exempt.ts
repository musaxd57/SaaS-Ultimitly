import type { Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// DEVİR KİLİDİ MUAFİYETİ — kuyruğa giriş anındaki karar (Opus O1 hazırlık 1.1 + dilim kontrolü B1/B2, 10-16).
//
// Satır içi yol "insanla görüşmek istiyorum" niyetli yapay zekâ cevabından sonra devir kilidini (`autoReplyHoldUntil`, 12 sa) YALNIZ öğe
// kipine girmeyen geçişte kurar (`automation.ts` `result.intent === "human_request" && !itemsPlan`): öğe kipinde insan talebi ev sahibinde
// sessizce açık kalır, misafirin sonraki güvenli soruları cevap almaya devam eder. Kuyruk yolu (`DURABLE_OUTBOX_ENABLED`) kilidi TESLİMDE kurar
// ve bu kararı bilmiyordu. Kararı teslimde veritabanından yeniden kurmak denendi ve İKİ yönde de yanıldı (Opus B1: bu geçiş öğe kipine girmedi
// ama turdaki eski mesajda önceki geçişin öğesi var → kilit atlanıyordu, tehlikeli yön; B2: teslim edilmemiş eski taslak turu yanlış bölüyordu).
// Bu yüzden karar kuyruğa girişte, kuyruk satırıyla AYNI işlemde bir işaret olarak yazılır (göçsüz: `SystemLock`, depoda `held-items-mail:`
// emsali). İşaret YOKSA kilit kurulur (bugünkü kuyruk davranışı, güvenli yön).
//
// İşaret teslimde SİLİNMEZ: onarıcı (`healDeliveryEffects`, 48 sa pencere) her geçişte kaçmış kilidi yeniden kurar ve aynı kararı okumalıdır.
// Süre (`HANDOFF_EXEMPT_TTL_MS`) dolunca işaret KÖRÜ KÖRÜNE silinmez (Haiku 10-16): satır hâlâ teslim edilebiliyorsa (`blocked` abonelik
// dönünce, `failed` / `review` elle yeniden kuyruğa alınınca `pending`e döner — `state.ts` ALLOWED) süre uzatılır; yalnız satır yoksa,
// iptal edildiyse ya da teslim edileli onarıcı penceresinden uzun süre geçtiyse silinir. Ad yalnız kuyruk satırı kimliğini taşır (kişisel veri yok).
// ---------------------------------------------------------------------------

export const HANDOFF_EXEMPT_PREFIX = "outbox-handoff-exempt:";
/** Onarıcı penceresinin (48 sa) ve olağan teslim gecikmesinin çok üstünde; hacim küçük (yalnız öğe kipindeki insan talebi cevapları). */
export const HANDOFF_EXEMPT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, "systemLock"> | Pick<Prisma.TransactionClient, "systemLock">;
type SweepDb = Pick<PrismaClient, "systemLock" | "messageOutbox">;

/** Teslim edilmiş satırın işareti bu kadar süre daha tutulur (onarıcı penceresi 48 sa + pay). */
export const HANDOFF_EXEMPT_AFTER_SENT_MS = 72 * 60 * 60 * 1000;
/** Bir süpürmede bakılan en çok süresi dolmuş işaret (fırsatçı; kalan sonraki geçişe). */
const SWEEP_BATCH = 500;

export function handoffExemptName(outboxId: string): string {
  return `${HANDOFF_EXEMPT_PREFIX}${outboxId}`;
}

/** Kuyruk satırıyla AYNI işlemde çağrılır (`enqueueOutbound`). */
export async function markHandoffExempt(tx: Db, outboxId: string, now: Date): Promise<void> {
  await tx.systemLock.create({
    data: { name: handoffExemptName(outboxId), holder: "items", lockedUntil: new Date(now.getTime() + HANDOFF_EXEMPT_TTL_MS) },
  });
}

export async function isHandoffExempt(db: Db, outboxId: string): Promise<boolean> {
  const row = await db.systemLock.findUnique({ where: { name: handoffExemptName(outboxId) }, select: { name: true } });
  return row !== null;
}

/**
 * Süresi dolmuş işaretleri süpürür (fırsatçı; onarıcı geçişinde). Satırı hâlâ teslim edilebilecek işaretin süresi uzatılır; yalnız satırı
 * olmayan, iptal edilmiş ya da teslim edileli `HANDOFF_EXEMPT_AFTER_SENT_MS`ten uzun süre geçmiş işaret silinir.
 */
export async function sweepExpiredHandoffExempt(db: SweepDb, now: Date): Promise<void> {
  const expired = await db.systemLock.findMany({
    where: { name: { startsWith: HANDOFF_EXEMPT_PREFIX }, lockedUntil: { lt: now } },
    select: { name: true },
    take: SWEEP_BATCH,
  });
  if (expired.length === 0) return;
  const ids = expired.map((r) => r.name.slice(HANDOFF_EXEMPT_PREFIX.length));
  const rows = await db.messageOutbox.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, sentAt: true } });
  const live = new Set(
    rows
      .filter((r) => {
        if (r.status === "canceled") return false;
        if (r.status === "sent") return r.sentAt !== null && now.getTime() - r.sentAt.getTime() < HANDOFF_EXEMPT_AFTER_SENT_MS;
        return true;
      })
      .map((r) => r.id),
  );
  const dead = ids.filter((id) => !live.has(id));
  if (dead.length > 0) await db.systemLock.deleteMany({ where: { name: { in: dead.map(handoffExemptName) } } });
  if (live.size > 0) {
    await db.systemLock.updateMany({
      where: { name: { in: [...live].map(handoffExemptName) } },
      data: { lockedUntil: new Date(now.getTime() + HANDOFF_EXEMPT_TTL_MS) },
    });
  }
}
