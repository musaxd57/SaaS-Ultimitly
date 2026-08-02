import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { badRequest, jsonOk, serverError, tooManyRequests, parseJsonBody, payloadTooLarge } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  issueChallenge,
  verifyChallenge,
  consumeChallengeAndResetPassword,
} from "@/lib/auth/password-reset-challenge";
import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import { isValidEmailShape, normalizeEmail } from "@/lib/email-identity";
import {
  emailOutboxEnabled,
  enqueueIdentityEmail,
  kickEmailOutboxDrain,
  resetCodeEmailHtml,
} from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// PUBLIC "forgot my password" RESET (logged OUT). Mirrors the logged-in
// account/password code flow but keyed on EMAIL and hardened against
// account-enumeration. Uses separate pwResetCode* columns so a public reset
// request can never burn/overwrite a code the user is mid-using in Settings.
//
//   POST { action: "request", email }                    → ALWAYS 200 (mails a
//                                                            code only if the
//                                                            account exists)
//   POST { action: "confirm", email, code, newPassword } → verify → set password
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60_000; // 10 minutes (ESKİ akış — Faz 3'te kalkacak)

/**
 * FAZ 1 BAYRAĞI — DEFAULT KAPALI (kullanıcı kararı: prod'da AÇILMAYACAK).
 *
 * Kapalıyken: davranış BİREBİR eskisi gibi. Challenge satırı yazılır (çift yazma)
 * ama confirm yolunda KULLANILMAZ ve e-postaya bağlantı EKLENMEZ — yani üretimde
 * hiçbir kullanıcı-görünür değişiklik yok.
 * Açıkken: e-posta bağlantı taşır, confirm token'lı yolu kabul eder; ESKİ kod
 * yolu uçuştaki kodlar için ÇALIŞMAYA DEVAM EDER (geçiş penceresi ≥ eski TTL).
 */
function challengeFlowEnabled(): boolean {
  return process.env.PASSWORD_RESET_CHALLENGE_ENABLED === "1";
}
const MAX_CODE_ATTEMPTS = 5;

/** Crypto-strong 8-digit code (10^8 space) — the primary barrier, like the
 *  logged-in flow. */
function verificationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
  return String(n).padStart(8, "0");
}

// The e-mail template lives in email-outbox.ts (resetCodeEmailHtml) — ONE
// source for both the outbox worker and this route's legacy synchronous path,
// so the two can never drift apart.

// Same generic message whether the email is unknown, the code is wrong, expired,
// superseded by a newer code, or exhausted — the response never reveals which
// (nor whether an account exists). Wording matches the on-screen CTA
// ("Kodu tekrar gönder") and stays deliberately soft/cause-free.
/**
 * BAŞARISIZ bir "confirm" denemesini sonuçlandır: hesap kovasını TÜKET, tavan
 * aşıldıysa 429, aksi hâlde her zamanki GENEL hata.
 *
 * ⚠️ Kova yalnız BURADAN tüketilir — yani doğru kod ondan hiç etkilenmez ve
 * saldırgan başarısız isteklerle kurbanın sıfırlamasını engelleyemez (Codex,
 * 08-01 — §4g(a); giriş rotasındaki desenin aynısı).
 *
 * ⚠️ BİLİNMEYEN e-posta da tüketir: aksi hâlde sayacın varlığı hesabın VARLIĞINI
 * sızdırırdı. Dönen gövde her hâlde aynı (`GENERIC_CONFIRM`), 429 da her iki
 * durumda ulaşılabilir → enumeration koruması korunur.
 *
 * ⚠️ Kod-BAŞINA deneme tavanı (`MAX_CODE_ATTEMPTS`) AYRI ve DEĞİŞMEDİ: 8 haneli
 * kodun kaba kuvvetini durduran şey odur. Kurban tükenmiş bir kodun yerine
 * YENİSİNİ isteyebilir (istek yolunun kendi kovası ayrıdır) — kova ise fresh bir
 * kodun İLK denemesini bile engelliyordu, kurtuluşu olmayan tek yol buydu.
 */
async function failConfirm(email: string) {
  const limit = await rateLimit(`forgot-confirm:${email}`, 8, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  return badRequest({ code: GENERIC_CONFIRM });
}

const GENERIC_CONFIRM =
  "Bu kod artık kullanılamıyor. Süresi dolmuş veya daha yeni bir kod oluşturulmuş olabilir. “Kodu tekrar gönder” ile yeni bir kod isteyin.";

export async function POST(req: NextRequest) {
  // Per-IP cap over the whole flow (enumeration / code-spray defense).
  const ipLimit = await rateLimit(`forgot:${clientIp(req)}`, 12, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  try {
    const bodyResult = await parseJsonBody<Record<string, unknown>>(req);
    if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
    const data = bodyResult.ok ? bodyResult.data : null;
    const action = typeof data?.action === "string" ? data.action : "";
    const email = typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email || !isValidEmailShape(email)) {
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
        // Outbox parity (Tur-4): the known-user path writes one short local
        // transaction; mirror a comparable no-op write here so the work
        // profiles stay close. bcrypt remains the dominant cost either way —
        // absolute constant time is NOT claimed (rate limits stay the first
        // line of defence).
        if (emailOutboxEnabled()) {
          await prisma.user.updateMany({
            where: { id: "__timing_parity__" },
            data: { pwResetCodeAttempts: 0 },
          });
        }
        return jsonOk({ ok: true });
      }

      // ── FAZ 1: CHALLENGE YOLU (bayrak AÇIKKEN) ──────────────────────────
      // Bayrak KAPALIYKEN bu blok hiç çalışmaz → üretim davranışı BİREBİR eskisi.
      //
      // ⚠️ ÖNCEKİ CANLI CHALLENGE'LAR İPTAL EDİLMEZ: saldırganın yeni istekler
      // göndererek kurbanın ELİNDEKİ geçerli challenge'ı düşürmesini engelleyen
      // şey budur (kullanıcı kararı, 08-02). Canlı satır sayısı "sınırsız"
      // değildir — `forgot-req` kovası (4/15 dk) ve TTL (30 dk) doğal tavandır.
      if (challengeFlowEnabled()) {
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

      const code = verificationCode();
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      // ── Durable outbox (Tur-4, flag ON): hash + send-intent in ONE
      // transaction, NO provider call on the request path (the synchronous
      // network leg was the forgot-password timing oracle — and a provider
      // outage used to silently burn the code). Delivery is owned by the 15s
      // poller / 2-min cron; the kick below only shortens the wait and can
      // never produce an unhandled rejection. ──
      if (emailOutboxEnabled()) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { pwResetCodeHash: codeHash, pwResetCodeExpiresAt: expiresAt, pwResetCodeAttempts: 0 },
          });
          await enqueueIdentityEmail(tx, {
            userId: user.id,
            kind: "pw_reset_code",
            secret: code,
            recipient: email,
            expiresAt,
          });
        });
        kickEmailOutboxDrain();
        return jsonOk({ ok: true });
      }

      // Legacy synchronous path (flag OFF) — unchanged behaviour.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          pwResetCodeHash: codeHash,
          pwResetCodeExpiresAt: expiresAt,
          pwResetCodeAttempts: 0,
        },
      });
      const sent = await emailService.sendReporting(
        email,
        "Lixus AI — Şifre sıfırlama kodu",
        resetCodeEmailHtml(code),
      );
      if (!sent.ok) {
        // Couldn't deliver → don't leave a dangling code. Stay generic (no
        // different error shape that would leak existence), but page ops (redacted —
        // never the recipient/reset code) so a mail outage isn't silently swallowed.
        await prisma.user.update({
          where: { id: user.id },
          data: { pwResetCodeHash: null, pwResetCodeExpiresAt: null },
        });
        void reportError("account.forgot_password", new Error(sent.error ?? "email send failed"));
      }
      return jsonOk({ ok: true });
    }

    // STEP 2 — confirm the code, then set the new password. Generic errors only.
    if (action === "confirm") {
      const code = typeof data?.code === "string" ? data.code.trim() : "";
      const newPassword = typeof data?.newPassword === "string" ? data.newPassword.trim() : "";
      if (newPassword.length < 8) {
        return badRequest({ newPassword: "Şifre en az 8 karakter olmalı." });
      }
      if (!/^\d{8}$/.test(code)) {
        return badRequest({ code: "8 haneli doğrulama kodunu girin." });
      }

      // ── FAZ 1: TOKEN'LI YOL ─────────────────────────────────────────────
      // Gövdede `token` VARSA challenge yolu; YOKSA eski kod yolu (aşağıda).
      // Bu ayrım geçiş penceresinin tamamıdır: bayrak açıldıktan sonra bile
      // UÇUŞTAKİ eski kodlar (TTL 10 dk) çalışmaya DEVAM eder.
      //
      // ⚠️ Bu yolda `forgot-confirm:{email}` kovası HİÇ kullanılmaz — bütçe
      // challenge satırındadır ve token'ı bilmeyen onu adresleyemez. Kovayı
      // burada da çalıştırmak, tasarımın kapattığı deliği yeniden açardı.
      const rawToken = typeof data?.token === "string" ? data.token.trim() : "";
      if (rawToken) {
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

      // ⚠️ HESAP KOVASI BURADA DEĞİL, KOD DOĞRULANDIKTAN SONRA (Codex, 08-01 —
      // §4g(a); giriş rotasındaki düzeltmenin BİREBİR aynısı).
      //
      // Kovayı burada KAPI olarak kullanmak, kaba kuvvet korumasını bir HİZMET
      // ENGELLEME silahına çeviriyordu: saldırgan kurbanın e-postasına 8 uydurma
      // confirm atıp kovayı doldurur (kurbanın kod istemesini bile beklemez),
      // kurban sonra DOĞRU kodunu girse bile 429 alır ve şifresini sıfırlayamaz.
      // 10 dakikada bir tekrarlanarak SÜRESİZ sürdürülebilirdi.
      //
      // Yeni sözleşme: DOĞRU kod kovadan HİÇ etkilenmez; kova YALNIZCA başarısız
      // denemeleri sınırlar (↓`failConfirm`). IP kovası (yukarıda) değişmedi.
      // Atomically CLAIM one guess slot — only succeeds if a live, unexpired code
      // exists AND attempts are under the cap. Single conditional updateMany
      // closes the read-then-act race and caps guesses per code.
      const claim = await prisma.user.updateMany({
        where: {
          email,
          pwResetCodeHash: { not: null },
          pwResetCodeExpiresAt: { gt: new Date() },
          pwResetCodeAttempts: { lt: MAX_CODE_ATTEMPTS },
        },
        data: { pwResetCodeAttempts: { increment: 1 } },
      });
      if (claim.count === 0) {
        // No live code (or unknown email) → burn any stale code, parity-cost, and
        // return the SAME generic error as a wrong code.
        await prisma.user.updateMany({
          where: { email },
          data: { pwResetCodeHash: null, pwResetCodeExpiresAt: null },
        });
        await verifyPassword(code, await hashPassword(code));
        return failConfirm(email);
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, organizationId: true, pwResetCodeHash: true },
      });
      const codeHash = user?.pwResetCodeHash ?? null;
      if (!user || !codeHash || !(await verifyPassword(code, codeHash))) {
        return failConfirm(email);
      }

      // Code valid → CONSUME + set password in ONE conditional write (Codex P1,
      // logged-in flow ile aynı desen): WHERE doğruladığımız hash'i pinler; aynı
      // kodla yarışan iki confirm'den yalnız İLKİ eşleşir, ikincisi count=0 alır.
      const passwordHash = await hashPassword(newPassword);
      const consumed = await prisma.user.updateMany({
        where: { id: user.id, pwResetCodeHash: codeHash },
        data: {
          passwordHash,
          pwResetCodeHash: null,
          pwResetCodeExpiresAt: null,
          pwResetCodeAttempts: 0,
          // Kill every live session: a stolen token carries the old epoch, so it
          // stops matching the moment the reset completes (the core reason a user
          // resets a password they fear is compromised).
          sessionEpoch: { increment: 1 },
        },
      });
      if (consumed.count === 0) {
        return badRequest({ code: GENERIC_CONFIRM });
      }
      await writeAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "account.password_reset",
        metadata: { via: "email_code", ip: clientIp(req) },
      });
      return jsonOk({ ok: true });
    }

    return badRequest({ _: "Geçersiz işlem." });
  } catch (err) {
    return serverError(undefined, err);
  }
}
