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
