import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, forbidden, badRequest, jsonOk, serverError, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
// ⚠️ `verifyTotp` (boole) BİLİNÇLİ OLARAK İMPORT EDİLMİYOR: bu rotadaki üç
// doğrulama yolu da kodu TÜKETMEK zorunda, o yüzden hepsi `verifyTotpStep` +
// koşullu `updateMany` kullanır. Geri eklemek yakma adımını atlamayı kolaylaştırır.
import { generateSecret, otpauthUri, verifyTotpStep } from "@/lib/auth/totp";
import {
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from "@/lib/auth/recovery-codes";
import { verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";

// An ACTIVE 2FA whose stored secret no longer decrypts is a SYSTEM fault, never
// a user mistake — hiding it behind "wrong code" sends the owner into a retry
// loop no code can ever end (lived on 07-30). Say what it is, and page the
// operator: the fix is the admin reset-2fa escape hatch, not another attempt.
// Still fail-closed — the broken state never allows disable/minting either.
const SECRET_UNREADABLE_MSG =
  "Sistem, kayıtlı 2FA anahtarını çözemiyor — kod doğru olsa da işlem yapılamaz. Operatöre başvurun (2FA sıfırlama gerekir).";

function reportUnreadableSecret(userId: string) {
  void reportError("account.2fa secret-undecryptable", new Error(`userId=${userId}`));
}

// ---------------------------------------------------------------------------
// Two-factor auth (authenticator app) management for the signed-in user.
//   GET                       → { enabled }
//   POST { action:"setup" }   → make a secret (stored encrypted, NOT yet active),
//                               return { secret, otpauthUri } for the app/QR.
//   POST { action:"enable", code } → confirm a first code → 2FA becomes active.
//   POST { action:"disable", code } → confirm a code → turn 2FA off.
// 2FA is only ever ACTIVE once enabled, so an abandoned setup can't lock you out.
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabledAt: true },
  });
  const enabled = Boolean(user?.twoFactorEnabledAt);
  return jsonOk({
    enabled,
    // Unused single-use recovery codes left (0 also when 2FA is off).
    recoveryRemaining: enabled ? await remainingRecoveryCodes(session.userId) : 0,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  // ⚠️ IMPERSONATION ALTINDA 2FA YÖNETİLEMEZ (denetim, 08-01).
  //
  // Impersonation'da `session.userId` MÜŞTERİNİN kullanıcısıdır (`admin.ts`
  // oturumu öyle imzalar). Kapı olmadığında operatör, 2FA'sı KAPALI bir müşteri
  // hesabında `setup` → gizli anahtarı DÜZ METİN olarak kendi alır → `enable`
  // ile etkinleştirebiliyordu. Müşteriye hiçbir doğrulama gitmiyor, kurtarma
  // kodları da `enable` içinde siliniyor → müşteri kendi hesabına bir daha
  // GİREMEZ ve erişimi tamamen operatöre bağlı hâle gelir.
  //
  // Impersonation'ın kabul edilmiş sınırı "operatör müşteri gibi ÇALIŞABİLİR";
  // oturum bittikten sonra da yaşayan KALICI BİR KİMLİK BİLGİSİ yaratmak o
  // modelin dışındadır. Aynı kapı `account/delete` rotasında zaten var (emsal).
  //
  // Meşru destek yolu KAPANMIYOR: müşteri telefonunu kaybettiyse operatörün
  // ayrı, süper-admin kapılı ve denetlenen yolu var → POST /api/admin/reset-2fa.
  // GET (durum okuma) serbest kalır — operatör 2FA'nın açık olup olmadığını
  // görebilmeli.
  if (session.actorUserId) {
    return forbidden(
      "İşletme hesabındayken (impersonation) iki adımlı doğrulama yönetilemez. " +
        "Müşteri erişimini kaybettiyse operatör panelinden 2FA sıfırlama kullanın.",
    );
  }
  // Throttle 2FA management (enable/disable code attempts) — anti code brute-force.
  const limited = await rateLimit(`2fa:${session.userId}`, 10, 10 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  try {
    const data = await readJsonCappedOrNull(req);
    const action = typeof data?.action === "string" ? data.action : "";
    const code = typeof data?.code === "string" ? data.code : "";

    if (action === "setup") {
      // Guard: never let "setup" run on an already-active account. Setup writes
      // twoFactorEnabledAt: null (re-keying), which would silently DISABLE live
      // 2FA with no code — so a hijacked session could turn 2FA off. To re-key,
      // the user must first "disable" (which requires a valid current code).
      const current = await prisma.user.findUnique({
        where: { id: session.userId },
        // Tek satır, tek gidiş-dönüş: parola kontrolü de aynı satırı istiyor.
        select: { twoFactorEnabledAt: true, passwordHash: true },
      });
      if (current?.twoFactorEnabledAt) {
        return badRequest({
          _: "İki adımlı doğrulama bu hesapta daha önce açılmış ve şu an etkin. Yeniden kurmak için önce mevcut kodunuzla kapatın.",
        });
      }
      // 🚨 YENİDEN KİMLİK DOĞRULAMA — SIRRI BASMADAN ÖNCE ŞİFRE (denetim 08-09).
      //
      // Bu dal DÜZ METİN TOTP sırrını döndürüyor ve `enable` onu etkinleştirip
      // AYNI transaction'da tüm kurtarma kodlarını siliyor. Kapı yokken ele
      // geçirilmiş bir oturumla İKİ istek yetiyordu ve oluşan kilitlenme
      // kurbanın ŞİFRE SIFIRLAMASINDAN SAĞ ÇIKIYOR — sıfırlama
      // `twoFactorEnabledAt`/`twoFactorSecret`'a DOKUNMUYOR. Kurban kurucuysa
      // kurtarma dairesel olarak kapanıyor: `admin/reset-2fa` süper-admin
      // istiyor, `isSuperAdmin` ise `session.mfa === true` istiyor, o da artık
      // kontrol edemediği faktörden geçmeyi gerektiriyor.
      //
      // Asimetri düzeltiliyor: hesap SİLME şifre istiyor (`account/delete`),
      // 2FA KAPATMA geçerli TOTP istiyor — yalnız en KALICI kimlik bilgisini
      // KURMAK hiçbir şey istemiyordu. Emsal birebir `account/delete`ten alındı.
      //
      // ⚠️ Kapı `enable`e DEĞİL `setup`a kondu: sırrı üreten ve düz metin
      // döndüren yol burası. `enable` zaten o sırra ait geçerli bir TOTP kodu
      // istiyor, yani sırrı görmeyen biri onu geçemez — şifreyi iki kez sormak
      // meşru kullanıcıya bedel, saldırgana engel değil.
      const password = typeof data?.password === "string" ? data.password : "";
      if (!password) {
        return badRequest({ password: "Devam etmek için hesap şifrenizi girin." });
      }
      const reauthOk = current?.passwordHash
        ? await verifyPassword(password, current.passwordHash)
        : false;
      if (!reauthOk) return badRequest({ password: "Şifre hatalı." });

      const secret = generateSecret();
      // 🚨 YAZMA KOŞULLU — YARIŞI DARALTMA, KAPAT (denetim 08-09).
      // Yukarıdaki "zaten etkin mi" okuması ile bu yazma arasında artık bir
      // bcrypt karşılaştırması var (~350 ms ölçüldü), yani pencere ~100 kat
      // büyüdü. Koşulsuz yazmada kaybedilen yarışın bedeli ağır: sekme A
      // kapıdan geçer → bcrypt → sekme B `enable` ile 2FA'yı AÇAR → sekme A
      // `twoFactorEnabledAt: null` yazıp CANLI 2FA'yı sessizce KAPATIR.
      // Saldırı değil kaza yolu (buraya gelen zaten parolayı biliyor), ama
      // sonucu "2FA açık sanılan kapalı hesap" — sessiz ve tehlikeli.
      // WHERE'e koşul koymak yarışı tamamen ortadan kaldırıyor.
      const armed = await prisma.user.updateMany({
        where: { id: session.userId, twoFactorEnabledAt: null },
        data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: null },
      });
      if (armed.count === 0) {
        return badRequest({
          _: "İki adımlı doğrulama bu hesapta daha önce açılmış ve şu an etkin. Yeniden kurmak için önce mevcut kodunuzla kapatın.",
        });
      }
      return jsonOk({ secret, otpauthUri: otpauthUri(secret, session.email) });
    }

    if (action === "enable") {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true },
      });
      if (!user?.twoFactorSecret) return badRequest({ _: "Önce kurulum başlatın." });
      const armedSecret = user.twoFactorSecret;
      const secret = decryptSecret(armedSecret);
      const step = verifyTotpStep(secret, code);
      if (step === null) return badRequest({ code: "Kod hatalı veya süresi geçmiş." });
      // 🚨 KOŞULLU YAZMA — kardeşi `setup` ile aynı desen (denetim, 08-09).
      // Eskiden bu bir KOŞULSUZ `update` idi ve İKİ arıza üretiyordu:
      // (1) ZATEN AÇIK bir hesapta çağrılınca `twoFactorEnabledAt`i sessizce
      //     tazeliyordu — o damga trusted-device epoch'u olduğu için hatırlanan
      //     TÜM cihazlar düşüyor ve kurtarma kodları siliniyordu;
      // (2) eşzamanlı `disable` ile yarışınca kurtarılamaz duruma sokuyordu:
      //     `disable` secret'i null'lar, ardından bu yazma `twoFactorEnabledAt`i
      //     doldurur → 2FA "açık" ama secret YOK ve kurtarma kodu YOK; giriş her
      //     kodu reddeder, çıkış yalnız operatörün `admin/reset-2fa`sı.
      // WHERE hem "henüz açık değil" hem "DOĞRULADIĞIM secret hâlâ yerinde"
      // koşulunu pinler → yarışın kaybeden bacağı hiçbir şey yazmaz.
      // ⚠️ ETKİLEŞİMLİ TX ŞART, dizi biçimi DEĞİL: dizi biçiminde `deleteMany`
      // koşuldan BAĞIMSIZ koşar, yani yarışın KAYBEDEN bacağı KAZANANIN taze
      // kurtarma kodlarını silerdi. Etkileşimli biçim hem koşulu okuyabiliyor
      // hem de "kur + bayat kodları sil" ikilisini atomik tutuyor (orijinal
      // transaction'ın koruduğu değişmez: 2FA asla canlı bayat kodlarla açık
      // kalmaz).
      const armedCount = await prisma.$transaction(async (tx) => {
        const r = await tx.user.updateMany({
          where: { id: session.userId, twoFactorEnabledAt: null, twoFactorSecret: armedSecret },
          // Record the step so the enabling code can't be replayed at login.
          data: { twoFactorEnabledAt: new Date(), twoFactorLastStep: step },
        });
        if (r.count === 0) return 0;
        // Defense-in-depth: a FRESH activation starts with ZERO recovery codes.
        // If a past disable's clear step ever failed midway, stale codes must
        // not resurrect as valid second factors under the new secret.
        await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: session.userId } });
        return r.count;
      });
      if (armedCount === 0) {
        return badRequest({ _: "Kurulum durumu değişti. Sayfayı yenileyip kurulumu yeniden başlatın." });
      }
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_enable",
        metadata: { targetUserId: session.userId },
      });
      return jsonOk({ ok: true, enabled: true });
    }

    if (action === "disable") {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      // FAIL-CLOSED: a hijacked session without the authenticator must NOT be able
      // to disable 2FA. Always require a valid current code. If the secret can't be
      // decrypted (should never happen — ENCRYPTION_KEY doesn't rotate), refuse
      // rather than silently allowing disable — and an undecryptable secret would
      // already block login (same verify), so this doesn't make recovery worse.
      if (user?.twoFactorEnabledAt) {
        let secret: string | null = null;
        if (user.twoFactorSecret) {
          try {
            secret = decryptSecret(user.twoFactorSecret);
          } catch {
            secret = null;
          }
        }
        if (!secret) {
          reportUnreadableSecret(session.userId);
          return badRequest({ code: SECRET_UNREADABLE_MSG });
        }
        // 🚨 KODU YAK — SADECE DOĞRULAMA YETMEZ (denetim, 08-09). Buradaki eski
        // `verifyTotp` bir boole döndürüyordu: hiçbir şey okumuyor, hiçbir şey
        // yazmıyordu. Oysa `login` aynı kodu ATOMİK olarak tüketiyor. Sonuç,
        // deponun "TOTP replay-korumalı" iddiasının YALNIZ giriş için doğru
        // olmasıydı: ±1 pencere yüzünden tek bir kod ~89 saniye geçerli kalır ve
        // o pencerede ele geçirilen bir kod, giriş için kullanıldıktan SONRA
        // ikinci bir kez BURADA kullanılıp faktörü tamamen kaldırabiliyordu.
        // Bahis en yüksek olan iki rota (faktörü silme · kalıcı bypass üretme)
        // korumasızdı. Desen `login/route.ts`den BİREBİR: koşullu `updateMany`,
        // `count === 0` → kod zaten tüketilmiş → red.
        const step = verifyTotpStep(secret, code);
        if (step === null) {
          return badRequest({ code: "Kapatmak için geçerli bir kod girin." });
        }
        const burned = await prisma.user.updateMany({
          where: {
            id: session.userId,
            OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }],
          },
          data: { twoFactorLastStep: step },
        });
        // Aynı hata metni: dışarıdan "kod yanlış" ile "kod zaten kullanıldı"
        // ayırt EDİLEMEZ (giriş rotasının aynı kararı).
        if (burned.count === 0) {
          return badRequest({ code: "Kapatmak için geçerli bir kod girin." });
        }
      }
      // ONE transaction: recovery codes are a 2FA artifact and must die WITH it.
      // Two separate awaits had a gap — if the clear failed after the update,
      // 2FA was off with live codes on disk, and a later re-enable would have
      // resurrected them as valid second factors (diff-review finding).
      await prisma.$transaction([
        prisma.user.update({
          where: { id: session.userId },
          data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null },
        }),
        prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: session.userId } }),
      ]);
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_disable",
        metadata: { targetUserId: session.userId },
      });
      return jsonOk({ ok: true, enabled: false });
    }

    if (action === "recovery_codes") {
      // (Re)generate the single-use recovery code set. Same bar as "disable":
      // 2FA must be ACTIVE and a CURRENT code is required — minting codes is a
      // future 2FA bypass, so a hijacked session alone must not be enough.
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      if (!user?.twoFactorEnabledAt) {
        return badRequest({ _: "Kurtarma kodlarını görüntülemek için önce iki adımlı doğrulamayı etkinleştirin." });
      }
      let secret: string | null = null;
      if (user.twoFactorSecret) {
        try {
          secret = decryptSecret(user.twoFactorSecret);
        } catch {
          secret = null;
        }
      }
      if (!secret) {
        reportUnreadableSecret(session.userId);
        return badRequest({ code: SECRET_UNREADABLE_MSG });
      }
      // 🚨 KODU YAK (↑`disable` ile aynı gerekçe, 08-09). Bu rota KALICI bypass
      // üretiyor: 10 tek-kullanımlık kurtarma kodu, yani ele geçirilen TEK bir
      // TOTP kodunun karşılığı 10 gelecekteki ikinci-faktör atlaması. Yakma
      // olmadan aynı kod hem giriş için hem burada kullanılabiliyordu.
      const step = verifyTotpStep(secret, code);
      if (step === null) {
        return badRequest({ code: "Geçerli bir doğrulama kodu girin." });
      }
      const burned = await prisma.user.updateMany({
        where: {
          id: session.userId,
          OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }],
        },
        data: { twoFactorLastStep: step },
      });
      if (burned.count === 0) {
        return badRequest({ code: "Geçerli bir doğrulama kodu girin." });
      }
      // Regeneration atomically invalidates every previous code.
      const codes = await regenerateRecoveryCodes(session.userId);
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.actorUserId ?? session.userId,
        action: "account.2fa_recovery_generate",
        metadata: { targetUserId: session.userId, count: RECOVERY_CODE_COUNT },
      });
      // The ONLY place the plaintexts ever leave the server — shown once.
      return jsonOk({ ok: true, codes, recoveryRemaining: codes.length });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
