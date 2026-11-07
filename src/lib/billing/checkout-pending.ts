import "server-only";

import { prisma } from "@/lib/db";
import { CHECKOUT_PENDING_MS } from "./checkout-pending-shared";

// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" KİLİDİ (kurucu onayı 10-10). Ödeme ekranı başarıyla kapanınca (Paddle `checkout.completed`) istemci kilidi yazdırır;
// kilit varken AYNI işletme için yeni ödeme ekranı açılmaz (`api/billing/consent`). Abonelik webhook'u AKTİF olarak yazılınca kilit kalkar
// (`api/webhooks/paddle`); gelmezse süre dolunca düşer. Neden: "zaten aktif abonelik var" kontrolü yalnız webhook'un yazdığı satıra bakar →
// webhook gelmeden ikinci sekmede ikinci ödeme tamamlanabiliyordu (ikinci abonelik ilkinin yerine geçer, ilki faturalanmaya devam eder).
// Migration YOK: `SystemLock` satırı (ad işletme başına tek). Yarıda bırakılan ödeme kilitlemez (yalnız tamamlanma sinyali yazar).
// ---------------------------------------------------------------------------

export function checkoutPendingLockName(organizationId: string): string {
  return `checkout-pending:${organizationId}`;
}

/** Kilit hâlâ geçerli mi (süresi dolmamış satır). */
export async function checkoutPendingActive(organizationId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.systemLock.findUnique({ where: { name: checkoutPendingLockName(organizationId) }, select: { lockedUntil: true } });
  return row !== null && row.lockedUntil > now;
}

/**
 * Kilidi yaz. AYNI onay kaydı kilidi bir daha UZATAMAZ (Haiku incelemesi: tekrar çağrı her seferinde +10 dk yazıyordu); yeni bir onay
 * (yeni ödeme ekranı) yazabilir — ama kilit geçerliyken yeni onay kaydı zaten verilmez (`api/billing/consent`).
 */
export async function markCheckoutPending(organizationId: string, consentId: string, now: Date = new Date()): Promise<void> {
  const name = checkoutPendingLockName(organizationId);
  const lockedUntil = new Date(now.getTime() + CHECKOUT_PENDING_MS);
  const created = await prisma.systemLock.createMany({ data: [{ name, lockedUntil, holder: consentId }], skipDuplicates: true });
  if (created.count === 1) return;
  // ⚠️ Prisma'nın `not` filtresi NULL'u DIŞLAR (SQL `<>`) → NULL ayrıca yazılır.
  await prisma.systemLock.updateMany({ where: { name, OR: [{ holder: null }, { holder: { not: consentId } }] }, data: { lockedUntil, holder: consentId } });
}

/** Abonelik aktif yazıldı → kilit kalkar. Hata webhook'u düşürmez (kilit zaten süreyle düşer). */
export async function clearCheckoutPending(organizationId: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: checkoutPendingLockName(organizationId) } }).catch(() => {});
}

export type FailureLockOutcome = "cleared" | "no_lock" | "other_checkout" | "paid" | "unknown" | "no_identity";

/**
 * "Ödeme başarısız" olayı (Codex 11-04 P1). Kilit YALNIZ ödeme başarıyla bitince yazılır (istemcide `checkout.completed` ya da sunucuda
 * ödendi görüldü) — Paddle olayları SIRASIZ gelebilir: aynı ödemenin ESKİ başarısız denemesi başarıdan SONRA ulaşırsa kilidi siliyordu, abonelik
 * webhook'u gelmeden ikinci sekme ikinci ödemeyi tamamlayabiliyordu (çift tahsilat). Kurucu kuralı (10-10: "ödeme alınamazsa beklemesin")
 * korunur, ama başarısızlık yalnız KENDİ ödemesinin kilidini ve yalnız o ödeme gerçekten ödenmemişse kaldırır:
 *  · olayın onay kaydı / işlem kimliği yoksa → dokunulmaz (`no_identity`; kilit en çok 10 dk'da kendiliğinden düşer),
 *  · kilit başka bir ödemenin (başka onay kaydı) → dokunulmaz (`other_checkout`),
 *  · Paddle o işlemi ÖDENMİŞ gösteriyorsa → başarı başarısızlığa BASKIN (`paid`),
 *  · Paddle okunamazsa → dokunulmaz (`unknown`; çift tahsilat riski 10 dk beklemekten ağır),
 *  · aksi hâlde kilit kalkar (`cleared`). Silme koşullu: durum okunduktan SONRA yazılmış kilit (aynı onayın taze başarısı) silinmez.
 */
export async function clearCheckoutPendingOnFailure(
  organizationId: string,
  failure: { consentId: string | null; transactionId: string | null },
  readStatus: (transactionId: string) => Promise<string | null>,
  isPaid: (status: string) => boolean,
  now: () => Date = () => new Date(),
): Promise<FailureLockOutcome> {
  if (!failure.consentId || !failure.transactionId) return "no_identity";
  const name = checkoutPendingLockName(organizationId);
  const row = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true } });
  if (!row) return "no_lock";
  if (row.holder !== failure.consentId) return "other_checkout";
  const checkedAt = now();
  const status = await readStatus(failure.transactionId);
  if (status === null) return "unknown";
  if (isPaid(status)) return "paid";
  // Kilit `lockedUntil = yazılış + CHECKOUT_PENDING_MS`: durum okunduktan SONRA yazılan (aynı onayın taze başarısı) kilit bu sınırı aşar → silinmez.
  const deleted = await prisma.systemLock.deleteMany({
    where: { name, holder: failure.consentId, lockedUntil: { lte: new Date(checkedAt.getTime() + CHECKOUT_PENDING_MS) } },
  });
  return deleted.count === 1 ? "cleared" : "no_lock";
}
