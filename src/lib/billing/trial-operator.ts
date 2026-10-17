// ---------------------------------------------------------------------------
// OPERATÖR: DENEMEYİ BİTİR / GERİ VER (kurucu Q4, 10-17: "dediğin mantıklı"). Riskli deneme listesinde operatör bir denemeyi elle bitirebilir
// (otomatik kesme YOK — K1 "B"); müşteri ayarlarda sebebi söylemeyen onaylı metni görür (kaçışı öğretmemek için "risk / kötüye kullanım"
// sözcükleri geçmez). Hesap KAPATILMAZ: panel, mesajlar ve elle cevap açık; ödeme yapmak isteyen meşru müşteri plan seçebilir. "Denemeyi geri
// ver" yalnız BU SEBEPLE bitmiş denemeyi geri açar (bugünden yeni deneme süresi).
// Genel "14 günlük denemeniz doldu" e-postası bu durumda YANLIŞ olurdu → bitirmede damgası atılır (gönderilmez); geri verilince silinir.
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { trialEndDate } from "@/lib/billing/subscription";

export const TRIAL_END_REASON_OPERATOR = "operator_ended";

/** Kurucu onaylı müşteri metni (Q4, 10-17) — ayarlar → faturalandırma kartında. */
export const TRIAL_OPERATOR_ENDED_MESSAGE =
  "Ücretsiz denemeniz sona erdi. Devam etmek için bir plan seçin. Bir yanlışlık olduğunu düşünüyorsanız bize yazın.";

export type TrialOperatorResult = { ok: true } | { ok: false; reason: "not_running" | "not_operator_ended" };

/** Süren denemeyi bitirir (yalnız sağlayıcı "trial" ve bitiş anı gelecekte). Koşullu yazım + denetim kaydı aynı işlemde. */
export async function endTrialByOperator(organizationId: string, actorUserId: string, now: Date = new Date()): Promise<TrialOperatorResult> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.subscription.updateMany({
      where: { organizationId, provider: "trial", trialEndsAt: { gt: now } },
      data: { trialEndsAt: now, trialEndReason: TRIAL_END_REASON_OPERATOR, trialEndingSentAt: now, trialEndedSentAt: now },
    });
    if (res.count !== 1) return { ok: false, reason: "not_running" } as const;
    await writeAuditInTx(tx, { organizationId, actorUserId, action: "trial.operator_ended", metadata: {} });
    return { ok: true } as const;
  });
}

/** Yalnız operatörün bitirdiği denemeyi geri verir: bugünden yeni deneme süresi, hatırlatma damgaları silinir (bitince e-posta yine gider). */
export async function restoreOperatorEndedTrial(organizationId: string, actorUserId: string, now: Date = new Date()): Promise<TrialOperatorResult> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.subscription.updateMany({
      where: { organizationId, provider: "trial", trialEndReason: TRIAL_END_REASON_OPERATOR },
      data: { trialEndsAt: trialEndDate(now), trialEndReason: null, trialEndingSentAt: null, trialEndedSentAt: null },
    });
    if (res.count !== 1) return { ok: false, reason: "not_operator_ended" } as const;
    await writeAuditInTx(tx, { organizationId, actorUserId, action: "trial.operator_restored", metadata: {} });
    return { ok: true } as const;
  });
}
