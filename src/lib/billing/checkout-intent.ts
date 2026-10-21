import "server-only";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { paddleRequest } from "@/lib/payments/paddle";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { reportError } from "@/lib/report-error";
import { markCheckoutPending } from "@/lib/billing/checkout-pending";

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
const PAID_STATES = new Set(["paid", "completed"]);
/**
 * Ödenmemiş ama iptal de edilemeyen / ödeme ekranı açılamayan durumlar (`billed` elle tahsilat, `past_due` gecikmiş): yeni ekran AÇILMAZ,
 * eski işlem verilmez ("açık bir ödemeniz var"); mutlak üst sınırda kapanır.
 */
const UNPAYABLE_OPEN_STATES = new Set(["billed", "past_due"]);
/** Paddle'ın işlemi bulamadığı durum (ör. sandbox işlemi canlı anahtarla soruldu) — kalıcı; işlem kapalı sayılır (Opus 10-21 B2). */
const NOT_FOUND = "not_found";

/** Paddle'da işlemin durumu ("ready" · "paid" · …); bulunamadıysa `not_found`; okunamazsa null (karar verilmez). */
async function transactionStatus(transactionId: string): Promise<string | null> {
  try {
    const body = (await paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`)) as { data?: { status?: unknown } } | null;
    return typeof body?.data?.status === "string" ? body.data.status : null;
  } catch (err) {
    return isPaddleNotFound(err) ? NOT_FOUND : null;
  }
}

/** `paddleRequest` hata metni: "Paddle HTTP 404 (entity_not_found) env=… resource=…". */
function isPaddleNotFound(err: unknown): boolean {
  return err instanceof Error && /^Paddle HTTP 404 \(|\(entity_not_found\)/.test(err.message);
}

/**
 * Ödendiği SUNUCUDA görüldü (Paddle durumu ya da webhook) → "Ödemeniz işleniyor" kilidi sunucuda da yazılır (Opus 10-21 B1): yoksa kilidi
 * yalnız istemci yazıyordu — sekme kapandıysa ikinci tıklama niyeti boş bulup YENİ işlem açıyordu. Abonelik webhook'u kilidi kaldırır.
 */
async function markPaidPending(organizationId: string, consentId: string, now: Date): Promise<void> {
  await markCheckoutPending(organizationId, consentId, now).catch((err) => void reportError("checkout-intent-pending", err));
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

/** Süresi dolmuş açık niyetleri ve takılı "açılıyor" niyetlerini kapatır (yalnız bu işletme). */
async function closeStale(organizationId: string, now: Date): Promise<void> {
  await prisma.checkoutIntent.updateMany({
    where: { organizationId, status: "opening", createdAt: { lt: new Date(now.getTime() - CHECKOUT_INTENT_OPENING_LEASE_MS) } },
    data: { status: "failed", openKey: null, closedAt: now },
  });
  const expired = await prisma.checkoutIntent.findMany({
    where: { organizationId, status: "open", expiresAt: { lt: now } },
    select: { id: true, providerRef: true, consentId: true, createdAt: true },
  });
  for (const e of expired) {
    // Süresi dolan işlem ödenmişse (webhook gecikti) kapatılmaz — "tamamlandı" sayılır; aksi hâlde iptal denenir, sonuç ne olursa olsun
    // niyet kapanır (iptal edilemeyen ödenmemiş işlemin ödemesi webhook'ta bugünkü yoldan onaya bağlanır).
    const status = e.providerRef ? await transactionStatus(e.providerRef) : null;
    if (status && PAID_STATES.has(status)) {
      const done = await prisma.checkoutIntent.updateMany({ where: { id: e.id, status: "open" }, data: { status: "completed", openKey: null, closedAt: now } });
      if (done.count === 1) await markPaidPending(organizationId, e.consentId, now);
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
      select: { id: true, status: true, priceId: true, providerRef: true, consentId: true, expiresAt: true },
    });
    if (!existing) continue; // arada kapandı → yeniden dene
    // Başka sekme Paddle'ı bekliyor ("açılıyor"): kısa süre sonra tekrar denenince AYNI işlemi alır (bilinçli; kiralama 30 sn).
    if (existing.status === "opening" || !existing.providerRef) return { kind: "busy", message: CHECKOUT_INTENT_OPENING_MESSAGE };
    const status = await transactionStatus(existing.providerRef);
    if (status && PAID_STATES.has(status)) {
      await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open" }, data: { status: "completed", openKey: null, closedAt: now } });
      await markPaidPending(input.organizationId, existing.consentId, now);
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
    if ((status && UNPAYABLE_OPEN_STATES.has(status)) || existing.expiresAt < now) return { kind: "busy", message: CHECKOUT_INTENT_BUSY_MESSAGE };
    if (existing.priceId === input.priceId) {
      // Yeniden verilen işlem en az 30 dk daha geçerli kalır (B3) — ikinci sekme öderken süpürge iptal etmesin.
      const graceUntil = new Date(now.getTime() + CHECKOUT_INTENT_REUSE_GRACE_MS);
      await prisma.checkoutIntent.updateMany({ where: { id: existing.id, status: "open", expiresAt: { lt: graceUntil } }, data: { expiresAt: graceUntil } });
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
  return { kind: "open", transactionId, reused: false };
}

/**
 * Webhook: işlem tamamlandı / ödendi → niyet kapanır (yoksa sessiz — anahtar kapalıyken açılmış ödeme). FIRLATMAZ (Haiku 10-21 #6): niyet
 * kapatılamazsa fatura / abonelik yazımı yine sürer; açık kalan niyeti süpürge Paddle durumundan "tamamlandı" diye kapatır.
 */
export async function completeCheckoutIntent(transactionId: string, now: Date = new Date()): Promise<void> {
  try {
    const intent = await prisma.checkoutIntent.findFirst({
      where: { providerRef: transactionId, status: { in: ["open", "opening"] } },
      select: { id: true, organizationId: true, consentId: true },
    });
    if (!intent) return;
    const done = await prisma.checkoutIntent.updateMany({
      where: { id: intent.id, status: { in: ["open", "opening"] } },
      data: { status: "completed", openKey: null, closedAt: now },
    });
    // İşlem olayı abonelik olayından ÖNCE gelebilir (Paddle sırası garanti değil): niyet boşalınca ikinci tıklama yeni işlem açmasın (B1).
    if (done.count === 1) await markPaidPending(intent.organizationId, intent.consentId, now);
  } catch (err) {
    void reportError("checkout-intent-complete", err);
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
