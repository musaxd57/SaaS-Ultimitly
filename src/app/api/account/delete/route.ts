import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { reauthBlocked, noteReauthFailure, REAUTH_CAP_MESSAGE } from "@/lib/auth/reauth-guard";
import { clearSessionCookie } from "@/lib/auth";
import {
  requireSession,
  unauthorized,
  badRequest,
  forbidden,
  jsonOk,
  serverError,
  tooManyRequests,
  readJsonCappedOrNull,
  hasJsonContentType,
  unsupportedMediaType,
} from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { crossSiteWrite } from "@/lib/route-guard";
import { deleteAccountData } from "@/lib/data-retention";
import { decryptSecret } from "@/lib/crypto";
import { verifyTotpStep } from "@/lib/auth/totp";
import { reportError } from "@/lib/report-error";
import { CHECKOUT_PAID_STATUS } from "@/lib/billing/checkout-paid";
import { checkoutPendingLockName } from "@/lib/billing/checkout-pending";

// ---------------------------------------------------------------------------
// PERMANENT account + data erasure (KVKK right-to-erasure / "hesabımı sil").
// The signed-in OWNER deletes their whole organization and everything under it.
// Guarded: owner-only, re-authenticated with the account password, rate-limited,
// and BLOCKED while an operator is impersonating (no nuking a customer's org
// through an impersonation session). Irreversible.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (session.actorUserId) return forbidden("İşletme hesabındayken (impersonation) silme yapılamaz.");
  if (session.role !== "owner") return forbidden("Hesabı yalnızca sahip rolü silebilir.");

  // Codex 11-04 P2: başka (kardeş) alan adından gelen yazma ve JSON olmayan gövde KOTAYI TÜKETMEDEN reddedilir — aksi hâlde kardeş HTTPS
  // kökeninden giden basit (text/plain) istekler kullanıcının deneme kovasını doldurup kendi güvenlik işlemini engelleyebiliyordu.
  if (crossSiteWrite(req)) return forbidden();
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  const limited = await rateLimit(`account-delete:${session.userId}`, 5, 15 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  // 🚨 GÜNLÜK ORTAK HATA TAVANI (09-23 saldırgan turu): kısa kova tek başına günde 480 şifre
  // tahmini bırakıyordu ve doğru tahmin HESABI SİLİYOR. Sayaç 2FA ekranlarıyla ortak
  // (`reauth-guard.ts`); tavan dolunca doğru şifre de o gün reddedilir.
  const day = await reauthBlocked(session.userId);
  if (!day.ok) return tooManyRequests(day.retryAfter, REAUTH_CAP_MESSAGE);

  try {
    const data = await readJsonCappedOrNull(req);
    const password = typeof data?.password === "string" ? data.password : "";
    if (!password) return badRequest({ password: "Onaylamak için şifrenizi girin." });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, twoFactorEnabledAt: true, twoFactorSecret: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!ok) {
      await noteReauthFailure(session, "account_delete");
      return badRequest({ password: "Şifre hatalı." });
    }

    // 🚨 ÖDEME ABONELİĞİ KAPISI — FAIL-CLOSED (Codex denetimi, 08-01 — madde 2).
    //
    // Silme yolu Paddle'a HİÇBİR iptal çağrısı YAPMAZ (`deleteAccountData` yalnız
    // webhook redaksiyonu + org silme yapar). Silmeye izin vermek, ödeyen host'un
    // kartından çekilmeye DEVAM edilmesi ve iptalin tek yolu olan "Aboneliği
    // yönet" düğmesinin artık giremediği hesabın içinde kalması demekti — müşteri
    // kendi kendine duramıyordu.
    //
    // Otomatik iptal para hot-path'i + ürün kararıdır → YAPILMAZ. Doğru davranış
    // engellemek ve önce iptali istemektir.
    //
    // ⚠️ FAIL-CLOSED İKİ YÖNDE:
    //   · Sağlayıcıya bağlı (gerçek tahsilat üretebilen) bir abonelik satırı varsa
    //     ve durumu KESİN olarak bitmiş değilse → ENGELLE. Tanınmayan/yeni bir
    //     sağlayıcı durumu da "belirsiz" sayılır ve engellenir (allowlist mantığı:
    //     yalnız KESİN bitmiş durumlar geçer, blocklist değil).
    //   · Yerel durumu OKUYAMAZSAK (DB hatası) → yine ENGELLE. Belirsizlikte
    //     geri alınamaz bir silme yapılmaz.
    const blocked = await hasBillableSubscription(session.organizationId);
    if (blocked) {
      return NextResponse.json({ error: BILLABLE_BLOCK_TEXT }, { status: 409 });
    }
    // 🚨 SONUÇLANMAMIŞ ÖDEME KAPISI (Codex 11-25 ikinci rapor, K5): abonelik kapısı yalnız YEREL abonelik satırına bakıyordu. Ödemesi alınmış
    // ama aboneliği henüz bağlanmamış işletme ("ödeme alındı" kaydı, `checkout-paid.ts`) ya da sonucu belli olmayan açık ödeme işlemi olan
    // işletme silinebiliyordu: kayıt hesapla birlikte kademeyle gidiyor, para alınmış ama uzlaştırılacak iz kalmıyordu. Silme BEKLETİLİR.
    const paymentPending = await pendingPaymentText(session.organizationId);
    if (paymentPending) {
      return NextResponse.json({ error: paymentPending }, { status: 409 });
    }

    // 🚨 U11 (kurucu 10-22: "Dediğin gibi olabilir"): 2FA AÇIKSA geri dönüşsüz silme doğrulama KODU da ister. Eskiden yalnız şifre
    // yetiyordu — şifresi sızmış ama 2FA'lı bir hesap, ele geçirilmiş oturumla kalıcı olarak silinebiliyordu. Kod TÜKETİLİR (giriş ve
    // 2FA kapatma rotasıyla aynı desen: koşullu yazma, aynı kod ikinci kez kullanılamaz); hata ortak günlük tavana sayılır. Sır
    // çözülemezse güvenli taraf: silme YOK (operatör 2FA sıfırlaması gerekir). Abonelik kapısından SONRA (Haiku 10-22): 409 dönecek silmede
    // kod boşuna yanmasın. Kurtarma kodu burada geçmez (2FA kapatma ile aynı; telefonu kaybeden sahip önce girişte kurtarma koduyla girip
    // 2FA'yı yeniden kurar).
    if (user?.twoFactorEnabledAt) {
      const code = typeof data?.code === "string" ? data.code.replace(/\s+/g, "") : "";
      if (!code) return badRequest({ code: "Silmek için doğrulama uygulamanızdaki kodu girin." });
      let secret: string | null = null;
      try {
        secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : null;
      } catch {
        secret = null;
      }
      if (!secret) {
        void reportError("account.delete 2fa-secret-undecryptable", new Error(`userId=${session.userId}`));
        return badRequest({ code: "Doğrulama anahtarınız okunamıyor; silme yapılamadı. Bize ulaşın." });
      }
      const step = verifyTotpStep(secret, code);
      const burned =
        step === null
          ? { count: 0 }
          : await prisma.user.updateMany({
              where: { id: session.userId, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
              data: { twoFactorLastStep: step },
            });
      if (burned.count === 0) {
        await noteReauthFailure(session, "account_delete");
        return badRequest({ code: "Kod hatalı, süresi geçmiş ya da az önce kullanıldı. Uygulamadaki yeni kodu girin." });
      }
    }

    // 🚨 U41 + U42 (Codex 10-07): parola ve abonelik denetimi işlem DIŞINDA yapıldı; arada parola sıfırlanabilir (oturum sürümü artar)
    // ya da ödeme olayı aktif abonelik yazabilir. Silme işleminin İLK adımı (org satırı kilitliyken) ikisini yeniden doğrular; tutmuyorsa
    // HİÇBİR şey silinmez.
    const epoch = session.sessionEpoch;
    let paymentPendingInTx: string | null = null;
    const outcome = await deleteAccountData(session.organizationId, {
      precondition: async (tx) => {
        const owner = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "User"
          WHERE "id" = ${session.userId} AND "organizationId" = ${session.organizationId}
            AND "role" = 'owner' AND "sessionEpoch" = ${epoch}
          FOR UPDATE`;
        if (owner.length === 0) return "session_revoked";
        // Opus F2 (10-16): abonelik satırı da KİLİTLENİR. Ödeme olayının güncellemesi işletme satırının kilidine takılmaz (yabancı anahtar
        // değişmiyor); kilitsiz okumadan SONRA, kademeli silmeden ÖNCE commit olan ödemeli güncelleme "işlendi" sayılıp alarmsız düşüyordu.
        // Kilitle: güncelleme bu silmenin sonucunu bekler → satır gitmiş → 0 satır → işletme yok → alarm + inceleme (webhook S2 dalı). Ters
        // sırada (güncelleme önce commit) bu okuma güncel durumu görür → 409.
        await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "organizationId" = ${session.organizationId} FOR UPDATE`;
        if (await hasBillableSubscription(session.organizationId, tx)) return "billable_subscription";
        // Ödeme kayıtları da KİLİTLENİR (K5): kapanmış niyetin işlemi sonradan ödenirse satır "ödeme alındı"ya geçer — o güncelleme bu
        // silmenin sonucunu bekler (satır gitmiş → 0 satır → onay kaydı da yok → web kancası "bağlanamayan ödeme" alarmı). Yeni satır
        // eklemesi işletme satırının kilidine zaten takılır (yabancı anahtar). Ters sırada (ödeme önce commit) okuma güncel durumu görür → 409.
        await tx.$queryRaw`SELECT "id" FROM "CheckoutIntent" WHERE "organizationId" = ${session.organizationId} FOR UPDATE`;
        const pending = await pendingPaymentText(session.organizationId, tx);
        if (pending) {
          paymentPendingInTx = pending;
          return "payment_pending";
        }
        return null;
      },
    });
    if (!outcome.deleted) {
      if (outcome.reason === "billable_subscription") {
        return NextResponse.json({ error: BILLABLE_BLOCK_TEXT }, { status: 409 });
      }
      if (outcome.reason === "payment_pending") {
        return NextResponse.json({ error: paymentPendingInTx ?? PAYMENT_PENDING_BLOCK_TEXT }, { status: 409 });
      }
      return unauthorized();
    }
    await clearSessionCookie(); // the account is gone — drop the session too
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}

/**
 * Bu org'un GERÇEK TAHSİLAT üretebilecek bir aboneliği var mı?
 *
 * Sağlayıcı bazlı: yalnız dış bir ödeme sağlayıcısına bağlı satırlar tahsilat
 * üretir. `trial`/`manual` satırlar iç kayıttır — onları engellemek müşteriyi
 * sebepsiz kilitlerdi.
 *
 * ⚠️ ALLOWLIST, BLOCKLIST DEĞİL: yalnız KESİN olarak bitmiş sayılan durumlar
 * geçer. Sağlayıcı yarın yeni bir durum adı eklerse (ör. "paused") kod onu
 * "bilmiyorum" sayar ve ENGELLER — geri alınamaz bir silmede doğru yön budur.
 * ⚠️ Okuma hatasında da ENGELLER (fail-closed).
 */
const BILLABLE_BLOCK_TEXT =
  "Aktif bir ödeme aboneliğiniz görünüyor. Hesabı silmek aboneliği DURDURMAZ — " +
  "önce Faturalandırma → “Aboneliği yönet” bölümünden iptal edin, sonra tekrar deneyin.";

async function hasBillableSubscription(organizationId: string, db: Pick<typeof prisma, "subscription"> = prisma): Promise<boolean> {
  /** Tahsilat üretebilen sağlayıcılar (iç kayıtlar hariç). */
  const BILLING_PROVIDERS = ["paddle", "iyzico", "paytr"];
  /** KESİN bitmiş: bu durumlarda sağlayıcı bir daha çekim yapmaz. */
  const DEFINITELY_ENDED = new Set(["canceled", "cancelled", "expired"]);
  try {
    const subs = await db.subscription.findMany({
      where: { organizationId, provider: { in: BILLING_PROVIDERS } },
      select: { status: true, cancelAtPeriodEnd: true },
    });
    // ⚠️ `cancelAtPeriodEnd` DA "bitmiş" sayılır (bağımsız denetim, 08-01).
    // Paddle portalından yapılan iptal DÖNEM SONUNA planlanır: webhook bunu
    // `cancelAtPeriodEnd: true` olarak yazar ama `status` "active" KALIR. Bunu
    // görmezsek ZATEN İPTAL ETMİŞ müşteri 409 alır ve mesaj ona yaptığı şeyi
    // TEKRAR yapmasını söyler — yıllık planda ~12 ay sürebilecek çıkışsız bir
    // döngü. O hâlde sağlayıcı yeni tahsilat YAPMAZ, yani engellemenin gerekçesi
    // ortadan kalkar. (Alan üç yerde yazılıyordu ama hiçbir yerde okunmuyordu.)
    return subs.some((s) => !DEFINITELY_ENDED.has(s.status) && !s.cancelAtPeriodEnd);
  } catch {
    return true; // durumu okuyamıyoruz → geri alınamaz silme YAPILMAZ
  }
}

/**
 * SONUÇLANMAMIŞ ÖDEME (K5, Codex 11-25 ikinci rapor): silmeyi bekleten ödeme durumu varsa müşteriye gösterilecek metin, yoksa null.
 *  · "ödeme alındı, abonelik bekleniyor" kaydı (`CheckoutIntent` "completed") — süreyle kapanmaz; ancak bağlanınca / kanıtla bırakılınca
 *    silme açılır. Niyet anahtarı kapalıyken de yazılır (işlem olayı / doğrulanmış istemci sinyali).
 *  · açık / açılmakta olan ödeme işlemi (niyet anahtarı açıkken) — sonucu belli olana dek (ödenir → yukarıdaki kayıt; iptali doğrulanır →
 *    kapanır).
 *  · 10 dakikalık "ödemeniz işleniyor" kilidi (ödeme ekranı "tamamlandı" dedi, sunucu henüz görmedi).
 * Metin üç durumda da AYNI ve silmeye özgü (kurucu 11-25 gece: "Silmeye özgü metin") — ↓`PAYMENT_PENDING_BLOCK_TEXT`.
 * ⚠️ Okuma hatasında da BEKLETİR (fail-closed — geri alınamaz silme belirsizlikte yapılmaz).
 */
async function pendingPaymentText(
  organizationId: string,
  db: Pick<typeof prisma, "checkoutIntent" | "systemLock"> = prisma,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const rows = await db.checkoutIntent.findMany({
      where: { organizationId, status: { in: [CHECKOUT_PAID_STATUS, "open", "opening"] } },
      select: { status: true },
      take: 10,
    });
    if (rows.length > 0) return PAYMENT_PENDING_BLOCK_TEXT;
    const lock = await db.systemLock.findUnique({ where: { name: checkoutPendingLockName(organizationId) }, select: { lockedUntil: true } });
    if (lock && lock.lockedUntil > now) return PAYMENT_PENDING_BLOCK_TEXT;
    return null;
  } catch {
    return PAYMENT_PENDING_BLOCK_TEXT; // durumu okuyamıyoruz → geri alınamaz silme YAPILMAZ
  }
}

/** Silme ekranında gösterilen metin (kurucu onayı 11-25 gece, AYNEN). */
const PAYMENT_PENDING_BLOCK_TEXT = "Bekleyen bir ödemeniz var. Ödeme sonuçlanınca hesabınızı silebilirsiniz; acil ise bize yazın.";
