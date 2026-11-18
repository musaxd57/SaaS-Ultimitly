import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { logEvent } from "@/lib/event-log";
import { getSubscriptionStatus } from "@/lib/payments/paddle";
import { PADDLE_TXN_NOT_FOUND, readPaddleTransaction } from "@/lib/billing/paddle-transaction-status";

// ---------------------------------------------------------------------------
// "ÖDEME ALINDI, ABONELİK BEKLENİYOR" — KALICI DURUM (Codex 11-17, 1. bulgu; tasarım
// `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md`). Şema değişmedi: kayıt `CheckoutIntent` satırıdır (ödeme defteri).
//
// Açık (ölçüldü): "ödeme alındı" bilgisi yalnız 10 dakikalık kilitte (`checkout-pending.ts`) yaşıyordu. Abonelik olayı o sürede hesaba
// bağlanmazsa (gecikme, web kancası arızası, "bağlanamadı / inceleme", işleyici hatası) kilit düşüyor ve aynı işletmeye YENİ ödeme
// işlemi açılabiliyordu. Niyet kapalı kipte (açılış varsayılanı) işlem olayı hiçbir şey yazmıyordu.
//
// Kural: ödemesi SUNUCUCA görülmüş (işlem olayı ya da Paddle okuması) ama aboneliği hesaba bağlanmamış işletmeye yeni ödeme ekranı
// AÇILMAZ — süre sınırı yok. Durum ancak kanıtla kapanır:
//  · bağlandı ("fulfilled"): aynı onay kimliğini taşıyan abonelik olayı yazıldı · işlem olayının abonelik kimliği yereldekiyle aynı ·
//    uzlaştırmada Paddle'daki işlemin abonelik kimliği yereldekiyle aynı (aboneliğin durumu aranmaz: sonradan iptal edilmiş abonelik
//    eski kaydı "bekliyor" bırakıp yeni satın almayı kilitlemesin);
//  · geçersiz ("released"): uzlaştırmada işlemin Paddle'daki aboneliği İPTAL edilmiş (operatör iptal + iade etti) · operatör elle bıraktı.
// Paddle okunamıyor / işlemi bulamıyor → durum DEĞİŞMEZ (ödeme kanıtı elde; belirsizlikte ikinci ödeme açılmaz).
// İstemcinin "tamamlandı" sözü TEK BAŞINA kalıcı kayıt yazmaz (hatalı sinyal müşteriyi kalıcı kilitlemesin) — o yalnız 10 dk kilidi yazar.
// ---------------------------------------------------------------------------

/** Ödeme alındı, abonelik hesaba bağlanmadı. (Ad, Paddle'ın "completed" işlem durumundan; niyet satırının eski "tamamlandı" değeri.) */
export const CHECKOUT_PAID_STATUS = "completed";
/** Ödemenin aboneliği hesaba bağlandı. */
export const CHECKOUT_FULFILLED_STATUS = "fulfilled";
/** Ödeme geçersiz sayıldı (aboneliği Paddle'da iptal edilmiş / operatör bıraktı): yeni ödeme açılabilir. */
export const CHECKOUT_RELEASED_STATUS = "released";

/** Ödenmeden önceki her durum: Paddle "ödendi" derse satır bunlardan hangisinde olursa olsun "ödeme alındı"ya geçer. */
export const CHECKOUT_UNPAID_STATUSES = ["open", "opening", "expired", "canceled", "failed"] as const;

/** Ödeme ekranı işlemi sayılan kökenler (Paddle `origin`): yenileme / plan değişikliği / ek tahsilat işlemleri kayıt AÇMAZ. */
const CHECKOUT_ORIGINS: ReadonlySet<string> = new Set(["web", "api"]);

/** Bu kadar süredir bağlanmayan ödeme operatöre bildirilir (abonelik olayı normalde saniyeler içinde gelir). */
export const PAID_CHECKOUT_ALERT_AFTER_MS = 15 * 60_000;
/** Süpürgenin bir turda baktığı en çok kayıt (sayfalı; aşılırsa kalanlar sonraki turda — sıra kimlikle, kayıt atlanmaz). */
const SWEEP_PAGE = 50;
const SWEEP_MAX_PAGES = 20;
/** Onay rotasında art arda uzlaştırılan en çok kayıt (beklenen: 1). */
const BLOCK_MAX_RECONCILES = 10;

/** Operatör alarm durumunun anahtarı (kayıt başına; bağlanınca / bırakılınca silinir). */
export const paidCheckoutAlertKey = (intentId: string): string => `checkout-paid-unlinked:${intentId}`;

const ROW = { id: true, organizationId: true, consentId: true, providerRef: true, closedAt: true, createdAt: true } as const;
export type PaidCheckoutRow = Prisma.CheckoutIntentGetPayload<{ select: typeof ROW }>;

/** Ödemenin görüldüğü an ("ödeme alındı"ya geçerken kapanış anı olarak yazılır). */
export function paidAtOf(row: { closedAt: Date | null; createdAt: Date }): Date {
  return row.closedAt ?? row.createdAt;
}

/** İşletmenin bekleyen (bağlanmamış) en eski ödemesi — yalnız veritabanı; Paddle'a gitmez. */
export async function paidCheckoutAwaiting(organizationId: string): Promise<PaidCheckoutRow | null> {
  return prisma.checkoutIntent.findFirst({
    where: { organizationId, status: CHECKOUT_PAID_STATUS },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ROW,
  });
}

/** Bekleyen kaydı kapatır (yalnız hâlâ bekliyorsa — koşullu); alarm durumu silinir. Kapandıysa true. */
async function closePaidCheckout(
  row: Pick<PaidCheckoutRow, "id" | "organizationId" | "consentId" | "providerRef">,
  status: typeof CHECKOUT_FULFILLED_STATUS | typeof CHECKOUT_RELEASED_STATUS,
  reason: string,
): Promise<boolean> {
  const done = await prisma.checkoutIntent.updateMany({ where: { id: row.id, status: CHECKOUT_PAID_STATUS }, data: { status } });
  if (done.count !== 1) return false;
  await clearAlertState(paidCheckoutAlertKey(row.id));
  await logEvent(
    status === CHECKOUT_FULFILLED_STATUS ? "billing.checkout.fulfilled" : "billing.checkout.released",
    { reason, consentId: row.consentId, ...(row.providerRef ? { transactionRef: row.providerRef } : {}) },
    { organizationId: row.organizationId },
  );
  return true;
}

/** Bu Paddle aboneliği yerelde hangi işletmeye bağlı (yoksa null). */
async function organizationOfSubscription(subscriptionId: string | null): Promise<string | null> {
  if (!subscriptionId) return null;
  const sub = await prisma.subscription.findFirst({ where: { provider: "paddle", providerRef: subscriptionId }, select: { organizationId: true } });
  return sub?.organizationId ?? null;
}

export type RecordPaidOutcome = "recorded" | "fulfilled" | "exists" | "skipped";

/**
 * SUNUCUNUN gördüğü ödeme deftere yazılır (işlem olayı / doğrulanmış istemci sinyali). Niyet satırı zaten varsa (işlemi sunucu açtı) onu
 * `completeCheckoutIntent` "ödeme alındı"ya çevirir; burada yalnız (a) satırı olmayan ödeme ekranı işlemi için satır açılır, (b) işlemin
 * aboneliği yerelde bağlıysa bekleyen kayıt kapanır.
 *
 * İşletme, işlemin taşıdığı onay kaydının SATIRINDAN gelir (oturumdan yazılmış satır — istemcinin gönderdiği işletme kimliği hiç okunmaz).
 * Onayın yaşı aranmaz: burada verilen karar yalnız "bu işletmeye yeni ödeme ekranı açma"dır, hak tanımlamaz. Aynı işlem iki olayla
 * (ödendi + tamamlandı) ya da eşzamanlı gelirse işlem kimliğinin tekilliği ikinci satırı engeller.
 */
export async function recordPaidCheckout(input: {
  transactionId: string;
  consentId: string | null;
  subscriptionId: string | null;
  origin: string | null;
  paidAt: Date;
}): Promise<RecordPaidOutcome> {
  const existing = await prisma.checkoutIntent.findUnique({ where: { providerRef: input.transactionId }, select: { ...ROW, status: true } });
  const linkedOrg = await organizationOfSubscription(input.subscriptionId);
  if (existing) {
    if (existing.status === CHECKOUT_PAID_STATUS && linkedOrg === existing.organizationId) {
      await closePaidCheckout(existing, CHECKOUT_FULFILLED_STATUS, "transaction_subscription_linked");
      return "fulfilled";
    }
    return "exists";
  }
  if (!input.consentId) return "skipped";
  // Yenileme / plan değişikliği / ek tahsilat: ödeme ekranı işlemi değil. Köken bilinmiyorsa (alan yok) aboneliği zaten bağlı işlem de değil.
  if (input.origin !== null ? !CHECKOUT_ORIGINS.has(input.origin) : linkedOrg !== null) return "skipped";
  const consent = await prisma.checkoutConsent.findUnique({
    where: { id: input.consentId },
    select: { organizationId: true, planCode: true, priceId: true },
  });
  if (!consent) return "skipped";
  const fulfilled = linkedOrg === consent.organizationId;
  try {
    await prisma.checkoutIntent.create({
      data: {
        organizationId: consent.organizationId,
        consentId: input.consentId,
        planCode: consent.planCode,
        priceId: consent.priceId,
        providerRef: input.transactionId,
        status: fulfilled ? CHECKOUT_FULFILLED_STATUS : CHECKOUT_PAID_STATUS,
        openKey: null,
        expiresAt: input.paidAt,
        closedAt: input.paidAt,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err, ["providerRef"])) return "exists"; // aynı işlemin öteki olayı satırı az önce yazdı
    // İşletme / onay bu arada silindi (yabancı anahtar): yazılacak işletme yok.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return "skipped";
    throw err;
  }
  await logEvent(
    fulfilled ? "billing.checkout.fulfilled" : "billing.checkout.paid",
    { reason: fulfilled ? "transaction_subscription_linked" : "transaction_event", consentId: input.consentId, transactionRef: input.transactionId },
    { organizationId: consent.organizationId },
  );
  return fulfilled ? "fulfilled" : "recorded";
}

/**
 * Abonelik olayı hesaba YAZILDI ve bu onay kimliğini taşıyor → o onayın ödemesi bağlanmıştır (durumu ne olursa olsun: bağ, abonelik
 * satırındaki kimliktir). Bekleyen kayıt kapanır; işlem olayı henüz gelmediyse açık niyet de doğrudan kapanır (abonelik varsa ödeme
 * alınmıştır). Hata yutulmaz: çağıran (web kancası) olayı işlenmemiş sayar ve yeniden dener — kaçarsa uzlaştırma yine kapatır.
 */
export async function fulfilPaidCheckouts(organizationId: string, consentId: string, now: Date = new Date()): Promise<number> {
  const rows = await prisma.checkoutIntent.findMany({
    where: { organizationId, consentId, status: { in: [CHECKOUT_PAID_STATUS, "open"] } },
    select: { ...ROW, status: true },
  });
  let closed = 0;
  for (const row of rows) {
    if (row.status === CHECKOUT_PAID_STATUS) {
      if (await closePaidCheckout(row, CHECKOUT_FULFILLED_STATUS, "subscription_applied")) closed++;
      continue;
    }
    const done = await prisma.checkoutIntent.updateMany({
      where: { id: row.id, status: "open" },
      data: { status: CHECKOUT_FULFILLED_STATUS, openKey: null, closedAt: now },
    });
    if (done.count !== 1) continue;
    closed++;
    await logEvent(
      "billing.checkout.fulfilled",
      { reason: "subscription_applied", consentId: row.consentId, ...(row.providerRef ? { transactionRef: row.providerRef } : {}) },
      { organizationId },
    );
  }
  return closed;
}

export interface PaidCheckoutVerdict {
  outcome: "awaiting" | "fulfilled" | "released";
  /** Operatöre gösterilecek kısa teşhis (yalnız Paddle kimlikleri ve durum adları — müşteri verisi yok). */
  paddle: string;
}

/**
 * Bekleyen ödemeyi Paddle'la uzlaştırır (en çok iki okuma: işlem → abonelik). Yalnız KANITLA kapatır; okunamayan / bulunamayan /
 * uyuşmayan her durumda kayıt bekler.
 */
export async function reconcilePaidCheckout(row: PaidCheckoutRow): Promise<PaidCheckoutVerdict> {
  if (!row.providerRef) return { outcome: "awaiting", paddle: "işlem kimliği yok" };
  const txn = await readPaddleTransaction(row.providerRef);
  if (txn === null) return { outcome: "awaiting", paddle: "Paddle okunamadı" };
  if (txn === PADDLE_TXN_NOT_FOUND) return { outcome: "awaiting", paddle: "Paddle bu işlemi bulamıyor" };
  // İşlem başka bir onayın (beklenmez — satır bu işlemden yazıldı): karar verilmez.
  if (txn.consentId !== null && txn.consentId !== row.consentId) return { outcome: "awaiting", paddle: "işlemin onay kaydı uyuşmuyor" };
  if (!txn.subscriptionId) return { outcome: "awaiting", paddle: `işlem durumu ${txn.status ?? "bilinmiyor"}, abonelik kimliği yok` };
  const local = await prisma.subscription.findUnique({ where: { organizationId: row.organizationId }, select: { provider: true, providerRef: true } });
  if (local?.provider === "paddle" && local.providerRef === txn.subscriptionId) {
    await closePaidCheckout(row, CHECKOUT_FULFILLED_STATUS, "reconciled_linked");
    return { outcome: "fulfilled", paddle: `abonelik ${txn.subscriptionId} hesaba bağlı` };
  }
  const sub = await getSubscriptionStatus(txn.subscriptionId);
  if (sub?.status === "canceled") {
    await closePaidCheckout(row, CHECKOUT_RELEASED_STATUS, "subscription_canceled");
    return { outcome: "released", paddle: `abonelik ${txn.subscriptionId} iptal edilmiş` };
  }
  return {
    outcome: "awaiting",
    paddle: `işlem durumu ${txn.status ?? "bilinmiyor"}, abonelik ${txn.subscriptionId} (durum ${sub?.status ?? "okunamadı"})`,
  };
}

/**
 * Onay rotasının sorusu: bu işletmeye yeni ödeme ekranı açılabilir mi. Bekleyen kayıt varsa önce uzlaştırılır (bağlanmış / iptal edilmiş
 * kayıt müşteriyi boşuna engellemesin); hâlâ bekliyorsa ödemenin anı döner. Art arda çok kayıt kapanırsa (beklenmez) belirsizlikte
 * yine engellenir.
 */
export async function paidCheckoutBlock(organizationId: string): Promise<{ paidAt: Date } | null> {
  for (let i = 0; i < BLOCK_MAX_RECONCILES; i++) {
    const row = await paidCheckoutAwaiting(organizationId);
    if (!row) return null;
    if ((await reconcilePaidCheckout(row)).outcome === "awaiting") return { paidAt: paidAtOf(row) };
  }
  const row = await paidCheckoutAwaiting(organizationId);
  return row ? { paidAt: paidAtOf(row) } : null;
}

/**
 * Saatlik süpürge: 15 dakikadır bağlanmayan her ödeme önce uzlaştırılır; hâlâ bekliyorsa operatöre geçiş tabanlı alarm (kayıt başına bir
 * kez + 24 saatte hatırlatma). Bütün kayıtlar kimlik sırasıyla sayfalanır — alarm verilmiş eski kayıtlar yenilerin önünü kesmez.
 */
export async function sweepPaidCheckouts(now: Date = new Date()): Promise<{ checked: number; closed: number; alerted: number }> {
  const result = { checked: 0, closed: 0, alerted: 0 };
  const cutoff = new Date(now.getTime() - PAID_CHECKOUT_ALERT_AFTER_MS);
  let after: string | null = null;
  for (let page = 0; page < SWEEP_MAX_PAGES; page++) {
    const rows: PaidCheckoutRow[] = await prisma.checkoutIntent.findMany({
      where: {
        status: CHECKOUT_PAID_STATUS,
        OR: [{ closedAt: null }, { closedAt: { lte: cutoff } }],
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: SWEEP_PAGE,
      select: ROW,
    });
    for (const row of rows) {
      result.checked++;
      const verdict = await reconcilePaidCheckout(row);
      if (verdict.outcome !== "awaiting") {
        result.closed++;
        continue;
      }
      const minutes = Math.max(1, Math.round((now.getTime() - paidAtOf(row).getTime()) / 60_000));
      const alerted = await alertOnTransition(
        paidCheckoutAlertKey(row.id),
        "paddle-paid-not-linked",
        new Error(
          `İşletme ${row.organizationId}: Paddle işlemi ${row.providerRef ?? "?"} ödendi (${minutes} dk önce) ama abonelik hesaba bağlanmadı — ` +
            `müşteri yeniden ödeme yapamaz (bilerek engelli). Paddle: ${verdict.paddle}. Yapılacak: abonelik olayını Paddle'dan yeniden gönderin; ` +
            `bağlanamıyorsa Paddle'da aboneliği iptal edip ödemeyi iade edin (iptal görülünce engel kendiliğinden kalkar) ya da Operasyon ` +
            `Teşhisi'nden kaydı serbest bırakın.`,
        ),
        { now },
      );
      if (alerted === "alerted") result.alerted++;
    }
    if (rows.length < SWEEP_PAGE) break;
    after = rows[rows.length - 1]!.id;
  }
  return result;
}

/** Operatörün elle serbest bırakması (ödeme iade edildi / başka yoldan çözüldü). Yalnız bekleyen kayıt bırakılır. */
export async function releasePaidCheckoutByOperator(
  intentId: string,
): Promise<{ ok: true; organizationId: string; transactionId: string | null } | { ok: false; reason: "not_found" | "not_awaiting" }> {
  const row = await prisma.checkoutIntent.findUnique({ where: { id: intentId }, select: { ...ROW, status: true } });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== CHECKOUT_PAID_STATUS || !(await closePaidCheckout(row, CHECKOUT_RELEASED_STATUS, "operator"))) {
    return { ok: false, reason: "not_awaiting" };
  }
  return { ok: true, organizationId: row.organizationId, transactionId: row.providerRef };
}

export interface PaidCheckoutAwaitingRow {
  id: string;
  organizationId: string;
  transactionId: string | null;
  paidAt: Date;
}

/** Operasyon Teşhisi: ödemesi alınmış, aboneliği bağlanmamış kayıtlar (en eski önce). Yalnız kimlikler ve zaman. */
export async function paidCheckoutsAwaitingSummary(limit = 20): Promise<{ total: number; rows: PaidCheckoutAwaitingRow[] }> {
  const where = { status: CHECKOUT_PAID_STATUS };
  const [total, rows] = await Promise.all([
    prisma.checkoutIntent.count({ where }),
    prisma.checkoutIntent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, select: ROW }),
  ]);
  return { total, rows: rows.map((r) => ({ id: r.id, organizationId: r.organizationId, transactionId: r.providerRef, paidAt: paidAtOf(r) })) };
}
