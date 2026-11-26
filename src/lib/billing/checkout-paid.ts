import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { logEvent } from "@/lib/event-log";
import { getSubscriptionStatus } from "@/lib/payments/paddle";
import { PADDLE_TXN_NOT_FOUND, readPaddleTransaction, readTransactionRefund } from "@/lib/billing/paddle-transaction-status";

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
//  · geçersiz ("released"): uzlaştırmada aynı işlemin Paddle'da onaylanmış TAM iadesi var VE aboneliği etkin değil (iptal edilmiş ya da hiç
//    kurulmamış) · operatör kanıtla elle bıraktı. 🚨 İPTAL ≠ İADE (Codex / kurucu 11-19): eskiden abonelik iptali tek başına serbest
//    bırakıyordu — para geri verilmeden ikinci ödeme açılabiliyordu. Bekleyen / kısmi / geri çevrilen iade yetmez.
// Paddle okunamıyor / işlemi bulamıyor → durum DEĞİŞMEZ (ödeme kanıtı elde; belirsizlikte ikinci ödeme açılmaz).
// İstemcinin "tamamlandı" sözü TEK BAŞINA kalıcı kayıt yazmaz (hatalı sinyal müşteriyi kalıcı kilitlemesin) — o yalnız 10 dk kilidi yazar.
// ---------------------------------------------------------------------------

/** Ödeme alındı, abonelik hesaba bağlanmadı. (Ad, Paddle'ın "completed" işlem durumundan; niyet satırının eski "tamamlandı" değeri.) */
export const CHECKOUT_PAID_STATUS = "completed";
/** Ödemenin aboneliği hesaba bağlandı. */
export const CHECKOUT_FULFILLED_STATUS = "fulfilled";
/** Ödeme geçersiz sayıldı (tam iadesi Paddle'da onaylı + abonelik etkin değil / operatör bıraktı): yeni ödeme açılabilir. */
export const CHECKOUT_RELEASED_STATUS = "released";

/**
 * İşlem kimliği taşıyabilen, ödenmemiş her durum: Paddle "ödendi" derse satır bunlardan hangisinde olursa olsun "ödeme alındı"ya geçer
 * (kapanmış olanlar dahil — yerel kapanış Paddle'ın "ödendi"sini geçersiz kılmaz). "failed" listede yok: o satırın işlem kimliği hiç olmadı.
 */
export const CHECKOUT_UNPAID_STATUSES = ["open", "opening", "expired", "canceled"] as const;

/** Ödeme ekranı işlemi sayılan kökenler (Paddle `origin`): yenileme / plan değişikliği / ek tahsilat işlemleri kayıt AÇMAZ. */
const CHECKOUT_ORIGINS: ReadonlySet<string> = new Set(["web", "api"]);

/** Bu kadar süredir bağlanmayan ödeme operatöre bildirilir (abonelik olayı normalde saniyeler içinde gelir). */
export const PAID_CHECKOUT_ALERT_AFTER_MS = 15 * 60_000;
/**
 * Süpürgenin bir turda gezdiği kayıt: sayfa boyu × sayfa sayısı (1.000). Sıra kimlikle; tur sınıra çarparsa kaldığı yer KALICI imleçe
 * yazılır ve sonraki tur ORADAN sürer, listenin sonuna gelince başa sarar (K6, Codex 11-25 ikinci rapor: eskiden her tur baştan
 * başlıyordu — 1.000'den çok kayıt beklerken arkadakiler HİÇ gezilmiyordu). Sınır aşımı alarmı yalnız gezilmemiş kayıt GERÇEKTEN
 * kaldıysa (bir fazla okuma); tam 1.000 kayıtta alarm yok. Bin takılı ödeme zaten genel bir arızadır.
 */
const SWEEP_PAGE = 50;
const SWEEP_MAX_PAGES = 20;
/** Onay rotasında art arda uzlaştırılan en çok kayıt (beklenen: 1). */
const BLOCK_MAX_RECONCILES = 10;
/**
 * Süpürgenin kalıcı ilerleme imleci (`SystemLock` satırı genel durum deposu olarak — `scheduled-sync.ts` "scheduled-sync:resume-from"
 * emsali; `holder` = son gezilen kaydın kimliği, `lockedUntil` anlamsız). Satır yalnız tur sınıra çarptığında olur; tam tur bitince silinir.
 * En iyi çaba: okunamazsa tur baştan başlar (bugünkü davranış), yazılamazsa sonraki tur aynı yeri yeniden gezer (kayıp yok, yalnız tekrar).
 */
export const PAID_SWEEP_CURSOR_NAME = "checkout-paid-sweep:after";

async function readPaidSweepCursor(): Promise<string | null> {
  try {
    const row = await prisma.systemLock.findUnique({ where: { name: PAID_SWEEP_CURSOR_NAME }, select: { holder: true } });
    return row?.holder || null;
  } catch {
    return null;
  }
}

async function writePaidSweepCursor(after: string | null): Promise<void> {
  try {
    if (after === null) {
      await prisma.systemLock.deleteMany({ where: { name: PAID_SWEEP_CURSOR_NAME } });
    } else {
      await prisma.systemLock.upsert({
        where: { name: PAID_SWEEP_CURSOR_NAME },
        create: { name: PAID_SWEEP_CURSOR_NAME, lockedUntil: new Date(0), holder: after },
        update: { holder: after },
      });
    }
  } catch {
    /* en iyi çaba — ↑ */
  }
}

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
  // Kapanış anı bağlandığı / bırakıldığı andır (ödeme anı değil): 90 günlük saklama bu andan sayılır — eski bir ödemenin kaydı kapanır
  // kapanmaz silinseydi, aynı işlemin yeniden gönderilen olayı "ödeme alındı"yı baştan açardı.
  const done = await prisma.checkoutIntent.updateMany({ where: { id: row.id, status: CHECKOUT_PAID_STATUS }, data: { status, closedAt: new Date() } });
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
    // Satır hâlâ ödenmemiş durumda: niyet modülü onu "ödeme alındı"ya çeviremedi (o yol hatasını yutar — fatura / abonelik yazımı sürsün
    // diye). Kalıcı kayıt burada yazılır; hata yutulmaz (olay yeniden gelir). Kapanmış niyetin sonradan ödenen işleminde bu, kaydın
    // oluştuğu TEK yerdir: açık niyeti süpürge / sonraki onay Paddle'dan okuyup yakalar, kapanmış niyeti kimse yeniden okumaz.
    let status = existing.status;
    if ((CHECKOUT_UNPAID_STATUSES as readonly string[]).includes(status)) {
      await prisma.checkoutIntent.updateMany({
        where: { id: existing.id, status: { in: [...CHECKOUT_UNPAID_STATUSES] } },
        data: { status: CHECKOUT_PAID_STATUS, openKey: null, closedAt: input.paidAt },
      });
      status = CHECKOUT_PAID_STATUS;
    }
    if (status === CHECKOUT_PAID_STATUS && linkedOrg === existing.organizationId) {
      // Sonuç kapanışın KENDİSİNDEN (K9): kaydı bu arada başka işlem kapattıysa bu çağrı "bağladı" demez.
      return (await closePaidCheckout(existing, CHECKOUT_FULFILLED_STATUS, "transaction_subscription_linked")) ? "fulfilled" : "exists";
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

/** `fulfilPaidCheckoutsInTx`in kapattığı kayıt (işlem commit olduktan sonra alarm temizliği + olay günlüğü için). */
export interface FulfilledCheckout {
  id: string;
  consentId: string;
  providerRef: string | null;
}

/** TEST KANCASI: kapanış yazımından hemen önce çalışır (işlem içi arıza taklidi — genel istemciye kurulan casus işlem istemcisini görmez). */
export const __checkoutPaidHooks: { beforeFulfilWrite: null | (() => void | Promise<void>) } = { beforeFulfilWrite: null };

/**
 * Abonelik olayı hesaba YAZILIYOR ve bu onay kimliğini taşıyor → o onayın ödemesi bağlanmıştır (durumu ne olursa olsun: bağ, abonelik
 * satırındaki kimliktir). Bekleyen kayıt kapanır; işlem olayı henüz gelmediyse açık niyet de doğrudan kapanır (abonelik varsa ödeme
 * alınmıştır).
 *
 * 🚨 ABONELİK YAZIMIYLA AYNI İŞLEMDE (Codex 11-25, kurucu talimatı `docs/KURUCU-TALIMATI-2026-11-25-…`): eskiden abonelik satırı yazıldıktan
 * SONRA ayrı bir yazımla kapanıyordu — arada veritabanı bağlantısı koparsa müşteri planı kullanırken aynı ödeme içeride "abonelik bekliyor"
 * kalıyordu (sonraki olay / uzlaştırma toparlıyordu; ikinci tahsilat yoktu). Artık çağıran bu fonksiyonu abonelik yazımının işlem
 * istemcisiyle çağırır: ikisi birlikte yazılır ya da hiçbiri (olay işlenmemiş sayılır, Paddle yeniden gönderir). Yalnız VERİTABANI yazımı
 * burada; alarm temizliği ve olay günlüğü işlem commit olduktan sonra `afterPaidCheckoutsFulfilled` ile.
 * (Paddle'ın para çekmesi ile bu yazım tek işlem DEĞİLDİR — dış sağlayıcıyla aradaki belirsizlik için kalıcı kayıt + uzlaştırma aynen durur.)
 */
export async function fulfilPaidCheckoutsInTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  consentId: string,
  now: Date = new Date(),
): Promise<FulfilledCheckout[]> {
  const rows = await tx.checkoutIntent.findMany({
    where: { organizationId, consentId, status: { in: [CHECKOUT_PAID_STATUS, "open"] } },
    select: { ...ROW, status: true },
  });
  if (rows.length === 0) return [];
  if (__checkoutPaidHooks.beforeFulfilWrite) await __checkoutPaidHooks.beforeFulfilWrite();
  const closed: FulfilledCheckout[] = [];
  for (const row of rows) {
    // Koşullu: yalnız hâlâ aynı durumdaysa (eşzamanlı uzlaştırma / operatör bırakması kazandıysa dokunulmaz). Kapanış anı bağlandığı andır
    // (ödeme anı değil): 90 günlük saklama bu andan sayılır.
    const done = await tx.checkoutIntent.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: CHECKOUT_FULFILLED_STATUS, closedAt: now, ...(row.status === "open" ? { openKey: null } : {}) },
    });
    if (done.count === 1) closed.push({ id: row.id, consentId: row.consentId, providerRef: row.providerRef });
  }
  return closed;
}

/** İşlem COMMIT olduktan sonra: kapanan kayıtların operatör alarm durumu silinir + olay günlüğü. Asla fırlatmaz. */
export async function afterPaidCheckoutsFulfilled(organizationId: string, closed: readonly FulfilledCheckout[]): Promise<void> {
  for (const row of closed) {
    await clearAlertState(paidCheckoutAlertKey(row.id));
    await logEvent(
      "billing.checkout.fulfilled",
      { reason: "subscription_applied", consentId: row.consentId, ...(row.providerRef ? { transactionRef: row.providerRef } : {}) },
      { organizationId },
    );
  }
}

/** Tek başına çağrı (abonelik yazımı olmadan): kendi işleminde kapatır. Hata yutulmaz. */
export async function fulfilPaidCheckouts(organizationId: string, consentId: string, now: Date = new Date()): Promise<number> {
  const closed = await prisma.$transaction((tx) => fulfilPaidCheckoutsInTx(tx, organizationId, consentId, now));
  await afterPaidCheckoutsFulfilled(organizationId, closed);
  return closed.length;
}

export interface PaidCheckoutVerdict {
  outcome: "awaiting" | "fulfilled" | "released";
  /** Operatöre gösterilecek kısa teşhis (yalnız Paddle kimlikleri ve durum adları — müşteri verisi yok). */
  paddle: string;
}

/**
 * Koşullu kapanış 0 satır güncelledi (K9, Codex 11-25 ikinci rapor): kaydı bu arada BAŞKA bir işlem değiştirdi (abonelik olayı bağladı,
 * operatör bıraktı). Karar bu uzlaştırmanın Paddle okumasından değil, kaydın SON durumundan verilir — "bırakıldı" kaydı "bağlandı"
 * diye raporlanmaz. Kayıt yoksa (işletmeyle silindi) bekleyen bir şey de yoktur; hâlâ bekliyorsa (beklenmez) bekler.
 */
async function currentVerdict(intentId: string): Promise<PaidCheckoutVerdict> {
  const now = await prisma.checkoutIntent.findUnique({ where: { id: intentId }, select: { status: true } });
  if (now?.status === CHECKOUT_FULFILLED_STATUS) return { outcome: "fulfilled", paddle: "kaydı başka bir işlem bağladı" };
  if (now?.status === CHECKOUT_RELEASED_STATUS) return { outcome: "released", paddle: "kaydı başka bir işlem serbest bıraktı" };
  if (now === null) return { outcome: "released", paddle: "kayıt artık yok" };
  return { outcome: "awaiting", paddle: `kayıt kapatılamadı (durum ${now.status})` };
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
  if (!txn.subscriptionId) {
    // Abonelik hiç kurulmadan iade edilmiş ödeme: onaylı TAM iade + abonelik HÂLÂ yok → serbest. İade okumasından SONRA işlem yeniden okunur
    // (Haiku incelemesi 11-19): ilk okumayla iade okuması arasında abonelik kurulduysa bu dal karar vermez — kayıt bekler, sonraki
    // uzlaştırma abonelik dalından (iptal + iade) karar verir. Yoksa iade edilmiş ama aboneliği sonradan etkinleşmiş ödemede ikinci ödeme
    // açılır, işletmede iki etkin abonelik olurdu.
    if ((await readTransactionRefund(row.providerRef)) === "full_refund_approved") {
      const again = await readPaddleTransaction(row.providerRef);
      if (again !== null && again !== PADDLE_TXN_NOT_FOUND && !again.subscriptionId) {
        if (await closePaidCheckout(row, CHECKOUT_RELEASED_STATUS, "refunded")) {
          return { outcome: "released", paddle: `işlem ${row.providerRef} tam iade edilmiş (onaylı), abonelik yok` };
        }
        return currentVerdict(row.id);
      }
      return { outcome: "awaiting", paddle: `işlem ${row.providerRef} tam iade edilmiş ama abonelik durumu yeniden doğrulanamadı` };
    }
    return { outcome: "awaiting", paddle: `işlem durumu ${txn.status ?? "bilinmiyor"}, abonelik kimliği yok` };
  }
  const local = await prisma.subscription.findUnique({ where: { organizationId: row.organizationId }, select: { provider: true, providerRef: true } });
  if (local?.provider === "paddle" && local.providerRef === txn.subscriptionId) {
    if (await closePaidCheckout(row, CHECKOUT_FULFILLED_STATUS, "reconciled_linked")) {
      return { outcome: "fulfilled", paddle: `abonelik ${txn.subscriptionId} hesaba bağlı` };
    }
    return currentVerdict(row.id);
  }
  const sub = await getSubscriptionStatus(txn.subscriptionId);
  // İki kanıt BİRLİKTE: para geri verildi (onaylı tam iade) VE abonelik etkin değil (iptal). Biri eksikse kayıt bekler — iade edilmiş ama
  // aboneliği hâlâ etkin ödeme yeni ödemeyle ikinci abonelik açardı; iptal edilmiş ama iade edilmemiş ödeme müşterinin parasını tutar.
  if (sub?.status === "canceled") {
    const refund = await readTransactionRefund(row.providerRef);
    if (refund === "full_refund_approved") {
      if (await closePaidCheckout(row, CHECKOUT_RELEASED_STATUS, "refunded_and_canceled")) {
        return { outcome: "released", paddle: `abonelik ${txn.subscriptionId} iptal, işlem tam iade edilmiş (onaylı)` };
      }
      return currentVerdict(row.id);
    }
    return {
      outcome: "awaiting",
      paddle: `abonelik ${txn.subscriptionId} iptal ama işlemin onaylı TAM iadesi ${refund === null ? "okunamadı" : "yok"} (iptal ≠ iade)`,
    };
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
 * kez + 24 saatte hatırlatma). Bütün kayıtlar kimlik sırasıyla sayfalanır — alarm verilmiş eski kayıtlar yenilerin önünü kesmez. Tur
 * kalıcı imleçten başlar (yoksa baştan): önce imleçten SONRAKİ kayıtlar, liste biterse sınır elverdiğince başa sarıp imlece KADAR olanlar.
 */
export async function sweepPaidCheckouts(
  now: Date = new Date(),
  opts: { /** Yalnız test: gezilen sayfa sınırı (üretimde sabit). */ maxPages?: number } = {},
): Promise<{ checked: number; closed: number; alerted: number }> {
  const maxPages = opts.maxPages ?? SWEEP_MAX_PAGES;
  const result = { checked: 0, closed: 0, alerted: 0 };
  const cutoff = new Date(now.getTime() - PAID_CHECKOUT_ALERT_AFTER_MS);
  const base: Prisma.CheckoutIntentWhereInput = { status: CHECKOUT_PAID_STATUS, OR: [{ closedAt: null }, { closedAt: { lte: cutoff } }] };
  // Süzgeç SORGUDA, ilerleme KALICI (K6): bölüm 1 = imleçten sonrası (imleç yoksa hepsi); bölüm 2 = başa sarıp imlece kadar.
  const start = await readPaidSweepCursor();
  let wrapped = start === null; // imleç yoksa tek bölüm vardır
  let after: string | null = start;
  const rangeOf = (from: string | null): Prisma.CheckoutIntentWhereInput => {
    const upTo = wrapped && start ? start : null;
    if (from && upTo) return { id: { gt: from, lte: upTo } };
    if (from) return { id: { gt: from } };
    if (upTo) return { id: { lte: upTo } };
    return {};
  };
  let finished = false; // bölümler bitti: gezilmemiş kayıt kalmadı
  let page = 0;
  while (page < maxPages) {
    const rows: PaidCheckoutRow[] = await prisma.checkoutIntent.findMany({
      where: { AND: [base, rangeOf(after)] },
      orderBy: { id: "asc" },
      take: SWEEP_PAGE,
      select: ROW,
    });
    page++;
    for (const row of rows) {
      result.checked++;
      const verdict = await reconcilePaidCheckout(row);
      if (verdict.outcome !== "awaiting") {
        result.closed++;
        continue;
      }
      // KENDİLİĞİNDEN BAĞLAMA (kurucu 11-18 akşam, Ö-2: "aynı işletme ve aynı satın alma doğrulanabiliyorsa Paddle'dan otomatik bağlansın;
      // belirsizse operatöre"): bildirim hiç gelmediyse abonelik Paddle'dan okunup aynı bildirim işleyicisine verilir. Kimlik bekleyen kaydın
      // KENDİ işletmesi + onay kaydı + işlemidir. Bağlanamayan / belirsiz kayıt aşağıdaki operatör alarmına düşer (bugünkü davranış). Anahtar
      // kapalıyken hiç denenmez. Kendi anahtarı (`BILLING_PAID_SWEEP_LINK_ENABLED`, kurucu 11-19 ÖD-2): ekran doğrulamasının anahtarından
      // bağımsız açılıp kapanır. (Dinamik içe aktarma: çekirdek bu modülü kullanıyor — döngü olmasın.)
      if (row.providerRef) {
        const { paidSweepLinkEnabled, verifyAndLinkCheckout } = await import("@/lib/billing/checkout-verify");
        if (paidSweepLinkEnabled()) {
          const linked = await verifyAndLinkCheckout({ organizationId: row.organizationId, consentId: row.consentId, transactionId: row.providerRef, now });
          // Bağlanan kaydı bildirim işleyicisi kapatır (alarm durumu da orada temizlenir).
          if (linked.state === "active") {
            result.closed++;
            continue;
          }
        }
      }
      const minutes = Math.max(1, Math.round((now.getTime() - paidAtOf(row).getTime()) / 60_000));
      const alerted = await alertOnTransition(
        paidCheckoutAlertKey(row.id),
        "paddle-paid-not-linked",
        new Error(
          `İşletme ${row.organizationId}: Paddle işlemi ${row.providerRef ?? "?"} ödendi (${minutes} dk önce) ama abonelik hesaba bağlanmadı — ` +
            `müşteri yeniden ödeme yapamaz (bilerek engelli). Paddle: ${verdict.paddle}. Yapılacak: abonelik olayını Paddle'dan yeniden gönderin. ` +
            `Olay yine bağlanamıyorsa (ör. Ödeme incelemesi'nde "bağlanamadı" görünüyor) Paddle'da aboneliği HEMEN iptal edip ödemeyi TAM iade edin — ` +
            `iade Paddle'da onaylanınca ve abonelik iptal olunca engel kendiliğinden kalkar (iptal tek başına yetmez; bekleyen ya da kısmi iade ` +
            `yetmez; dönem sonuna planlanan iptalde abonelik etkin kalır, engel de kalır) — ya da ` +
            `Operasyon Teşhisi'nden kaydı serbest bırakın.`,
        ),
        { now },
      );
      if (alerted === "alerted") result.alerted++;
    }
    if (rows.length > 0) after = rows[rows.length - 1]!.id;
    if (rows.length < SWEEP_PAGE) {
      if (wrapped) {
        finished = true;
        break;
      }
      // Bölüm 1 bitti (imleçten sonrası): başa sar, imlece kadar olanları gez.
      wrapped = true;
      after = null;
    }
  }
  if (finished) {
    await writePaidSweepCursor(null);
    return result;
  }
  // Sınıra çarpıldı: gezilmemiş kayıt GERÇEKTEN var mı (bir fazla okuma)? Kalan aralık: bölüm 2'deysek `after` ile imleç arası; bölüm
  // 1'deysek `after`dan sonrası + imlece kadar olanların hepsi.
  const remaining: Prisma.CheckoutIntentWhereInput =
    wrapped && start
      ? { id: { gt: after ?? "", lte: start } }
      : start
        ? { OR: [{ id: { gt: after ?? start } }, { id: { lte: start } }] }
        : { id: { gt: after ?? "" } };
  const more = await prisma.checkoutIntent.findFirst({ where: { AND: [base, remaining] }, select: { id: true } });
  if (!more) {
    await writePaidSweepCursor(null);
    return result;
  }
  await writePaidSweepCursor(after);
  await alertOnTransition(
    "checkout-paid-sweep-cap",
    "paddle-paid-not-linked-backlog",
    new Error(`${SWEEP_PAGE * maxPages} kayıttan fazla ödeme abonelik bekliyor — süpürge bir turda hepsini gezemedi, sonraki tur kaldığı yerden sürer (genel bir ödeme arızası olabilir).`),
    { now },
  );
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
