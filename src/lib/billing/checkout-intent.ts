import "server-only";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { paddleRequest } from "@/lib/payments/paddle";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// ÖDEME NİYETİ — İŞLETME BAŞINA TEK AÇIK PADDLE İŞLEMİ (Codex 10-21 P1, migration 82; tasarım
// `docs/TASARIM-2026-10-16-faz2-migration-paketleri.md` §3). Anahtar `PADDLE_CHECKOUT_INTENT_ENABLED` (VARSAYILAN KAPALI — ödeme akışı:
// Paddle sandbox denemesi kurucuyla birlikte yapılmadan açılmaz).
//
// Sorun (ölçüldü): iki sekme onay kapısından aynı anda geçince iki ayrı onay + iki ayrı ödeme ekranı açılıyordu; istemci her açılışta yeni
// Paddle işlemi kuruyordu → iki tahsilat mümkündü. Çözüm: ödeme ekranını sunucunun açtığı TEK işlem kimliğiyle aç:
//  · açık niyet varsa (aynı fiyat, süresi dolmamış) AYNI işlem kimliği döner — iki sekme aynı işlemi gösterir, Paddle aynı işlemi iki kez
//    tahsil etmez;
//  · açık niyetin fiyatı farklıysa eski işlem Paddle'da iptal edilir, sonra yenisi açılır; iptal edilemezse (ödeme başlamış olabilir) yeni
//    ekran AÇILMAZ ("açık bir ödemeniz var");
//  · açık niyetin işlemi Paddle'da zaten ödenmişse (webhook henüz gelmedi) yeni ekran açılmaz ("ödemeniz işleniyor");
//  · "açılıyor" durumundaki niyet (başka sekme Paddle'ı bekliyor) kısa süre bekletir.
// Kapalı küme durumlar: opening · open · completed · canceled · expired · failed. `openKey` yalnız opening / open iken = işletme kimliği.
// PADDLE-VARSAYIM (sandbox'ta doğrulanacak): `POST /transactions` "ready" işlem döndürür; ödeme ekranı `Checkout.open({ transactionId })` ile
// açılır; `PATCH /transactions/{id} { status: "canceled" }` ödenmemiş işlemi iptal eder; `GET /transactions/{id}` `status` alanı "paid" /
// "completed" ise ödenmiştir.
// ---------------------------------------------------------------------------

export function checkoutIntentEnabled(): boolean {
  return process.env.PADDLE_CHECKOUT_INTENT_ENABLED === "1";
}

/** Ödeme ekranının geçerliliği (kurucu sorusu 3.8-2 önerisi; webhook onay tazeliği 24 sa sınırının içinde). */
export const CHECKOUT_INTENT_TTL_MS = 3 * 60 * 60_000;
/** "Açılıyor" kiralaması: Paddle çağrısı bu süreden uzun sürdüyse niyet başarısız sayılır (takılı kalmaz). */
export const CHECKOUT_INTENT_OPENING_LEASE_MS = 30_000;
/** Kapanan niyetlerin saklama süresi. */
export const CHECKOUT_INTENT_RETENTION_MS = 90 * 86_400_000;

export const CHECKOUT_INTENT_BUSY_MESSAGE = "Açık bir ödemeniz var. Tamamlanmasını bekleyin ya da birkaç dakika sonra tekrar deneyin.";
export const CHECKOUT_INTENT_OPENING_MESSAGE = "Ödeme ekranı hazırlanıyor. Birkaç saniye sonra tekrar deneyin.";
export const CHECKOUT_INTENT_FAILED_MESSAGE = "Ödeme ekranı açılamadı. Kısa bir süre sonra tekrar deneyin.";

export type IntentResult =
  | { kind: "open"; transactionId: string; reused: boolean }
  | { kind: "busy"; message: string }
  | { kind: "paid" }
  | { kind: "failed"; message: string };

const PAID_STATES = new Set(["paid", "completed", "billed"]);

/** Paddle'da işlemin durumu ("ready" · "paid" · …); okunamazsa null (karar verilmez). */
async function transactionStatus(transactionId: string): Promise<string | null> {
  try {
    const body = (await paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`)) as { data?: { status?: unknown } } | null;
    return typeof body?.data?.status === "string" ? body.data.status : null;
  } catch {
    return null;
  }
}

/** Ödenmemiş işlemi Paddle'da iptal eder; başarılıysa true. */
async function cancelTransaction(transactionId: string): Promise<boolean> {
  try {
    await paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`, { method: "PATCH", body: { status: "canceled" } });
    return true;
  } catch {
    return false;
  }
}

/** Süresi dolmuş açık niyetleri ve takılı "açılıyor" niyetlerini kapatır (yalnız bu işletme). */
async function closeStale(organizationId: string, now: Date): Promise<void> {
  await prisma.checkoutIntent.updateMany({
    where: { organizationId, status: "opening", createdAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_OPENING_LEASE_MS) } },
    data: { status: "failed", openKey: null, closedAt: now },
  });
  const expired = await prisma.checkoutIntent.findMany({
    where: { organizationId, status: "open", expiresAt: { lt: now } },
    select: { id: true, providerRef: true },
  });
  for (const e of expired) {
    // Süresi dolan işlem ödenmişse (webhook gecikti) kapatılmaz — "tamamlandı" sayılır; aksi hâlde iptal denenir, sonuç ne olursa olsun
    // niyet kapanır (iptal edilemeyen ödenmemiş işlemin ödemesi webhook'ta bugünkü yoldan onaya bağlanır).
    const status = e.providerRef ? await transactionStatus(e.providerRef) : null;
    if (status && PAID_STATES.has(status)) {
      await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "completed", openKey: null, closedAt: now } });
      continue;
    }
    if (e.providerRef) await cancelTransaction(e.providerRef);
    await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "expired", openKey: null, closedAt: now } });
  }
}

/**
 * Onay rotası çağırır (onay satırı yazıldıktan sonra). İşletmenin TEK açık niyetini döndürür ya da açar. Paddle çağrısı veritabanı işleminin
 * DIŞINDA; tekillik `openKey` benzersiz diziniyle (iki eşzamanlı istekten biri kazanır, diğeri onu okur).
 */
export async function openOrReuseCheckoutIntent(input: {
  organizationId: string;
  consentId: string;
  planCode: string;
  priceId: string;
  now?: Date;
}): Promise<IntentResult> {
  const now = input.now ?? new Date();
  await closeStale(input.organizationId, now);

  for (let attempt = 0; attempt < 2; attempt++) {
    let created: { id: string } | null = null;
    try {
      created = await prisma.checkoutIntent.create({
        data: {
          organizationId: input.organizationId,
          consentId: input.consentId,
          planCode: input.planCode,
          priceId: input.priceId,
          status: "opening",
          openKey: input.organizationId,
          expiresAt: new Date(now.getTime() + CHECKOUT_INTENT_TTL_MS),
        },
        select: { id: true },
      });
    } catch (err) {
      if (!isUniqueViolation(err, ["openKey"])) throw err;
    }

    if (created) return createTransaction(created.id, input, now);

    // Başka bir açık niyet var.
    const existing = await prisma.checkoutIntent.findUnique({
      where: { openKey: input.organizationId },
      select: { id: true, status: true, priceId: true, providerRef: true },
    });
    if (!existing) continue; // arada kapandı → yeniden dene
    if (existing.status === "opening" || !existing.providerRef) return { kind: "busy", message: CHECKOUT_INTENT_OPENING_MESSAGE };
    const status = await transactionStatus(existing.providerRef);
    if (status && PAID_STATES.has(status)) {
      await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open" }, data: { status: "completed", openKey: null, closedAt: now } });
      return { kind: "paid" };
    }
    if (existing.priceId === input.priceId) return { kind: "open", transactionId: existing.providerRef, reused: true };
    // Farklı paket: eski ödenmemiş işlem iptal edilir, sonra yenisi açılır. İptal edilemezse yeni ekran YOK.
    if (!(await cancelTransaction(existing.providerRef))) return { kind: "busy", message: CHECKOUT_INTENT_BUSY_MESSAGE };
    await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open" }, data: { status: "canceled", openKey: null, closedAt: now } });
  }
  return { kind: "busy", message: CHECKOUT_INTENT_OPENING_MESSAGE };
}

async function createTransaction(
  intentId: string,
  input: { organizationId: string; consentId: string; priceId: string },
  now: Date,
): Promise<IntentResult> {
  let transactionId: string | null = null;
  try {
    const body = (await paddleRequest("/transactions", {
      method: "POST",
      body: {
        items: [{ price_id: input.priceId, quantity: 1 }],
        // İşletme bağı SUNUCUDAN (istemci değiştiremez); webhook bugünkü gibi onay satırından işletmeyi çözer.
        custom_data: { organizationId: input.organizationId, consentId: input.consentId, legalVersion: LEGAL_VERSION },
      },
    })) as { data?: { id?: unknown } } | null;
    transactionId = typeof body?.data?.id === "string" ? body.data.id : null;
  } catch (err) {
    void reportError("checkout-intent-create", err);
  }
  if (!transactionId) {
    // Kesin ret ya da belirsiz (zaman aşımı): kimliği bizde olmayan işlem kimse tarafından açılamaz → niyet kapanır, sonraki deneme yenisini açar.
    await prisma.checkoutIntent.updateMany({ where: { id: intentId }, data: { status: "failed", openKey: null, closedAt: now } });
    return { kind: "failed", message: CHECKOUT_INTENT_FAILED_MESSAGE };
  }
  const updated = await prisma.checkoutIntent.updateMany({
    where: { id: intentId, status: "opening" },
    data: { status: "open", providerRef: transactionId },
  });
  if (updated.count !== 1) {
    // Kiralama arada doldu (çok yavaş Paddle) ve niyet başkası tarafından kapatıldı: bu işlem kullanılmaz, iptal edilir.
    await cancelTransaction(transactionId);
    return { kind: "busy", message: CHECKOUT_INTENT_OPENING_MESSAGE };
  }
  return { kind: "open", transactionId, reused: false };
}

/** Webhook: işlem tamamlandı / ödendi → niyet kapanır (yoksa sessiz — anahtar kapalıyken açılmış ödeme). */
export async function completeCheckoutIntent(transactionId: string, now: Date = new Date()): Promise<void> {
  await prisma.checkoutIntent.updateMany({
    where: { providerRef: transactionId, status: { in: ["open", "opening"] } },
    data: { status: "completed", openKey: null, closedAt: now },
  });
}

/** Saatlik süpürge: süresi dolan açık niyetler (bütün işletmeler) + 90 günden eski kapanmış niyetlerin silinmesi. */
export async function sweepCheckoutIntents(now: Date = new Date()): Promise<{ expired: number; deleted: number }> {
  const orgs = await prisma.checkoutIntent.findMany({
    where: {
      OR: [
        { status: "open", expiresAt: { lt: now } },
        { status: "opening", createdAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_OPENING_LEASE_MS) } },
      ],
    },
    select: { organizationId: true },
    distinct: ["organizationId"],
    take: 200,
  });
  for (const o of orgs) await closeStale(o.organizationId, now);
  const deleted = await prisma.checkoutIntent.deleteMany({
    where: { openKey: null, closedAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_RETENTION_MS) } },
  });
  return { expired: orgs.length, deleted: deleted.count };
}
