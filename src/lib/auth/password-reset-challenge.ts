import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { reportError } from "@/lib/report-error";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// PAROLA SIFIRLAMA CHALLENGE'I — yapısal DoS düzeltmesi.
//
// 🚨 TEK CÜMLEDE: bütçe (deneme sayısı) HESABA değil CHALLENGE SATIRINA aittir ve
// satırın TEK adresleme yolu `tokenHash`'tir. Token yalnız kullanıcının e-posta
// kutusuna gider; onu bilmeyen biri satırı BULAMAZ, dolayısıyla denemesini de
// HARCAYAMAZ.
//
// Neden gerekti (ölçülmüş): eski akışta hem `forgot-req:{email}` kovası hem
// `User.pwResetCodeAttempts` E-POSTAYA göre anahtarlıydı; e-posta ise saldırganın
// serbestçe yazdığı bir istek alanı. Tek IP'den 9 istek/15 dk (0,6 istek/dk) ile
// kurban süresiz olarak sıfırlama dışında tutulabiliyordu. Sayaçları yeniden
// SIRALAMAK bunu çözmez — anahtar aynı kalır. Çözüm veri modelidir.
//
// İKİ SIR, AYRI HASH'LER:
//   · `tokenHash` = sha256(bağlantıdaki token)  → ADRESLER  (256-bit, e-posta linki)
//   · `codeHash`  = bcrypt(8 haneli kod)        → YETKİLENDİRİR (e-posta gövdesi)
// Sızmış bir URL (tarayıcı geçmişi, ekran görüntüsü, referrer) tek başına parolayı
// sıfırlayamaz — ikinci sır gerekir. Düz değerler HİÇBİR kolonda tutulmaz.
// ---------------------------------------------------------------------------

/** Bağlantı ömrü. Kullanıcı e-postayı geç görebilir; tek-kullanım + tüketim
 *  damgası koruduğu için 30 dk güvenli ve kullanışlı (kullanıcı kararı, 08-02). */
export const CHALLENGE_TTL_MS = 30 * 60_000;

/** Challenge BAŞINA yanlış kod denemesi tavanı. 10^8 kod uzayında 5 deneme,
 *  30 dk TTL ile kaba kuvveti erişilemez kılar. */
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Ham token — YALNIZ e-posta bağlantısına konur, hiçbir yere kaydedilmez. */
export function makeChallengeToken(): string {
  return randomBytes(32).toString("hex"); // 256-bit, URL-safe
}

export function hashChallengeToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Kriptografik 8 haneli kod (10^8). `randomInt` modulo yanlılığı taşımaz. */
export function makeChallengeCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

export interface IssuedChallenge {
  /** E-posta BAĞLANTISINA konacak ham token. Log'a/yanıta ASLA girmez. */
  token: string;
  /** E-posta GÖVDESİNE yazılacak 8 haneli kod. Log'a/yanıta ASLA girmez. */
  code: string;
  expiresAt: Date;
}

/**
 * Yeni bir challenge yarat.
 *
 * ⚠️ ÖNCEKİ CANLI CHALLENGE'LAR İPTAL EDİLMEZ (kullanıcı kararı, 08-02).
 * Saldırganın yeni istekler göndererek kurbanın ELİNDEKİ geçerli challenge'ı
 * düşürmesini engelleyen şey tam olarak budur. "Sınırsız" değildir: canlı satır
 * sayısı `forgot-req:{email}` kovası (4/15 dk) ve TTL (30 dk) ile doğal olarak
 * sınırlıdır — en fazla ~8 canlı satır — ve süpürge 24 saatte toplar.
 */
export async function issueChallenge(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  now: Date = new Date(),
): Promise<IssuedChallenge> {
  const token = makeChallengeToken();
  const code = makeChallengeCode();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await db.passwordResetChallenge.create({
    data: {
      userId,
      tokenHash: hashChallengeToken(token),
      codeHash: await hashPassword(code),
      maxAttempts: CHALLENGE_MAX_ATTEMPTS,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, code, expiresAt };
}

export type ChallengeFailure =
  | "not_found" // token yok / bozuk / süresi dolmuş / tüketilmiş / iptal
  | "exhausted" // deneme bütçesi bitti
  | "wrong_code"; // token doğru, kod yanlış

export type ChallengeResult =
  | { ok: true; challengeId: string; userId: string; organizationId: string }
  | { ok: false; reason: ChallengeFailure };

/**
 * Token + kod ikilisini doğrula ve BİR deneme harca.
 *
 * ⚠️ SIRA ÖNEMLİ: önce token ile satır ATOMİK olarak talep edilir (`updateMany`
 * + `attempts < maxAttempts` koşulu), sonra kod bcrypt ile karşılaştırılır.
 * Talep atomiktir → iki eşzamanlı yanlış deneme tavanı aşamaz (oku-sonra-yaz
 * yarışı yok).
 *
 * ⚠️ Deneme YALNIZ geçerli bir token satır bulduğunda harcanır. Token'ı bilmeyen
 * biri hiçbir bütçeye dokunamaz — düzeltmenin çekirdeği budur.
 */
export async function verifyChallenge(
  rawToken: string,
  code: string,
  now: Date = new Date(),
): Promise<ChallengeResult> {
  const tokenHash = hashChallengeToken(rawToken);

  // Atomik deneme talebi: satır canlı VE bütçesi varsa sayacı artır.
  const claimed = await prisma.passwordResetChallenge.updateMany({
    where: {
      tokenHash,
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: prisma.passwordResetChallenge.fields.maxAttempts },
    },
    data: { attempts: { increment: 1 } },
  });

  const row = await prisma.passwordResetChallenge.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      attempts: true,
      maxAttempts: true,
      user: { select: { organizationId: true } },
    },
  });

  if (claimed.count === 0) {
    // Satır yok / ölü → hiçbir bütçe harcanmadı. Satır VAR ama bütçesi bittiyse
    // ayrı bir sebep döndürülür (çağıran eşik alarmını oraya bağlamaz — alarm
    // GEÇİŞTE atılır, ↓`signalExhausted`).
    if (row && row.attempts >= row.maxAttempts) return { ok: false, reason: "exhausted" };
    return { ok: false, reason: "not_found" };
  }
  if (!row) return { ok: false, reason: "not_found" }; // teorik: talep ile okuma arası silinme

  if (!(await verifyPassword(code, row.codeHash))) {
    // ⚠️ EŞİK ALARMI YALNIZ GEÇİŞTE (kullanıcı kararı, 08-02): her yanlış denemede
    // olay üretmek log/Sentry DoS'u olurdu. Bu deneme sayacı TAM tavana taşıdıysa
    // challenge başına BİR KEZ uyarılır.
    //
    // ⚠️ `+1` YOK: `row` yukarıdaki ATOMİK ARTIRMADAN SONRA okunuyor, yani
    // `row.attempts` zaten artırılmış değeri taşıyor. İlk yazımda `+1` vardı ve
    // alarm bir deneme ERKEN (4.'de) atıyordu — testin yakaladığı gerçek hata.
    if (row.attempts >= row.maxAttempts) {
      await signalExhausted(row.id, row.userId, row.user.organizationId);
    }
    return { ok: false, reason: "wrong_code" };
  }

  return {
    ok: true,
    challengeId: row.id,
    userId: row.userId,
    organizationId: row.user.organizationId,
  };
}

/**
 * Deneme bütçesi tükendi — REDAKTE uyarı (challenge başına BİR KEZ, geçişte).
 *
 * ⚠️ Ne token, ne token hash'i, ne kod, ne e-posta yazılır — yalnız OPAK challenge
 * id'si. Saldırının sessiz kalmaması bu turun bağımsız bulgusuydu: eski akışta
 * yakılan kod için ne denetim kaydı ne alarm vardı.
 */
async function signalExhausted(
  challengeId: string,
  actorUserId: string,
  organizationId: string,
): Promise<void> {
  try {
    await writeAudit({
      organizationId,
      // Kısayol (`actorUserId,`) bilinçli: bu, oturum ÖNCESİ bir akış ve aktör
      // challenge'ın sahibidir. `audit-actor-scoping` pini "çağıran sorumlu"
      // desenini böyle tanır — pin gevşetilmedi, kod ona uyduruldu.
      actorUserId,
      action: "account.password_reset_blocked",
      metadata: { challengeId, reason: "attempts_exhausted" },
    });
  } catch (err) {
    void reportError("pw-reset-challenge-audit", err);
  }
  // `reportError`'ün kendi 10 dk'lık context throttle'ı seli ayrıca sınırlar.
  void reportError(
    "pw-reset-challenge exhausted",
    new Error(`challenge=${challengeId} — parola sıfırlama deneme bütçesi tükendi`),
  );
}

/**
 * BAŞARILI sıfırlama — TEK TRANSACTION (kullanıcı kararı, 08-02).
 *
 * Dört yazma bölünemez: challenge tüketimi · diğer canlı challenge'ların iptali ·
 * parola değişimi · `sessionEpoch` artışı. Bölünseydi bir çökme yarım bir hâl
 * bırakırdı (ör. parola değişti ama oturumlar düşmedi = çalınmış token yaşamaya
 * devam eder).
 *
 * ⚠️ TEK-KULLANIM HAKEMİ `consumedAt`: tüketim `consumedAt: null` koşullu bir
 * `updateMany`'dir. Paralel iki DOĞRU istekte yalnız biri `count === 1` alır;
 * ikincisi `false` döner ve HİÇBİR yazma yapmaz.
 */
export async function consumeChallengeAndResetPassword(args: {
  challengeId: string;
  userId: string;
  organizationId: string;
  newPasswordHash: string;
  now?: Date;
}): Promise<number | null> {
  const now = args.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetChallenge.updateMany({
      where: { id: args.challengeId, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) return null; // yarışı kaybettik → hiçbir şey yazma

    // Bu kullanıcının DİĞER canlı challenge'ları kapanır — sıfırlama bittiğinde
    // ortada kullanılabilir başka bir sıfırlama yolu kalmamalı.
    await tx.passwordResetChallenge.updateMany({
      where: {
        userId: args.userId,
        id: { not: args.challengeId },
        consumedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });

    // Dönüş değeri BU sıfırlamanın ürettiği epoch'tur (aynı ifadede okunur; işlem sonrası okuma
    // araya giren başka bir artışı da alırdı — 09-23 inceleme turu).
    const updated = await tx.user.update({
      where: { id: args.userId },
      select: { sessionEpoch: true },
      data: {
        passwordHash: args.newPasswordHash,
        // Çalınmış her oturum bu artışla ölür — kullanıcının parolasını
        // sıfırlamasının ASIL sebebi budur.
        sessionEpoch: { increment: 1 },
        // Eski akışın kalıntısı da temizlenir (geçiş penceresinde ikisi bir arada).
        pwResetCodeHash: null,
        pwResetCodeExpiresAt: null,
        pwResetCodeAttempts: 0,
        // 🚨 Canlı e-posta doğrulama token'ı da ölür — gerekçe kardeş yolda
        // (`forgot-password/route.ts`) uzun uzun yazılı: epoch artışı o token'ı
        // öldürmüyor, çünkü doğrulama rotası oturumu TAZE epoch'la basıyor.
        emailVerifyTokenHash: null,
        emailVerifyExpiresAt: null,
      },
    });
    return updated.sessionEpoch;
  });
}

/**
 * Süresi dolmuş / tüketilmiş / iptal edilmiş satırları topla.
 * `scheduled-sync`'in DEEP penceresinden çağrılır (yeni cron YOK).
 *
 * ⚠️ CANLI satıra DOKUNMAZ. 24 saatlik gecikme bilinçli: kullanıcı desteğe
 * "sıfırlayamıyorum" diye yazdığında satırın izi bir süre daha duruyor.
 */
export async function sweepPasswordResetChallenges(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const res = await prisma.passwordResetChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: cutoff } },
        { consumedAt: { not: null }, createdAt: { lt: cutoff } },
        { invalidatedAt: { not: null }, createdAt: { lt: cutoff } },
      ],
    },
  });
  return res.count;
}
