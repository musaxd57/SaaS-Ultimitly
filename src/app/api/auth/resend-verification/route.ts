import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, tooManyRequests, parseJsonBody, payloadTooLarge, hasJsonContentType, unsupportedMediaType } from "@/lib/api";
import { rateLimit, rateLimitClientKey, rateLimitRelease } from "@/lib/rate-limit";
import { padResponseTime, RESEND_VERIFY_RESPONSE_FLOOR_MS } from "@/lib/response-floor";
import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import {
  makeVerifyToken,
  VERIFY_TTL_MS,
  VERIFY_RESEND_QUIET_MS,
  verifyLinkRecentlyIssued,
  verifyEmailHtml,
  verifyUrl,
  needsEmailVerification,
} from "@/lib/auth/email-verify";
import { emailOutboxEnabled, enqueueIdentityEmail, kickEmailOutboxDrain } from "@/lib/email-outbox";
import { isValidEmailShape, normalizeEmail } from "@/lib/email-identity";

export const dynamic = "force-dynamic";

/** Aynı adrese 24 saatte gönderilebilecek en fazla doğrulama e-postası (yeniden gönderme yolu). */
const VERIFY_RESEND_DAILY_CAP = 6;
const VERIFY_RESEND_DAY_MS = 24 * 60 * 60_000;

// Resend the verification e-mail. ALWAYS returns 200 (never reveals whether the
// account exists / its state). Sends only for a real, still-unverified self-serve
// account. Rate-limited per IP and per email (inbox-bomb defense).
export async function POST(req: NextRequest) {
  // 🚨 JSON KONTROLÜ IP KOVASINDAN ÖNCE (09-23; `login` rotasının F8 emsali, gerekçe
  // `hasJsonContentType`te): başka bir site ziyaretçinin tarayıcısından `text/plain`
  // POST'larla (preflight YOK) bir ofis/mobil NAT'ının kovasını yakıp orayı bu akıştan
  // dakikalarca dışarıda bırakabiliyordu. Kendi formlarımız hep `application/json` yollar.
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  const ipLimit = await rateLimit(`verify-resend:${rateLimitClientKey(req)}`, 8, 15 * 60_000);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfter);

  const bodyResult = await parseJsonBody<{ email?: unknown }>(req);
  if (!bodyResult.ok && bodyResult.tooLarge) return payloadTooLarge();
  const data = bodyResult.ok ? bodyResult.data : null;
  const email = typeof data?.email === "string" ? normalizeEmail(data.email) : "";
  if (!email || !isValidEmailShape(email)) return jsonOk({ ok: true });

  // İSTEK SINIRI (adres başına, hesabın VARLIĞINA bakmadan — numaralandırma koruması): her istek sayılır.
  const acctLimit = await rateLimit(`verify-resend-acct:${email}`, 4, 15 * 60_000);
  if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfter);
  // 🚨 GÜNLÜK TAVAN (09-23, güvenlik ajanı): 15 dakikalık kova tek başına günde 4×96 = 384
  // e-postaya izin veriyordu ve IP kovası IP döndürerek aşılıyor → kimliksiz bir saldırgan,
  // kurbanın adresiyle açtığı doğrulanmamış hesap üzerinden o adrese günde yüzlerce
  // `noreply@lixusai.com` e-postası yağdırabiliyordu (hem kurbanı rahatsız eder hem
  // gönderici itibarımızı yakar). Gerçek kullanıcı günde 6'dan fazla yeniden gönderme istemez.
  // 🚨 Tur 7 T7-AUTH-1 (kurucu onayı 11-05, Codex görüşüyle): bu tavan artık GERÇEK GÖNDERİM kotasıdır — yalnız yeni bağlantı üretilip
  // e-posta gerçekten yola çıktığında (kuyruğa yazıldı / gönderim başarılı) tüketilir. Eskiden her istek sayılıyordu: 10 dakikalık sessiz
  // pencerede (U12) hiçbir şey gönderilmeyen basışlar kotayı yiyordu. Kota doluysa SESSİZCE gönderilmez ve cevap yine aynı 200 — 429
  // yalnız gerçek hesaplarda görünürdü (hesap numaralandırma). Aşağıdaki gönderim dalında.

  // Tur 7 (Codex 11-05 gece): buradan sonrası hesaba bağlı iş — her dal aynı en kısa sürede cevaplanır (↓padResponseTime).
  const startedAt = performance.now();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, createdAt: true, emailVerifiedAt: true, emailVerifyExpiresAt: true },
  });
  // Only a genuinely-unverified, gated account gets a fresh link.
  // 🚨 U12 (kurucu 10-22): son 10 dakikada üretilmiş geçerli bağlantı varsa YENİSİ ÜRETİLMEZ ve e-posta gitmez — cevap yine aynı 200.
  // Eskiden başkası kurbanın adresiyle 6 kez basıp her seferinde öncekini geçersiz kılıyordu; kişi e-postadaki bağlantıya basınca "süresi
  // dolmuş" görüyordu. Artık kutudaki bağlantı ÇALIŞMAYA DEVAM EDER. Günlük tavanın kendisi hâlâ başkasınca doldurulabilir (hesabın varlığına
  // bakmadan sayılması numaralandırma korumasıdır, bilinçli) — o gün yalnız YENİDEN GÖNDERME kapanır, elindeki bağlantı değil.
  // 🚨 Hiçbir dal dışarıya farklı DURUM KODU sızdıramaz (Opus 11-05): gönderim dalı kendi hatalarını yutuyordu (200), eşitleyici işlem ise
  // yutmuyordu → veritabanı zorlanınca (havuz dolu, işlem zaman aşımı) yalnız "hesap yok / doğrulanmış / sessiz pencere" dalı 500 dönüyordu,
  // gerçek doğrulanmamış hesap 200 → hesap kâhini. Her dalın hatası raporlanır, cevap yine aynı 200 ve aynı taban (`finally`).
  try {
    if (user && needsEmailVerification(user) && !verifyLinkRecentlyIssued(user.emailVerifyExpiresAt)) {
      await issueAndSend(user, email);
    } else {
      await timingParityNoop(email);
    }
  } catch (err) {
    void reportError("auth.resend_verification.branch", err instanceof Error ? err : new Error(String(err)));
  } finally {
    await padResponseTime(startedAt, RESEND_VERIFY_RESPONSE_FLOOR_MS);
  }
  return jsonOk({ ok: true });
}

/** Bu istek bağlantıyı üretme yarışını kaybetti (aynı anda gelen başka istek kazandı) — e-posta gitmez. */
class LostIssueRace extends Error {}

/**
 * 🚨 Tur 7 T7-AUTH-1 (Codex 11-05 gece: "iki işçi aynı boş hakkı kullanıp sınırı aşmamalı"). Sıra:
 *  1. GÜNLÜK GÖNDERİM HAKKI ÖNCE AYRILIR — `rateLimit` tek atomik SQL artırımıdır; eşzamanlı istekler aynı boş hakkı ALAMAZ. Eskiden önce
 *     bakılıp (`peek`) gönderimden sonra tüketiliyordu: 5. hak boşken aynı anda gelen iki istek ikisi de gönderiyordu.
 *  2. BAĞLANTI KOŞULLU ÜRETİLİR — satır okunduğu hâldeyse (`emailVerifyExpiresAt` aynı) yazılır; aynı anda gelen ikinci istek 0 satır
 *     günceller → yarışı kaybeder, e-posta göndermez (eskiden iki bağlantı + iki e-posta, ilki geçersiz).
 *  3. İş düşerse (yarış kaybı, kuyruğa yazma hatası, sağlayıcı reddi) hak İADE edilir (`rateLimitRelease`).
 * Neyin sayıldığı (karıştırılmasın): kuyruklu yolda "kuyruğa yazıldı" = gönderim NİYETİ (teslim değil; boşaltıcı sonra sağlayıcıya verir,
 * sağlayıcının kabulü ve kutuya teslim AYRI olaylardır ve burada bilinmez); kuyruksuz yolda "sağlayıcı kabul etti". Kuyruğa yazılıp sonra
 * sağlayıcıda düşen e-posta hakkı İADE ETMEZ — tavan e-posta bombasına karşıdır, sayım güvenli (sıkı) yönde hata yapar; boşaltıcı ops
 * alarmı verir. Cevap her dalda aynı 200.
 */
async function issueAndSend(
  user: { id: string; emailVerifyExpiresAt: Date | null },
  email: string,
): Promise<void> {
  const sendQuotaKey = `verify-resend-day:${email}`;
  // Hak doluysa SESSİZCE gönderilmez (429 yalnız gerçek hesaplarda görünürdü → hesap numaralandırma).
  if (!(await rateLimit(sendQuotaKey, VERIFY_RESEND_DAILY_CAP, VERIFY_RESEND_DAY_MS)).ok) return;
  const release = () => rateLimitRelease(sendQuotaKey, VERIFY_RESEND_DAY_MS);
  const { raw, hash } = makeVerifyToken();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  const claimLink = async (tx: Pick<typeof prisma, "user">) => {
    const won = await tx.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null, emailVerifyExpiresAt: user.emailVerifyExpiresAt },
      data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: expiresAt },
    });
    if (won.count !== 1) throw new LostIssueRace();
  };
  if (emailOutboxEnabled()) {
    // Durable outbox (Tur-4): new token hash + send-intent in ONE transaction
    // (the enqueue supersedes any still-undelivered previous link, so only
    // the newest token's e-mail goes out). No provider call on this path.
    // Kuyruğa yazma düşerse işlem geri alınır (bağlantı değişmez → sessiz pencere başlamaz), hak iade edilir, cevap yine aynı 200 — kişi
    // kilitlenmez, hemen yeniden isteyebilir; ops alarmı alır.
    try {
      await prisma.$transaction(async (tx) => {
        await claimLink(tx);
        await enqueueIdentityEmail(tx, {
          userId: user.id,
          kind: "verify_email",
          secret: raw,
          recipient: email,
          expiresAt,
        });
      });
    } catch (err) {
      await release();
      if (!(err instanceof LostIssueRace)) {
        void reportError("auth.resend_verification.enqueue", err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    kickEmailOutboxDrain();
    return;
  }
  try {
    await claimLink(prisma);
  } catch (err) {
    await release();
    if (!(err instanceof LostIssueRace)) throw err;
    return;
  }
  const sent = await emailService.sendReporting(
    email,
    "Lixus AI — E-postanızı doğrulayın",
    verifyEmailHtml(verifyUrl(raw)),
  );
  // The response is DELIBERATELY uniform (always 200 — a different shape on failure
  // would only appear for real unverified accounts → account enumeration). But a
  // genuine send failure must page ops, not vanish (redacted — no recipient/token).
  if (!sent.ok) {
    await release();
    void reportError("auth.resend_verification", new Error(sent.error ?? "email send failed"));
    // Eski (kuyruksuz) yol: e-posta GİTMEDİ ama yeni bağlantı eskisini geçersiz kıldı — 10 dk sessizlik bu kişiyi boşuna bekletmesin
    // (Haiku 10-22). Bağlantı "10 dk önce üretilmiş" sayılacak kadar geriye çekilir; ömrü yalnız o kadar kısalır.
    await prisma.user
      .updateMany({
        where: { id: user.id, emailVerifyTokenHash: hash },
        data: { emailVerifyExpiresAt: new Date(expiresAt.getTime() - VERIFY_RESEND_QUIET_MS) },
      })
      .catch(() => {});
  }
}

/**
 * ZAMANLAMA PARİTESİ (Tur 7, Codex 11-05 gece: "aynı 200 tek başına hesabın gizlendiğini kanıtlamaz"). Bağlantı üretmeyen dallar (hesap yok,
 * doğrulanmış / eski hesap, son 10 dakikada bağlantı gitmiş) gönderim dalının veritabanı işine benzer bir işlem yapar: gönderim hakkı
 * kovasına dokunan bir ifade + iki satırlık boş işlem (`forgot-password` rotasındaki `__timing_parity__` emsali). Mutlak sabit süre
 * İDDİA EDİLMEZ; asıl savunma hız sınırları (adres başına 15 dakikada 4 istek) ve 10 dakikalık sessiz pencere — aynı hesap için ikinci
 * "yavaş" örnek 10 dakika sonra mümkün ve her biri kurbana gerçek bir e-posta götürür. Ölçüm: `docs/INCELEME-2026-11-05-tur7-…`.
 */
async function timingParityNoop(email: string): Promise<void> {
  await rateLimitRelease("verify-resend-day:__timing_parity__", VERIFY_RESEND_DAY_MS);
  makeVerifyToken();
  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: "__timing_parity__" }, data: { emailVerifyTokenHash: null } });
    // `enqueueIdentityEmail`in adımları: işlem kilidi + eski satırları iptal + sürüm okuma (yazma yok). Kilit ADRES BAŞINA (Opus 11-05): tek
    // ortak anahtar eşzamanlı "hesap yok" isteklerini sıraya diziyordu (gerçek yol kullanıcı başına kilitler) → yük altında bu dal tabanı
    // aşıp yeniden ayırt edilebilir olurdu, üstelik ucuz bir bağlantı havuzu tüketme kolu. Anahtar özetlenir (adres veritabanına yazılmaz).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`__timing_parity__:${email}`}))`;
    await tx.emailOutbox.updateMany({ where: { userId: "__timing_parity__", kind: "verify_email", status: { in: ["pending", "claimed"] } }, data: { status: "canceled" } });
    await tx.emailOutbox.aggregate({ where: { userId: "__timing_parity__", kind: "verify_email" }, _max: { version: true } });
  });
}
