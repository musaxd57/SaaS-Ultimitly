import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, newPasswordProblem } from "@/lib/auth/password";
import {
  badRequest,
  jsonOk,
  serverError,
  tooManyRequests,
  parseJsonBody,
  payloadTooLarge,
  hasJsonContentType,
  unsupportedMediaType,
} from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  issueChallenge,
  verifyChallenge,
  consumeChallengeAndResetPassword,
} from "@/lib/auth/password-reset-challenge";
import { isValidEmailShape, normalizeEmail } from "@/lib/email-identity";
import { enqueueIdentityEmail, kickEmailOutboxDrain } from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// PUBLIC "forgot my password" RESET (logged OUT). Enumeration-hardened.
//
//   POST { action: "request", email }                    → ALWAYS 200 (mails a
//                                                            challenge only if
//                                                            the account exists)
//   POST { action: "confirm", token, code, newPassword } → verify → set password
//
// 🚩 FAZ 3 (08-09): ESKİ `pwResetCode*` KOD YOLU KALDIRILDI. Tek yol artık
// `PasswordResetChallenge`: deneme bütçesi HESABA değil SATIRA ait ve satırın
// tek adresleme yolu `tokenHash` → token'ı bilmeyen satırı bulamaz, denemesini
// harcayamaz. (Kaldırılan yolda bütçe e-postaya bağlıydı ve saldırgan kurbanın
// adresiyle 5 yanlış deneme yapıp canlı kodu yakabiliyordu.)
//
// Kaldırma ÖNCESİ iki kapı geçildi (Codex, fail-closed):
//   1) TAZE prod smoke: 2026-08-09 09:48 TR, `AuditLog.account.password_reset`
//      → `via = "challenge"` (son üç kayıt da challenge).
//   2) `EmailOutbox` where kind='pw_reset_code' → yalnız terminal `sent = 2`;
//      pending/claimed/sending = 0, yani uçuşta eski kod YOK.
// Eski kodların TTL'i 10 dakikaydı ve bayrak 08-05'ten beri açık olduğu için
// yeni eski-kod ÜRETİLEMİYORDU (istek yolu challenge bloğunda `return` ediyordu).
//
// ⚠️ GERİ ALMA ARTIK ENV DEĞİL: bu turdan önce geri dönüş `PASSWORD_RESET_
// CHALLENGE_ENABLED`i silmekti (sıfır kod). Şimdi geri dönüş bu commit'i
// revert etmektir. Bayrak artık HİÇBİR YERDE OKUNMUYOR — Railway'den silinmesi
// davranışı değiştirmez, ama deploy ACTIVE olup smoke test geçmeden silinmemeli.
// ---------------------------------------------------------------------------

/**
 * 🚨 BU FONKSİYON "ESKİ AKIŞIN PARÇASI" DEĞİL — ZAMANLAMA PARİTESİ TAŞIYOR.
 *
 * Tek çağrı yeri, `request` yolunun BİLİNMEYEN E-POSTA dalıdır: orada bilinen
 * dalın bcrypt maliyetini taklit etmek için `hashPassword(verificationCode())`
 * koşulur. Faz 3'te "8 haneli kod üreteci, eski yolla gider" diye silinirse
 * bilinmeyen dal ölçülebilir biçimde HIZLANIR ve dosyanın geri kalanının kurduğu
 * enumeration korumaları (sabit 200, genel hata metni, hız limiti) tek bir yan
 * kanalla delinir — 08-06'da `confirm` tarafında ölçülen 362 ms'lik oracle'ın
 * aynısı. Üretilen değer HİÇBİR YERE YAZILMAZ; yalnız hash'lenip atılır.
 * Pin: `tests/integration/forgot-password-timing-parity.test.ts`.
 */
function verificationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  return String(n).padStart(8, "0");
}

// Same generic message whether the token is missing, unknown, expired, out of
// budget, or the code is wrong — the response never reveals which (nor whether
// an account exists). Wording matches the on-screen CTA ("Kodu tekrar gönder").
const GENERIC_CONFIRM =
  "Bu kod artık kullanılamıyor. Süresi dolmuş veya daha yeni bir kod oluşturulmuş olabilir. “Kodu tekrar gönder” ile yeni bir kod isteyin.";

export async function POST(req: NextRequest) {
  // 🚨 JSON KONTROLÜ IP KOVASINDAN ÖNCE (09-23; `login` rotasının F8 emsali, gerekçe
  // `hasJsonContentType`te): başka bir site ziyaretçinin tarayıcısından `text/plain`
  // POST'larla (preflight YOK) bir ofis/mobil NAT'ının kovasını yakıp orayı bu akıştan
  // dakikalarca dışarıda bırakabiliyordu. Kendi formlarımız hep `application/json` yollar.
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  // Per-IP cap over the whole flow (enumeration / code-spray defense).
  const ipLimit = await rateLimit(`forgot:${clientIp(req)}`, 12, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  try {
    const bodyResult = await parseJsonBody<Record<string, unknown>>(req);
    if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
    const data = bodyResult.ok ? bodyResult.data : null;
    const action = typeof data?.action === "string" ? data.action : "";
    const email = typeof data?.email === "string" ? normalizeEmail(data.email) : "";

    // ── E-POSTA YALNIZ `request` İÇİN ZORUNLUDUR (Faz 3) ───────────────────
    // Token'lı confirm E-POSTA İSTEMEZ: challenge'ı token adresler ve o yolda
    // e-posta hiçbir yerde KULLANILMAZ — challenge ile eşleştirilmez, hız-limiti
    // kovasının anahtarı değildir, denetim kaydına verdict'ten gelen kimlik yazılır.
    // Bağlantı zaten kullanıcının e-postasından geldiği için adresi tekrar sormak
    // sıfır güvenlik katar; üstelik bağlantı TAZE bir sayfa yüklediğinden istemcinin
    // elinde o adres yoktur (React state'i o yüklemede sıfırdır).
    //
    // ⚠️ Uyuşmayan bir e-posta gönderilirse REDDEDİLMEZ, yok sayılır: reddetmek,
    // token'ı ele geçirmiş birine "bu token hangi adrese ait?" sorusunu deneme
    // yanılmayla yanıtlatan bir oracle açardı.
    //
    // ⚠️ Bu kontrol eskiden `if (!rawToken && …)` ile TÜM action'lara uygulanıyordu;
    // artık YALNIZ `request`e ait. Sebep: token'sız bir confirm'ün adresi geçerli
    // olsa da olmasa da AYNI cevabı alması gerekiyor (↓confirm dalı), yoksa yanıt
    // şekli isteğin hangi dala düştüğünü sızdırırdı.
    if (action === "request" && (!email || !isValidEmailShape(email))) {
      return badRequest({ email: "Geçerli bir e-posta girin." });
    }

    // STEP 1 — request a reset code. ALWAYS returns 200 and never reveals whether
    // the account exists; only sends mail when it does.
    if (action === "request") {
      // Per-account request cap (inbox-bomb + "re-roll a fresh code" defense).
      const reqLimit = await rateLimit(`forgot-req:${email}`, 4, 15 * 60_000);
      if (!reqLimit.ok) return tooManyRequests(reqLimit.retryAfter);

      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) {
        // Spend a comparable bcrypt cost so the not-found path isn't measurably
        // faster than the real path (removes a cheap timing oracle).
        await hashPassword(verificationCode());
        // Outbox parity: the known-user path writes one short local transaction;
        // mirror a comparable no-op write here so the work profiles stay close.
        // bcrypt remains the dominant cost either way — absolute constant time
        // is NOT claimed (rate limits stay the first line of defence).
        // ⚠️ KOŞULSUZ (Faz 3). Eskiden `if (emailOutboxEnabled())` ile kapılıydı,
        // çünkü o zaman satır yazan taraf da bayrağa bağlıydı. Challenge yolu
        // enqueue'yu ARTIK KOŞULSUZ yapıyor → paritenin de koşulsuz olması
        // gerekiyor; bayrak kapalıyken bilinen dal yazıp bilinmeyen dal
        // yazmasaydı fark tam da kapatmaya çalıştığımız yan kanal olurdu.
        await prisma.user.updateMany({
          where: { id: "__timing_parity__" },
          data: { pwResetCodeAttempts: 0 },
        });
        return jsonOk({ ok: true });
      }

      // ── CHALLENGE YOLU — Faz 3'ten beri TEK YOL, bayraksız ────────────────
      //
      // ⚠️ ÖNCEKİ CANLI CHALLENGE'LAR İPTAL EDİLMEZ: saldırganın yeni istekler
      // göndererek kurbanın ELİNDEKİ geçerli challenge'ı düşürmesini engelleyen
      // şey budur (kullanıcı kararı, 08-02). Canlı satır sayısı "sınırsız"
      // değildir — `forgot-req` kovası (4/15 dk) ve TTL (30 dk) doğal tavandır.
      const issued = await issueChallenge(prisma, user.id);
      // ⚠️ Token VE kod yalnız e-postaya gider. Yanıta, log'a, AuditLog'a ya da
      // Sentry'ye ASLA girmez — bileşik sır şifreli outbox payload'ında taşınır.
      await prisma.$transaction(async (tx) => {
        await enqueueIdentityEmail(tx, {
          userId: user.id,
          kind: "pw_reset_challenge",
          secret: `${issued.token}.${issued.code}`,
          recipient: email,
          expiresAt: issued.expiresAt,
        });
      });
      kickEmailOutboxDrain();
      return jsonOk({ ok: true });
    }

    // STEP 2 — confirm the code, then set the new password. Generic errors only.
    if (action === "confirm") {
      // 🚨 TOKEN ŞART — ve kontrol HER ŞEYDEN ÖNCE (Faz 3, Codex kısıtı).
      // Eski kod yolu kalktığı için token'sız bir confirm'ün gidebileceği yer
      // YOK. Cevap DEĞİŞMEDEN kalır: aynı `GENERIC_CONFIRM`, aynı 400, aynı
      // alan adı (`code`) — yani "token yok", "token bilinmiyor", "süresi
      // dolmuş", "bütçe bitti" ve "kod yanlış" dışarıdan AYIRT EDİLEMEZ.
      // ⚠️ Kontrolün şifre/kod ŞEKİL doğrulamalarından ÖNCE olması bilinçli:
      // sonra gelseydi token'sız bir istek `{newPassword: "…en az 8…"}` gibi
      // FARKLI bir gövde alabilir ve yanıt şekli, isteğin hangi dala düştüğünü
      // sızdırırdı. Önce olunca token'sız yol TEK bir cevaba çöker ve HİÇBİR
      // DB işi yapılmaz.
      const rawToken = typeof data?.token === "string" ? data.token.trim() : "";
      if (!rawToken) return badRequest({ code: GENERIC_CONFIRM });

      const code = typeof data?.code === "string" ? data.code.trim() : "";
      // 🚨 PAROLA KIRPILMAZ (09-23, login ajanı F7) — kayıt ve giriş parolayı OLDUĞU GİBİ
      // alır; burada kırpmak " gizli-parola1 " belirleyen kullanıcıyı (ya da boşluklu
      // değeri kaydeden parola yöneticisini) sıfırlamanın ARDINDAN girişte kilitliyordu.
      // Token ve kod kırpılır (yapısal değerler), parola asla.
      const newPassword = typeof data?.newPassword === "string" ? data.newPassword : "";
      // ⚠️ ÜST SINIR GİRİŞ ŞEMASINDAN SIKI OLMAK ZORUNDA (`loginSchema` 200'de kesiyor).
      // Eskiden burada sınır yoktu: 200'den uzun bir şifre BELİRLENİP hash'lenebiliyor,
      // sonra aynı şifreyle GİRİŞ 400 alıyordu → kullanıcı kendi hesabından kilitleniyordu.
      // Artık kural tek kaynaktan (③, 09-23): en az 8 karakter, en fazla 72 BAYT (bcrypt
      // fazlasını sessizce yok sayar) — 72 bayt her durumda 200 karakterin altında kalır.
      const pwProblem = newPasswordProblem(newPassword);
      if (pwProblem) return badRequest({ newPassword: pwProblem });
      if (!/^\d{8}$/.test(code)) {
        return badRequest({ code: "8 haneli doğrulama kodunu girin." });
      }

      // ── TOKEN'LI YOL — Faz 3'ten beri TEK YOL ───────────────────────────
      // ⚠️ Burada `forgot-confirm:{email}` gibi bir HESAP kovası YOK ve
      // OLMAYACAK — bütçe challenge SATIRINDA yaşıyor ve satırı yalnız token
      // adresleyebiliyor. Hesaba bağlı bir kova, m47'nin kapattığı deliği
      // (saldırgan kurbanın adresiyle bütçeyi yakar) yeniden açardı.
      {
        const verdict = await verifyChallenge(rawToken, code);
        if (!verdict.ok) {
          // Tüm başarısızlıklar AYNI genel hatayı alır: "token yok", "süresi
          // dolmuş", "bütçe bitti" ve "kod yanlış" dışarıdan ayırt EDİLEMEZ.
          return badRequest({ code: GENERIC_CONFIRM });
        }
        // `actorUserId` adlandırması bilinçli: `writeAudit` çağrısı kısayolla
        // yazılabilsin diye (oturum ÖNCESİ akışın "çağıran sorumlu" deseni).
        const { challengeId, userId: actorUserId, organizationId } = verdict;
        const newHash = await hashPassword(newPassword);
        const done = await consumeChallengeAndResetPassword({
          challengeId,
          userId: actorUserId,
          organizationId,
          newPasswordHash: newHash,
        });
        // Paralel iki DOĞRU istekte yalnız biri `true` alır — ikincisi hiçbir
        // şey yazmadan genel hataya düşer.
        if (!done) return badRequest({ code: GENERIC_CONFIRM });
        await writeAudit({
          organizationId,
          actorUserId,
          action: "account.password_reset",
          // ⚠️ Token/kod/hash YOK — yalnız opak challenge id'si.
          metadata: { via: "challenge", challengeId, ip: clientIp(req) },
        });
        return jsonOk({ ok: true });
      }
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
