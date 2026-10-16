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
// Süresi dolan işaret süpürülür (`HANDOFF_EXEMPT_TTL_MS`); süresi dolduktan sonra teslim edilen satır (ör. günlerce `blocked` kalıp yeniden
// etkinleşen) kilidi kurar — güvenli yön. Ad yalnız kuyruk satırı kimliğini taşır (kişisel veri yok).
// ---------------------------------------------------------------------------

export const HANDOFF_EXEMPT_PREFIX = "outbox-handoff-exempt:";
/** Onarıcı penceresinin (48 sa) ve olağan teslim gecikmesinin çok üstünde; hacim küçük (yalnız öğe kipindeki insan talebi cevapları). */
export const HANDOFF_EXEMPT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, "systemLock"> | Pick<Prisma.TransactionClient, "systemLock">;

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

/** Süresi dolmuş işaretleri siler (fırsatçı; onarıcı geçişinde). */
export async function sweepExpiredHandoffExempt(db: Db, now: Date): Promise<void> {
  await db.systemLock.deleteMany({ where: { name: { startsWith: HANDOFF_EXEMPT_PREFIX }, lockedUntil: { lt: now } } });
}
