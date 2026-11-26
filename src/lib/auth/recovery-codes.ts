import "server-only";

import { createHash, randomInt, scrypt as scryptCallback, type ScryptOptions } from "crypto";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// 2FA recovery codes (Codex #20) — the "telefonumu kaybettim" escape hatch.
//
//  * 10 codes per generation, format XXXX-XXXX-XXXX from a 30-char alphabet
//    with the confusable glyphs removed (no I/L/O/U/0/1) → ~59 bits each.
//    crypto.randomInt = CSPRNG.
//  * Stored as HASHES of the normalized code — the plaintext exists only in the
//    generation response (shown once). 🚨 v2 (sızma testi 11-14, B-1): scrypt,
//    tuz = alan öneki + KULLANICI KİMLİĞİ. Eski v1 tuzsuz + anahtarsız TEK sha256'ydı:
//    veritabanı dökümü ele geçirilirse ~59 bitlik kod alanı GPU ile bütün
//    kullanıcılar için aynı anda taranabiliyordu (tek kullanıcı ~60 GPU-günü, 100
//    kullanıcıdan herhangi biri ~15 saat). v2'de kullanıcılar arası toplu tarama
//    yok ve her deneme scrypt maliyeti öder. Hâlâ deterministik (kullanıcı başına)
//    → `userId + codeHash` ile aranır. Bilerek ANAHTARSIZ (sunucu sırrı yok): sır
//    değişince kilitli bir kullanıcının son kapısı kapanmasın. v1 satırları OKUMADA
//    kabul edilir (kilitlenme yok), yeni üretilen her kod v2 yazılır.
//    ⚠️ KALAN RİSK: eski v1 satırları kullanıcı kodlarını YENİDEN ÜRETENE kadar
//    durur (düz metin elde olmadığı için okumada v2'ye çevrilemez; tüketilen kod
//    zaten yanar). Yerinde sarma (v1 özetini kullanıcı tuzuyla scrypt'e sarmak)
//    kimlik akışına dokunduğu için kurucu onayında — docs/INCELEME-2026-11-14-sizma-testi-tur1.md.
//  * Single-use burn is ATOMIC: conditional updateMany on usedAt (the same
//    pattern as the TOTP step burn / e-mail-verify consume) — two concurrent
//    logins with one code can't both pass.
//  * Regeneration deletes the user's old rows in the same transaction, so old
//    codes die the moment new ones exist.
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // 30 chars, unambiguous
const GROUPS = 3;
const GROUP_LEN = 4;
export const RECOVERY_CODE_LEN = GROUPS * GROUP_LEN; // normalized length (12)

/** Uppercase and strip separators/junk — "abcd-efgh jkmn" → "ABCDEFGHJKMN". */
export function normalizeRecoveryCode(input: string): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** ESKİ (v1) özet: tuzsuz tek sha256. YALNIZ okumada kabul edilir — yeni satıra ASLA yazılmaz. */
export function legacyRecoveryCodeHash(normalized: string): string {
  return createHash("sha256").update(`lixus-2fa-recovery:v1:${normalized}`).digest("hex");
}

/** scrypt maliyeti: N=2^14, r=8 (~16 MB, tek çekirdekte onlarca ms). Doğrulama yalnız 2FA girişinde, kod üretimi seyrek. */
const SCRYPT_OPTIONS: ScryptOptions = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const V2_PREFIX = "v2:";

function scryptHex(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, SCRYPT_OPTIONS, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
  });
}

/** v2 özet: kullanıcı kimliğiyle tuzlanmış scrypt (deterministik → `userId + codeHash` ile aranır). Biçim `v2:<64 hex>`. */
export async function hashRecoveryCode(userId: string, normalized: string): Promise<string> {
  return V2_PREFIX + (await scryptHex(normalized, `lixus-2fa-recovery:v2:${userId}`));
}

/** Bu kodun saklanmış olabileceği BÜTÜN özetler (v2 + eski v1) — doğrulama ikisinde de arar. */
async function candidateHashes(userId: string, normalized: string): Promise<string[]> {
  return [await hashRecoveryCode(userId, normalized), legacyRecoveryCodeHash(normalized)];
}

async function hashedRows(userId: string, codes: string[]): Promise<{ userId: string; codeHash: string }[]> {
  return Promise.all(codes.map(async (c) => ({ userId, codeHash: await hashRecoveryCode(userId, normalizeRecoveryCode(c)) })));
}

/** One plaintext code, e.g. "K7QW-P2MH-9DTR". */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

/**
 * Replace the user's recovery codes with a fresh set and return the PLAINTEXTS
 * (the only time they ever exist outside the caller's response). Atomic: old
 * codes are gone iff the new ones are in.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  // Özetler işlemden ÖNCE (scrypt işlem içinde kilit tutmasın).
  const data = await hashedRows(userId, codes);
  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({ data }),
  ]);
  return codes;
}

/**
 * Kurtarma kodlarını YALNIZ doğrulanan 2FA kurulumu hâlâ duruyorsa yeniden üret (Codex 09-30, C1 kardeşi). Rota kodu başta
 * okuduğu sırra göre doğrular; arada 2FA kapatılıp YENİ bir sırla kurulduysa eski sırrın koduna dayanarak yeni kurulum için
 * 10 kalıcı atlama kodu üretilirdi. Koşullu yazma satırı işlem sonuna kadar kilitler: eşzamanlı kapatma / yeniden kurma
 * bizden SONRA koşar ve kodlarımızı zaten siler. Kurulum değiştiyse null (hiçbir şey yazılmaz).
 */
export async function regenerateRecoveryCodesIfUnchanged(
  userId: string,
  guard: { twoFactorSecret: string | null; twoFactorEnabledAt: Date | null; sessionEpoch?: number },
): Promise<string[] | null> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const data = await hashedRows(userId, codes);
  return prisma.$transaction(async (tx) => {
    const still = await tx.user.updateMany({
      // U40 kardeşi (Codex 10-07): verilmişse başlangıçta denetlenen oturum sürümü de koşulda (arada iptal edilen oturum kod üretemez).
      where: {
        id: userId,
        twoFactorSecret: guard.twoFactorSecret,
        twoFactorEnabledAt: guard.twoFactorEnabledAt,
        ...(guard.sessionEpoch === undefined ? {} : { sessionEpoch: guard.sessionEpoch }),
      },
      data: { twoFactorSecret: guard.twoFactorSecret },
    });
    if (still.count === 0) return null;
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
    await tx.twoFactorRecoveryCode.createMany({ data });
    return codes;
  });
}

/** Delete every recovery code of a user (2FA disable — codes die with it). */
export async function clearRecoveryCodes(userId: string): Promise<void> {
  await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } });
}

/** Unused codes left — surfaced in Settings so the host knows when to renew. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
}

/**
 * Kod geçerli ve KULLANILMAMIŞ mı — TÜKETMEZ (M-2, Opus S7). Yalnız girişte, gidecek etkin üyeliği olmayan kişi için: kodu yakmadan
 * "doğru kod" ile "hatalı kod"u ayırır (doğruysa 403, kod geçerli kalır; yeniden davetten sonra kullanılır). Tüketme kararı YİNE
 * `consumeRecoveryCode`'un atomik koşullu güncellemesidir — bu okuma kimseye oturum açmaz.
 */
export async function recoveryCodeIsUsable(userId: string, input: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== RECOVERY_CODE_LEN) return false;
  const row = await prisma.twoFactorRecoveryCode.findFirst({
    where: { userId, codeHash: { in: await candidateHashes(userId, normalized) }, usedAt: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Try to burn one recovery code for this user. TRUE exactly once per code:
 * the conditional updateMany is the atomic arbiter (usedAt must still be null),
 * scoped to userId so one user's code can never unlock another's account.
 */
export async function consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== RECOVERY_CODE_LEN) return false;
  // v1 ve v2 aynı kodun iki satırı olamaz (v2 yalnız yeni üretimde yazılır, üretim eski satırları siler) → en çok bir satır tutar.
  const res = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: { in: await candidateHashes(userId, normalized) }, usedAt: null },
    data: { usedAt: new Date() },
  });
  return res.count === 1;
}
