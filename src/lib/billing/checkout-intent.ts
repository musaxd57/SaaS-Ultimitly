import "server-only";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { paddleRequest } from "@/lib/payments/paddle";
import { PADDLE_PAID_STATES, PADDLE_TXN_NOT_FOUND, paddleTransactionStatus, readPaddleTransaction } from "@/lib/billing/paddle-transaction-status";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { reportError } from "@/lib/report-error";
import { checkoutPendingActive, markCheckoutPending } from "@/lib/billing/checkout-pending";
import { isLivePaddleSubscription } from "@/lib/billing/live-subscription";
import {
  CHECKOUT_FULFILLED_STATUS,
  CHECKOUT_PAID_STATUS,
  CHECKOUT_UNPAID_STATUSES,
  paidCheckoutAwaiting,
  recordPaidCheckout,
  sweepPaidCheckouts,
} from "@/lib/billing/checkout-paid";

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
// Kapalı küme durumlar: opening · open · completed · fulfilled · released · canceled · expired · failed. `openKey` yalnız opening / open
// iken = işletme kimliği. "completed" = ÖDEME ALINDI, ABONELİK BEKLENİYOR (Codex 11-17): süreyle kapanmaz, yeni ödeme ekranı açtırmaz;
// abonelik hesaba bağlanınca "fulfilled", ödeme geçersiz sayılınca "released" olur — kurallar `checkout-paid.ts`.
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
/**
 * MUTLAK ÜST SINIR (Opus 10-21 B2): açık niyet bu süreden sonra Paddle'a ulaşılamasa da kapanır. Gerekçe: webhook onay tazeliği 24 sa
 * (`consentAcceptable`) — bundan eski onayla ödenen işlem zaten işletmeye bağlanamaz; Paddle'ın bulamadığı / iptal edemediği işlem niyeti
 * sonsuza kadar tutup işletmenin ödeme yapmasını engellemesin. Kapanırken operatöre haber verilir (iptal doğrulanmadı).
 */
export const CHECKOUT_INTENT_MAX_AGE_MS = 24 * 60 * 60_000;
/** Yeniden verilen işlemin en az bu kadar daha geçerli kalması (Opus 10-21 B3: ikinci sekme öderken süpürge iptal etmesin). */
export const CHECKOUT_INTENT_REUSE_GRACE_MS = 30 * 60_000;

export const CHECKOUT_INTENT_BUSY_MESSAGE = "Açık bir ödemeniz var. Tamamlanmasını bekleyin ya da birkaç dakika sonra tekrar deneyin.";
export const CHECKOUT_INTENT_OPENING_MESSAGE = "Ödeme ekranı hazırlanıyor. Birkaç saniye sonra tekrar deneyin.";
export const CHECKOUT_INTENT_FAILED_MESSAGE = "Ödeme ekranı açılamadı. Kısa bir süre sonra tekrar deneyin.";

export type IntentResult =
  | { kind: "open"; transactionId: string; reused: boolean }
  | { kind: "busy"; message: string }
  | { kind: "paid" }
  | { kind: "failed"; message: string };

/** Ödendi: yalnız `paid` / `completed`. `billed` (fatura kesildi, ödeme BEKLENİYOR) ödendi DEĞİL (Opus 10-21 B4). */
const PAID_STATES = PADDLE_PAID_STATES;
/**
 * Ödenmemiş ama iptal de edilemeyen / ödeme ekranı açılamayan durumlar (`billed` elle tahsilat, `past_due` gecikmiş): yeni ekran AÇILMAZ,
 * eski işlem verilmez ("açık bir ödemeniz var"); mutlak üst sınırda kapanır.
 */
const UNPAYABLE_OPEN_STATES = new Set(["billed", "past_due"]);
/** Paddle'ın işlemi bulamadığı durum — tek kaynak `paddle-transaction-status.ts`. */
const NOT_FOUND = PADDLE_TXN_NOT_FOUND;
/** Paddle'da işlemin durumu — tek okuma noktası `paddle-transaction-status.ts` (Codex 11-04: başarısızlık olayı da kullanır). */
const transactionStatus = paddleTransactionStatus;

/**
 * Ödendiği SUNUCUDA görüldü (Paddle durumu ya da webhook) → "Ödemeniz işleniyor" kilidi sunucuda da yazılır (Opus 10-21 B1): yoksa kilidi
 * yalnız istemci yazıyordu — sekme kapandıysa ikinci tıklama niyeti boş bulup YENİ işlem açıyordu. Abonelik webhook'u kilidi kaldırır.
 *
 * 🚨 SIRA: ÖNCE KİLİT, SONRA NİYET KAPANIR (ödeme P2, Codex 11-10). Eski sırada (niyet kapanır → kilit yazılır) arada ne açık niyet ne kilit
 * vardı: tam o anda gelen ikinci tıklama yeni işlem açabiliyordu (çift tahsilat).
 *
 * 🚨 ASIL KORUMA ARTIK KAYDIN KENDİSİ (Codex 11-17): "ödeme alındı" durumu süreyle kapanmaz ve yeni ödeme ekranı açtırmaz
 * (`checkout-paid.ts`); kilit yalnız 10 dakikalık yardımcıdır. Bu yüzden kilit yazılamasa da kayıt "ödeme alındı"ya geçer — eskiden kilit
 * yazılamayınca niyet olduğu gibi bırakılıyordu; açık niyette bu korumaydı ama KAPANMIŞ (süresi dolmuş) niyetin sonradan ödenen işleminde
 * hiçbir iz kalmazdı.
 */
async function settlePaidIntent(intent: { id: string; organizationId: string; consentId: string }, now: Date): Promise<void> {
  try {
    await markCheckoutPending(intent.organizationId, intent.consentId, now);
  } catch (err) {
    void reportError("checkout-intent-pending", err); // kilit yok; aşağıdaki kayıt yine korur
  }
  // Kapanmış ama ödenmemiş satır da (süresi dolmuş, iptali doğrulanamamış) "ödeme alındı"ya geçer: Paddle'ın "ödendi"si yerel kapanışa
  // baskındır (Codex 11-17). Kapanış anı = ödemenin görüldüğü an.
  await prisma.checkoutIntent.updateMany({
    where: { id: intent.id, status: { in: [...CHECKOUT_UNPAID_STATUSES] } },
    data: { status: CHECKOUT_PAID_STATUS, openKey: null, closedAt: now },
  });
  await closeOtherOpenIntent(intent, now);
}

/**
 * Ödeme alındı → işletmenin BAŞKA açık işlemi kalmasın (Codex 11-17). Olağan yolda ödenen işlem zaten tek açık niyettir (hiçbir şey yapmaz).
 * Ama süresi dolup kapanmış bir niyetin işlemi sonradan ödendiyse müşteri bu arada YENİ bir ödeme ekranı açmış olabilir: o ekran açık
 * kalırsa ikinci ödeme tamamlanabilir. Açık işlem Paddle'da iptal edilir ve niyeti kapanır; iptal edilemiyorsa (ödeme başlamış olabilir)
 * dokunulmaz — ödenirse o da "ödeme alındı" olur ve ikinci abonelik alarmı doğar. Asla fırlatmaz.
 */
async function closeOtherOpenIntent(paid: { id: string; organizationId: string }, now: Date): Promise<void> {
  try {
    const other = await prisma.checkoutIntent.findUnique({ where: { openKey: paid.organizationId }, select: { id: true, status: true, providerRef: true } });
    if (!other || other.id === paid.id || other.status !== "open" || !other.providerRef) return;
    if (!(await cancelOrConfirmClosed(other.providerRef))) return;
    await prisma.checkoutIntent.updateMany({ where: { id: other.id, status: "open" }, data: { status: "canceled", openKey: null, closedAt: now } });
  } catch (err) {
    void reportError("checkout-intent-close-other", err);
  }
}

/**
 * Yer (tek açık niyet) BU istek için boşaldı — ama boşalmanın nedeni "ödendi" olabilir (ödeme P2): onay rotası "kilit var mı / canlı abonelik
 * var mı" diye baktıktan SONRA ödeme tamamlanıp niyet kapanmış olabilir. Kilit niyet kapanmadan ÖNCE yazıldığı için (↑) burada mutlaka
 * görünür; kilidi abonelik webhook'u bu arada kaldırdıysa canlı abonelik satırı görünür. İkisinden biri varsa yeni Paddle işlemi AÇILMAZ.
 */
async function paidWhileWaiting(organizationId: string, now: Date): Promise<boolean> {
  if (await checkoutPendingActive(organizationId, now)) return true;
  // Kilit düşmüş olsa da ödemesi alınmış, aboneliği bağlanmamış kayıt varsa yeni işlem açılmaz (Codex 11-17 — süreyle kapanmaz).
  if (await paidCheckoutAwaiting(organizationId)) return true;
  const live = await prisma.subscription.findUnique({ where: { organizationId }, select: { provider: true, providerRef: true, status: true } });
  return isLivePaddleSubscription(live);
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

const CLOSED_STATES = new Set(["canceled", NOT_FOUND]);

/** İptal eder; iptal çağrısı başarısız olsa da işlem Paddle'da zaten kapalıysa (iptal edilmiş) true. Ödenmiş / belirsiz → false. */
async function cancelOrConfirmClosed(transactionId: string): Promise<boolean> {
  if (await cancelTransaction(transactionId)) return true;
  const status = await transactionStatus(transactionId);
  return status !== null && CLOSED_STATES.has(status);
}

/**
 * Süresi dolmuş açık niyetleri ve takılı "açılıyor" niyetlerini kapatır (yalnız bu işletme). Codex 11-04 P2: süresi dolan işlemin ÖDENDİĞİ
 * burada görülürse sonuç ÇAĞIRANA taşınır (`paidFound`) — boşalan `openKey` "yeni ödeme güvenli" demek değildir; çağıran yeni işlem AÇMAZ.
 */
async function closeStale(organizationId: string, now: Date): Promise<{ paidFound: boolean }> {
  let paidFound = false;
  await prisma.checkoutIntent.updateMany({
    where: { organizationId, status: "opening", createdAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_OPENING_LEASE_MS) } },
    data: { status: "failed", openKey: null, closedAt: now },
  });
  // Süresi dolan YA DA mutlak üst sınırı aşan (yeniden verme süreyi uzatmış olabilir — Haiku 10-21) açık niyetler.
  const expired = await prisma.checkoutIntent.findMany({
    where: {
      organizationId,
      status: "open",
      OR: [{ expiresAt: { lt: now } }, { createdAt: { lte: new Date(now.getTime() - CHECKOUT_INTENT_MAX_AGE_MS) } }],
    },
    select: { id: true, providerRef: true, consentId: true, createdAt: true },
  });
  for (const e of expired) {
    // Süresi dolan işlem ödenmişse (webhook gecikti) kapatılmaz — "tamamlandı" sayılır; aksi hâlde iptal denenir, sonuç ne olursa olsun
    // niyet kapanır (iptal edilemeyen ödenmemiş işlemin ödemesi webhook'ta bugünkü yoldan onaya bağlanır).
    const status = e.providerRef ? await transactionStatus(e.providerRef) : null;
    if (status && PAID_STATES.has(status)) {
      paidFound = true; // eşzamanlı istek satırı önce kapatmış olsa da ödeme gerçek — bu istek de yeni işlem açmaz
      await settlePaidIntent({ id: e.id, organizationId, consentId: e.consentId }, now);
      continue;
    }
    // İptal başarısız / belirsizse yer BOŞALTILMAZ (Haiku 10-21 #1): eski işlem hâlâ ödenebilirken ikinci işlem açılmasın — niyet açık kalır,
    // sonraki süpürge / onay yeniden dener (aynı paket bu işlemi yeniden kullanır; Paddle aynı işlemi iki kez tahsil etmez).
    if (e.providerRef && !(status && UNPAYABLE_OPEN_STATES.has(status)) && (await cancelOrConfirmClosed(e.providerRef))) {
      await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "expired", openKey: null, closedAt: now } });
      continue;
    }
    if (!e.providerRef) {
      await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "expired", openKey: null, closedAt: now } });
      continue;
    }
    // İptal doğrulanamadı → yer KORUNUR (ödeme sürüyor olabilir) — ama mutlak üst sınırı aşan niyet kapanır + operatöre haber (B2).
    if (now.getTime() - e.createdAt.getTime() >= CHECKOUT_INTENT_MAX_AGE_MS) {
      const closed = await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "expired", openKey: null, closedAt: now } });
      if (closed.count === 1) {
        void reportError("checkout-intent-unverified-close", new Error(`ödeme niyeti iptali doğrulanamadan kapandı (Paddle durumu: ${status ?? "okunamadı"})`));
      }
    }
  }
  return { paidFound };
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
  // Codex 11-04 P2: süresi dolan işlemin ödendiği şimdi görüldüyse bu istek yeni işlem AÇMAZ ("ödemeniz işleniyor").
  if ((await closeStale(input.organizationId, now)).paidFound) return { kind: "paid" };

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

    if (created) {
      if (await paidWhileWaiting(input.organizationId, now)) {
        await prisma.checkoutIntent.updateMany({ where: { id: created.id, status: "opening" }, data: { status: "canceled", openKey: null, closedAt: now } });
        return { kind: "paid" };
      }
      return createTransaction(created.id, input, now);
    }

    // Başka bir açık niyet var.
    const existing = await prisma.checkoutIntent.findUnique({
      where: { openKey: input.organizationId },
      select: { id: true, status: true, priceId: true, providerRef: true, consentId: true, expiresAt: true, createdAt: true },
    });
    if (!existing) continue; // arada kapandı → yeniden dene
    // Başka sekme Paddle'ı bekliyor ("açılıyor"): kısa süre sonra tekrar denenince AYNI işlemi alır (bilinçli; kiralama 30 sn).
    if (existing.status === "opening" || !existing.providerRef) return { kind: "busy", message: CHECKOUT_INTENT_OPENING_MESSAGE };
    const status = await transactionStatus(existing.providerRef);
    if (status && PAID_STATES.has(status)) {
      await settlePaidIntent({ id: existing.id, organizationId: input.organizationId, consentId: existing.consentId }, now);
      return { kind: "paid" };
    }
    // İşlem Paddle'da zaten iptal edilmişse (ör. önceki iptal çağrısı zaman aşımına uğradı ama uygulandı) ölü işlem yeniden verilmez — niyet
    // kapanır, yenisi açılır (Haiku 10-21 #2).
    if (status && CLOSED_STATES.has(status)) {
      await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open" }, data: { status: "canceled", openKey: null, closedAt: now } });
      continue;
    }
    // Aynı paket: aynı işlem. (Başka bir yöneticinin sekmesi de olsa ödeme ilk onayın kaydıyla işletmeye bağlanır — her kabul ayrıca delil
    // olarak yazıldı; Haiku 10-21 #3 bilinçli.)
    // Ödenmemiş ama ödeme ekranı açılamayan / iptal edilemeyen işlem (B4) ya da süresi dolmuş ama iptal edilemeyen işlem (B2): verilmez,
    // yenisi de açılmaz.
    // Yaşı mutlak üst sınırı geçen niyet buraya gelmez: aynı istekte `closeStale` onu kapatır (iptal ya da doğrulanamadan kapanış + haber).
    const hardEnd = existing.createdAt.getTime() + CHECKOUT_INTENT_MAX_AGE_MS;
    if ((status && UNPAYABLE_OPEN_STATES.has(status)) || existing.expiresAt < now) {
      return { kind: "busy", message: CHECKOUT_INTENT_BUSY_MESSAGE };
    }
    if (existing.priceId === input.priceId) {
      // Yeniden verilen işlem en az 30 dk daha geçerli kalır (B3) — ikinci sekme öderken süpürge iptal etmesin; mutlak üst sınırı AŞMAZ.
      const graceUntil = new Date(Math.min(now.getTime() + CHECKOUT_INTENT_REUSE_GRACE_MS, hardEnd));
      await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open", expiresAt: { lt: graceUntil } }, data: { expiresAt: graceUntil } });
      // Okuma ile bu an arasında niyet kapandıysa (webhook ödendi dedi / başka istek iptal etti) ölü işlem VERİLMEZ (Haiku 10-21).
      const still = await prisma.checkoutIntent.findUnique({ where: { id: existing.id }, select: { status: true } });
      if (still?.status !== "open") {
        const paid = still?.status === CHECKOUT_PAID_STATUS || still?.status === CHECKOUT_FULFILLED_STATUS;
        return paid ? { kind: "paid" } : { kind: "busy", message: CHECKOUT_INTENT_BUSY_MESSAGE };
      }
      return { kind: "open", transactionId: existing.providerRef, reused: true };
    }
    // Farklı paket: eski ödenmemiş işlem iptal edilir, sonra yenisi açılır. İptal doğrulanamazsa yeni ekran YOK.
    if (!(await cancelOrConfirmClosed(existing.providerRef))) return { kind: "busy", message: CHECKOUT_INTENT_BUSY_MESSAGE };
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
  // Paddle çağrısı sürerken (dış çağrı, saniyeler) işletmenin ESKİ bir işlemi ödenmiş olabilir (kapanmış niyetin geç ödemesi — o an bu
  // niyet henüz "açılıyor"du, `closeOtherOpenIntent` onu göremedi; Opus incelemesi 11-18). Yeni işlem istemciye VERİLMEZ: kimliği
  // bilinmeyen işlem ödenemez. İptal edilebilirse niyet kapanır; edilemezse açık kalır, süpürge kapatır.
  if (await paidCheckoutAwaiting(input.organizationId)) {
    if (await cancelOrConfirmClosed(transactionId)) {
      await prisma.checkoutIntent.updateMany({ where: { id: intentId, status: "open" }, data: { status: "canceled", openKey: null, closedAt: now } });
    }
    return { kind: "paid" };
  }
  return { kind: "open", transactionId, reused: false };
}

/**
 * Webhook: işlem tamamlandı / ödendi → niyet kapanır (yoksa sessiz — anahtar kapalıyken açılmış ödeme). FIRLATMAZ (Haiku 10-21 #6): niyet
 * kapatılamazsa fatura / abonelik yazımı yine sürer; açık kalan niyeti süpürge Paddle durumundan "tamamlandı" diye kapatır.
 */
export async function completeCheckoutIntent(transactionId: string, now: Date = new Date()): Promise<void> {
  try {
    // Ödenmeden önceki HER durumdaki satır (kapanmış olanlar dahil — Codex 11-17): süresi dolup iptali doğrulanamadan kapanmış niyetin
    // işlemi sonradan ödenirse de "ödeme alındı" kaydı oluşur.
    const intent = await prisma.checkoutIntent.findFirst({
      where: { providerRef: transactionId, status: { in: [...CHECKOUT_UNPAID_STATUSES] } },
      select: { id: true, organizationId: true, consentId: true },
    });
    if (!intent) return;
    // İşlem olayı abonelik olayından ÖNCE gelebilir (Paddle sırası garanti değil): niyet boşalınca ikinci tıklama yeni işlem açmasın (B1) —
    // kilit niyet kapanmadan önce yazılır (P2).
    await settlePaidIntent(intent, now);
  } catch (err) {
    void reportError("checkout-intent-complete", err);
  }
}

/**
 * İSTEMCİNİN "ödeme tamamlandı" sinyali SUNUCUDA doğrulanır (Codex 11-17; `api/billing/checkout-pending`). Sinyal tek başına yalnız 10 dk
 * kilit yazar; ödeme Paddle'dan okunup doğrulanırsa kalıcı kayıt oluşur — web kancası hiç gelmese de ikinci ödeme açılmaz.
 *  1. İşletmenin açık niyeti varsa (işlemi sunucu açtı) işlem kimliği SATIRDAN alınır; Paddle "ödendi" diyorsa niyet "ödeme alındı" olur.
 *  2. Yoksa istemcinin bildirdiği işlem okunur: ödenmiş VE taşıdığı onay kaydı BU işletmeninse deftere yazılır. Başkasının işlemi,
 *     ödenmemiş işlem, okunamayan yanıt → hiçbir şey yazılmaz (kilit yine geçerli).
 * Asla fırlatmaz (istemci sinyalinin yanıtı bu doğrulamaya bağlı değildir).
 */
export async function confirmPaidCheckout(input: { organizationId: string; transactionId: string | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  try {
    const open = await prisma.checkoutIntent.findUnique({
      where: { openKey: input.organizationId },
      select: { id: true, organizationId: true, consentId: true, providerRef: true },
    });
    if (open?.providerRef) {
      const status = await transactionStatus(open.providerRef);
      if (status && PAID_STATES.has(status)) await settlePaidIntent(open, now);
      return;
    }
    if (!input.transactionId) return;
    const txn = await readPaddleTransaction(input.transactionId);
    if (txn === null || txn === NOT_FOUND || !txn.status || !PAID_STATES.has(txn.status) || !txn.consentId) return;
    const own = await prisma.checkoutConsent.findFirst({ where: { id: txn.consentId, organizationId: input.organizationId }, select: { id: true } });
    if (!own) return;
    await recordPaidCheckout({ transactionId: input.transactionId, consentId: own.id, subscriptionId: txn.subscriptionId, origin: txn.origin, paidAt: now });
  } catch (err) {
    void reportError("checkout-paid-confirm", err);
  }
}

/**
 * Anahtar KAPATILDIĞINDA hâlâ açık niyet varsa (geri alma): eski istemci yolu ikinci ödeme ekranı açmasın (Haiku 10-21 #4). Anahtar hiç
 * açılmadıysa tablo boştur → bugünkü davranış aynen.
 */
export async function openCheckoutIntentExists(organizationId: string, now: Date = new Date()): Promise<boolean> {
  // Mutlak üst sınırı aşmış takılı niyet anahtar kapalı yolu kilitlemez (B2) — süpürge onu zaten kapatır.
  return (
    (await prisma.checkoutIntent.count({
      where: { openKey: organizationId, createdAt: { gt: new Date(now.getTime() - CHECKOUT_INTENT_MAX_AGE_MS) } },
    })) > 0
  );
}

/** Saatlik süpürge: süresi dolan açık niyetler (bütün işletmeler) + 90 günden eski kapanmış niyetlerin silinmesi. */
export async function sweepCheckoutIntents(now: Date = new Date()): Promise<{ expired: number; deleted: number; paidAwaiting: number }> {
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
  // Bağlanmamış ödemeler: uzlaştır, hâlâ bekliyorsa operatöre haber (Codex 11-17). Saklama süresi "ödeme alındı" kaydını SİLMEZ — kayıt
  // ancak bağlanınca / bırakılınca kapanır (silinseydi 90 gün sonra ikinci ödeme yine açılırdı).
  const paid = await sweepPaidCheckouts(now);
  const deleted = await prisma.checkoutIntent.deleteMany({
    where: { openKey: null, status: { not: CHECKOUT_PAID_STATUS }, closedAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_RETENTION_MS) } },
  });
  return { expired: orgs.length, deleted: deleted.count, paidAwaiting: paid.checked - paid.closed };
}
