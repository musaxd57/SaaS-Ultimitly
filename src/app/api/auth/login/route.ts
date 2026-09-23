import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema, zodFieldErrors } from "@/lib/validators";
import { verifyPassword, dummyVerifyPassword } from "@/lib/auth/password";
import { setSessionCookie, hasTrustedDevice, setTrustedDeviceCookie, setKnownDeviceCookie } from "@/lib/auth";
import {
  badRequest,
  jsonOk,
  serverError,
  parseJsonBody,
  payloadTooLarge,
  tooManyRequests,
  hasJsonContentType,
  unsupportedMediaType,
} from "@/lib/api";
import { rateLimit, rateLimitPeek, clientIp } from "@/lib/rate-limit";
import { KNOWN_DEVICE_COOKIE, verifyKnownDeviceToken } from "@/lib/auth/known-device";
import { decryptSecret } from "@/lib/crypto";
import { verifyTotpStep } from "@/lib/auth/totp";
import { consumeRecoveryCode, remainingRecoveryCodes } from "@/lib/auth/recovery-codes";
import { writeAudit } from "@/lib/audit";
import { needsEmailVerification } from "@/lib/auth/email-verify";
import type { UserRole } from "@/lib/constants";
import { normalizeEmail } from "@/lib/email-identity";

/** Hesap başına başarısız PAROLA denemesi (15 dk pencere). Peek ve tüketim AYNI sabiti kullanır. */
const LOGIN_ACCT_LIMIT = 20;
const LOGIN_ACCT_WINDOW_MS = 15 * 60 * 1000;
/** Kullanıcı başına 24 saatte başarısız TOTP kodu tavanı (↓ikinci-faktör dalı). */
const LOGIN_2FA_DAILY_FAILURES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const ACCT_LOCKED_MESSAGE = "Bu hesap için çok fazla deneme. Lütfen biraz sonra tekrar deneyin.";

export async function POST(req: NextRequest) {
  try {
    // 🚨 JSON DEĞİLSE IP KOVASINA DOKUNMADAN REDDET (09-23, login ajanı F8). Kova önce
    // tüketiliyordu: başka bir site ziyaretçinin tarayıcısından CORS'suz `text/plain`
    // POST'larla kurbanın (ya da bir ofis/mobil NAT'ının) IP kovasını yakıp onu 5 dk
    // girişten dışarıda bırakabiliyordu. Gerekçe `hasJsonContentType`te.
    if (!hasJsonContentType(req)) return unsupportedMediaType();

    // Throttle login attempts per IP: 10 tries / 5 minutes (anti brute-force).
    const limited = await rateLimit(`login:${clientIp(req)}`, 10, 5 * 60 * 1000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    const bodyResult = await parseJsonBody(req);
    if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
    const data = bodyResult.ok ? bodyResult.data : null;
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const email = normalizeEmail(parsed.data.email);
    // ⚠️ HESAP KOVASI BURADA DEĞİL, DOĞRULAMADAN SONRA DEĞERLENDİRİLİR.
    // (Codex denetimi, 08-01 — madde 1.) Kovayı burada KAPI olarak kullanmak,
    // kaba kuvvet korumasını bir HİZMET ENGELLEME silahına çeviriyordu: kurbanın
    // e-postasını bilen biri yalnızca HATALI parolalarla kovayı doldurup hesabı
    // kilitleyebiliyor, kurban DOĞRU parolasıyla bile 429 alıyordu.
    //
    // Doğru sözleşme: doğru parola sahibi hesap kovası yüzünden ASLA
    // kilitlenmez; kova YALNIZCA başarısız denemeleri sınırlar (↓aşağıda).
    // IP kovası (yukarıda) değişmedi ve her istekte tüketilmeye devam ediyor.
    //
    // ⚠️ BİLİNÇLİ TAKAS: kapı aşağı indiği için tavanı aşmış bir saldırgan artık
    // istek başına bir bcrypt maliyeti doğuruyor (eskiden kapıda kesiliyordu).
    // Tek-IP senaryosunu IP kovası zaten kapatıyor; IP döndüren saldırgan bu
    // maliyeti öder ama kurbanı KİLİTLEYEMEZ — doğru yön budur.
    const user = await prisma.user.findUnique({ where: { email } });

    // 🚨 TANINAN CİHAZ KAPISI (09-23, login ajanı F1 — ↓08-01 kararını BOZMADAN tamamlar).
    // Hesap kovası yalnız başarısız denemeleri sayıyor ve dolunca yalnız YANLIŞ parolayı
    // durduruyordu; DOĞRU parola her IP'den giriyordu. IP döndüren saldırgan için tek fren
    // bcrypt hızıydı (~günde 270 bin tahmin, tek hesaba; ölçülen modelde doğru parola
    // 4.322. denemede kabul edildi). Kova DOLUYKEN artık parola denemesine yalnız bu
    // hesaba daha önce BAŞARIYLA girmiş tarayıcı (`KNOWN_DEVICE_COOKIE`) devam eder:
    //   · hesap sahibi kendi cihazında KİLİTLENMEZ (08-01'in özü korunur),
    //   · yeni IP'deki saldırgan bcrypt'e bile ULAŞMAZ (CPU DoS'u da hafifler),
    //   · bedel: saldırı sürerken sahibin YENİ cihazı pencere (≤15 dk) dolana kadar bekler.
    // ⚠️ SAYIM SIZINTISI YOK: kova doluyken çerezsiz istek — hesap var ya da yok — AYNI hızlı
    // 429'u alır (bilinmeyen e-posta da kovayı doldurur, ↓). Kova dolu değilken akış birebir eski.
    const acctPeek = await rateLimitPeek(`login-acct:${email}`, LOGIN_ACCT_LIMIT);
    if (!acctPeek.ok) {
      const known = user
        ? await verifyKnownDeviceToken(req.cookies.get(KNOWN_DEVICE_COOKIE)?.value, user.id, user.sessionEpoch)
        : false;
      if (!known) {
        return NextResponse.json(
          { error: ACCT_LOCKED_MESSAGE },
          { status: 429, headers: { "Retry-After": String(acctPeek.retryAfter) } },
        );
      }
    }

    // Constant-time: ALWAYS spend one bcrypt comparison. When the email is
    // unknown there is no hash to check, so compare against a fixed dummy hash
    // instead — otherwise the fast "no user" path leaks (by response latency)
    // which emails are registered (user enumeration).
    let ok = false;
    if (user) {
      ok = await verifyPassword(parsed.data.password, user.passwordHash);
    } else {
      await dummyVerifyPassword(parsed.data.password);
    }
    if (!user || !ok) {
      // ⚠️ HESAP KOVASI YALNIZ BURADA — BAŞARISIZ DOĞRULAMADA — TÜKETİLİR.
      // Böylece kaba kuvvet koruması aynen çalışır ama meşru kullanıcı kendi
      // hesabından KİLİTLENEMEZ ve üçüncü bir taraf sırf e-postayı bilerek kurbanı
      // giriş dışı bırakamaz. Bilinmeyen e-posta da sayılır: aksi hâlde sayacın
      // varlığı hesabın VARLIĞINI sızdırırdı (enumeration).
      //
      // ⚠️ KAPSAM (silinen yorumdan taşındı): bu kova PAROLA denemelerini sayar.
      // 2FA/kurtarma kodu denemeleri bu dala HİÇ girmez (parola doğru olduğu için)
      // — yani hesap-bazlı bir TOTP sınırı YOK. Eski `peek` kapısı da TOTP
      // hatalarıyla dolmuyordu, yani bu bir REGRESYON DEĞİL; ama tek dokümantasyonu
      // silinmişti. Ayrı bir `login-2fa:{userId}` kovası açık iş olarak kayıtlı
      // (`docs/MIGRATION-BEKLEYEN-ISLER.md`).
      const acct = await rateLimit(`login-acct:${email}`, LOGIN_ACCT_LIMIT, LOGIN_ACCT_WINDOW_MS);
      // Record a failed attempt against a KNOWN account (targeted-attack signal).
      // Unknown emails have no org to scope to — the rate limiter covers those.
      if (user) {
        await writeAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.login_failed",
          metadata: { reason: "bad_password", ip: clientIp(req) },
        });
      }
      // Tavan aşıldıysa YANLIŞ kimlik bilgisi 429 alır — kaba kuvvet koruması
      // burada duruyor. DOĞRU parola bu dala hiç girmediği için etkilenmez.
      if (!acct.ok) {
        return NextResponse.json(
          { error: ACCT_LOCKED_MESSAGE },
          { status: 429, headers: { "Retry-After": String(acct.retryAfter) } },
        );
      }
      return NextResponse.json({ error: "E-posta veya şifre hatalı" }, { status: 401 });
    }

    // E-mail verification gate — ONLY for self-serve accounts created at/after the
    // cutoff. Every pre-existing account (the founder, staff, operator-created
    // customers) is exempt, so this can never lock out a current user.
    if (needsEmailVerification(user)) {
      return NextResponse.json(
        {
          error:
            "E-postanızı doğrulamanız gerekiyor. Kayıt sırasında gönderdiğimiz doğrulama bağlantısına tıklayın.",
          needsVerification: true,
        },
        { status: 403 },
      );
    }

    // Second factor (authenticator app), when enabled for this account. The
    // password is correct at this point; we still withhold the session until a
    // valid 6-digit code is supplied — UNLESS this is a remembered ("trusted")
    // device, in which case the code is skipped for 30 days. The password is
    // re-sent with the code, so no server-side pending state is needed.
    // The trusted-device cookie is bound to this epoch, so resetting 2FA
    // (disable→re-enable) invalidates every previously-remembered device.
    const twoFaEpoch = user.twoFactorEnabledAt ? user.twoFactorEnabledAt.getTime() : 0;
    let trustedDevice = false;
    if (user.twoFactorEnabledAt) {
      // Fail-closed: any error reading the trusted-device cookie → ask for 2FA.
      // ⚠️ `user.sessionEpoch` EK SORGU DEĞİL: yukarıdaki `findUnique` `select`SİZ
      // çağrılıyor, yani tam satır zaten bellekte (aynı değer `:215`te oturum
      // imzalanırken de kullanılıyor). Şifre sıfırlama/değiştirme bu epoch'u
      // artırdığı için "beni hatırla" güveni o anda kendiliğinden düşer.
      trustedDevice = await hasTrustedDevice(user.id, twoFaEpoch, user.sessionEpoch);
      if (!trustedDevice) {
        const code = parsed.data.code?.trim() ?? "";
        const recoveryCode = parsed.data.recoveryCode?.trim() ?? "";
        if (!code && !recoveryCode) {
          // Tell the client to prompt for the code (no session issued yet).
          return jsonOk({ twoFactorRequired: true });
        }
        // 🚨 HESAP BAŞINA İKİNCİ-FAKTÖR KOTASI (denetim 08-09).
        //
        // `login-acct:{email}` kovası YALNIZ yanlış-PAROLA dalında tüketiliyor;
        // buraya parola DOĞRU olduğu için hiç girmiyordu → 6 haneli TOTP'ye
        // karşı hesap-bazlı SIFIR sınır. Parolayı ele geçiren biri proxy
        // havuzuyla per-IP kovasını dolaşıp kodu kaba kuvvetle deneyebiliyordu.
        // Bahis maksimum: `mfa` iddiası artık operatör yetkisinin TEK kapısı.
        //
        // ⚠️ DOĞRULAMADAN ÖNCE tüketilir — sonra tüketmek "önce doğrula, sonra
        // say" olurdu ve saldırgan her denemesinde yine karşılaştırma elde ederdi.
        // ⚠️ KURBAN KİLİTLEME VEKTÖRÜ AÇMAZ: bu dala ulaşmak DOĞRU PAROLA
        // gerektiriyor, yani kovayı yakabilen kişi zaten parolayı biliyor.
        // (`forgot-req:{email}` kovasındaki tuzak — saldırganın YAZDIĞI adrese
        // bağlı olması — burada YOK.)
        // ⚠️ Kova KULLANICI ID'siyle anahtarlanır, e-postayla değil: aynı hesaba
        // farklı yazımlarla (büyük/küçük harf) ayrı kova açılmasın.
        const second = await rateLimit(`login-2fa:${user.id}`, 10, 10 * 60_000);
        if (!second.ok) {
          return tooManyRequests(
            second.retryAfter,
            // ⚠️ SÜREYİ SÖYLE — deponun kendi 08-07 kuralı: genel "kısa bir süre"
            // metni kullanıcıyı boşuna tekrar denemeye itiyor. Pencere 10 dakika
            // ve kilitlenen kişi KENDİ hesabına giremiyor; belirsizlik pahalı.
            `Çok fazla doğrulama denemesi yapıldı. Yaklaşık ${Math.ceil(second.retryAfter / 60)} dakika sonra tekrar deneyin.`,
          );
        }
        // 🚨 GÜNLÜK BAŞARISIZ-TOTP TAVANI (09-23, login ajanı F3). 10/10 dk kovasının
        // TOPLAM tavanı yoktu: ±1 zaman adımıyla günde 1.440 deneme → parolayı bilen biri
        // için 6 haneli kodu bulma olasılığı 30 günde ~%12, bir yılda ~%79 (NIST 800-63B
        // §5.2.2 en fazla 100 ardışık hata der). Bu hesap için bahis operatör yetkisidir
        // (`mfa` iddiası). Tavan yalnız HATALARI sayar (başarılı kod tüketmez) ve yalnız
        // TOTP'ye uygulanır: kurtarma kodları yüksek entropili + tek kullanımlıktır, tahmin
        // edilemez — telefonunu kaybeden kullanıcıyı 24 saat kilitlemek yanlış yön olurdu.
        // Kilitleme vektörü AÇMAZ: bu dala ulaşmak doğru PAROLA ister.
        const totpDayKey = `login-2fa-fail-day:${user.id}`;
        if (!recoveryCode) {
          const day = await rateLimitPeek(totpDayKey, LOGIN_2FA_DAILY_FAILURES);
          if (!day.ok) {
            return tooManyRequests(
              day.retryAfter,
              "Bugün bu hesap için çok fazla hatalı doğrulama kodu girildi. Güvenliğiniz için kod girişi geçici olarak durduruldu; kurtarma kodunuzla giriş yapabilir ya da daha sonra tekrar deneyebilirsiniz.",
            );
          }
        }
        // Hatalı ikinci-adım denemesi: iz bırakır (eskiden SESSİZDİ — 08-08'de planlanan
        // `auth.2fa_failed` kaydı hiç yazılmamıştı) ve TOTP ise günlük tavana sayılır.
        const noteSecondFactorFailure = async (method: "totp" | "recovery") => {
          if (method === "totp") await rateLimit(totpDayKey, LOGIN_2FA_DAILY_FAILURES, DAY_MS);
          await writeAudit({
            organizationId: user.organizationId,
            actorUserId: user.id,
            action: "auth.2fa_failed",
            metadata: { method, ip: clientIp(req) },
          });
        };
        if (recoveryCode) {
          // Single-use recovery code as the second factor (lost/changed phone).
          // consumeRecoveryCode is the atomic arbiter — a used/foreign/garbled
          // code burns nothing and rejects; a valid one is dead from now on.
          const used = await consumeRecoveryCode(user.id, recoveryCode);
          if (!used) {
            await noteSecondFactorFailure("recovery");
            return NextResponse.json(
              { error: "Kurtarma kodu hatalı veya daha önce kullanılmış", twoFactorRequired: true },
              { status: 401 },
            );
          }
          // Security breadcrumb + a nudge signal: how many codes are left.
          await writeAudit({
            organizationId: user.organizationId,
            actorUserId: user.id,
            action: "account.2fa_recovery_used",
            metadata: { remaining: await remainingRecoveryCodes(user.id), ip: clientIp(req) },
          });
        } else {
          // Fail-soft: if the secret can't be decrypted (e.g. ENCRYPTION_KEY was
          // rotated after launch), don't 500 — treat it as an invalid code so the
          // response stays clean instead of crashing the login handler.
          let secret: string | null = null;
          try {
            secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : null;
          } catch {
            secret = null;
          }
          const step = secret ? verifyTotpStep(secret, code) : null;
          if (step === null) {
            await noteSecondFactorFailure("totp");
            return NextResponse.json(
              { error: "Doğrulama kodu hatalı", twoFactorRequired: true },
              { status: 401 },
            );
          }
          // Burn this step ATOMICALLY: the conditional updateMany only succeeds if
          // twoFactorLastStep is still null or older than this step, so two concurrent
          // logins with the SAME code can't both pass (the read-check-then-update
          // version had a replay race). count===0 → already consumed → reject.
          const burned = await prisma.user.updateMany({
            where: {
              id: user.id,
              OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }],
            },
            data: { twoFactorLastStep: step },
          });
          if (burned.count === 0) {
            // Aynı kodun İKİNCİ kullanımı (tekrar oynatma) da hatalı denemedir.
            await noteSecondFactorFailure("totp");
            return NextResponse.json(
              { error: "Doğrulama kodu hatalı", twoFactorRequired: true },
              { status: 401 },
            );
          }
        }
      }
    }

    await setSessionCookie({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      email: user.email,
      name: user.name,
      sessionEpoch: user.sessionEpoch,
      // ⚠️ BU OTURUM İKİNCİ FAKTÖRDEN GEÇTİ Mİ (08-05). Buraya ulaşmanın tek
      // yolu ↑`twoFactorEnabledAt` dalıdır; oraya girildiyse TOTP, kurtarma kodu
      // ya da güvenilen cihazdan biri sağlanmış demektir (üçü de "bu cihaz/kişi
      // daha önce faktörle doğrulandı" anlamına gelir; güvenilen cihaz token'ı
      // 2FA epoch'una bağlı, yani bilinçli bir sıfırlamayı aşamaz).
      //
      // 2FA açık DEĞİLSE iddia `false` — hesap şifreyle giriyor, operatör
      // yetkisi verilmez (`admin.ts isSuperAdmin`). Giriş engellenmez.
      mfa: Boolean(user.twoFactorEnabledAt),
    });

    // Tanınan cihaz (↑kova kapısı): her başarılı girişte kayar. Asla ölümcül değil —
    // yazılamazsa giriş yine başarılı, yalnız bu tarayıcı kova DOLUYKEN tanınmaz.
    try {
      await setKnownDeviceCookie(user.id, user.sessionEpoch);
    } catch {
      // yok say — giriş zaten başarılı
    }

    // Security breadcrumb: a successful sign-in (who + when). Non-fatal.
    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.login_success",
      metadata: { ip: clientIp(req), twoFactor: Boolean(user.twoFactorEnabledAt) },
    });

    // Remember this device (skip the 2FA code here for 30 days). Only meaningful
    // for 2FA accounts; refreshed on each trusted login so it stays sliding.
    // Never fatal: a failure here must not undo the successful login.
    if (user.twoFactorEnabledAt && (parsed.data.rememberDevice || trustedDevice)) {
      try {
        await setTrustedDeviceCookie(user.id, twoFaEpoch, user.sessionEpoch);
      } catch {
        // ignore — the login already succeeded.
      }
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
