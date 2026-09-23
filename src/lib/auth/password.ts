import bcrypt from "bcryptjs";
import { normalizePassword } from "@/lib/auth/password-policy";

// bcrypt cost factor. 12 is the current sane default; existing hashes carry
// their own cost so older 10-cost hashes keep verifying (re-hashed on next set).
const SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// 🚨 EŞZAMANLILIK KAPISI (09-23, login ajanı F4 — ÖLÇÜLDÜ).
//
// `bcryptjs` SAF JS'tir: iş, ana iş parçacığında ~100 ms'lik parçalar hâlinde koşar.
// Bu konteynerde ölçüldü: tek karşılaştırma 315 ms; 8 eşzamanlı karşılaştırma 2,5 sn
// sürüyor ve bu sırada OLAY DÖNGÜSÜ ~800 ms'lik aralıklarla donuyor. Yani dağıtık bir
// parola denemesi (her IP kendi kovasının içinde kalarak) yalnız girişi değil TÜM
// uygulamayı — panel, cron, QR misafir sohbeti — yavaşlatabiliyordu.
//
// Çözüm: aynı anda en fazla N bcrypt işi (varsayılan 2 → döngü gecikmesi ~200 ms ile
// sınırlı); fazlası SINIRLI bir kuyrukta sınırlı süre bekler (meşru ani yoğunluk
// başarısız olmaz, gecikir); kuyruk doluysa ya da süre dolarsa `PasswordHashBusyError`
// → çağıran 503 "sunucu yoğun" döner. Kapı TÜM bcrypt işlerini (doğrulama, hash, sahte
// doğrulama) kapsar → bilinen/bilinmeyen kullanıcı yolları AYNI kapıdan geçer, zamanlama
// kâhini doğmaz. Değerler env'den (deploy'suz ayar): PASSWORD_HASH_MAX_IN_FLIGHT,
// PASSWORD_HASH_MAX_QUEUE, PASSWORD_HASH_MAX_WAIT_MS.
// ---------------------------------------------------------------------------

export class PasswordHashBusyError extends Error {
  constructor() {
    super("password hashing is saturated");
    this.name = "PasswordHashBusyError";
  }
}

const envInt = (name: string, fallback: number, min: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min ? n : fallback;
};
const maxInFlight = () => envInt("PASSWORD_HASH_MAX_IN_FLIGHT", 2, 1);
const maxQueue = () => envInt("PASSWORD_HASH_MAX_QUEUE", 32, 0);
const maxWaitMs = () => envInt("PASSWORD_HASH_MAX_WAIT_MS", 8_000, 1);

let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < maxInFlight()) {
    inFlight++;
    return;
  }
  if (waiters.length >= maxQueue()) throw new PasswordHashBusyError();
  await new Promise<void>((resolve, reject) => {
    const grant = () => {
      clearTimeout(timer);
      resolve(); // yuva `release`ten DEVREDİLDİ — `inFlight` değişmez
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(grant);
      if (i >= 0) waiters.splice(i, 1);
      reject(new PasswordHashBusyError());
    }, maxWaitMs());
    waiters.push(grant);
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else inFlight--;
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** TEST KANCASI (salt-okuma): kapının anlık durumu. */
export function __passwordHashSlots(): { inFlight: number; queued: number } {
  return { inFlight, queued: waiters.length };
}

// ---------------------------------------------------------------------------
// ③ SAKLAMA/DOĞRULAMA BİÇİMİ: Unicode NFC (kurucu onayı 09-23; kural ve gerekçe
// `password-policy.ts`te — bcrypt'siz, şemalar da oradan okur).
//   · SAKLAMA daima NFC biçiminden — "ş"nin iki kodlaması da aynı parolaya girer;
//   · DOĞRULAMA önce NFC'yi, girdi NFC değilse HAM biçimi de dener: bu düzeltmeden
//     ÖNCE ham NFD olarak saklanmış parola kilitlenmez (girişte NFC'ye taşınır, ④);
//   · SAHTE doğrulama (bilinmeyen kullanıcı) AYNI sayıda karşılaştırma yapar →
//     "hesap var mı" zamanlama kâhini doğmaz.
// ---------------------------------------------------------------------------
export {
  normalizePassword,
  newPasswordProblem,
  passwordExceedsByteLimit,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
} from "@/lib/auth/password-policy";

async function compareStored(password: string, hash: string): Promise<{ ok: boolean; legacyForm: boolean }> {
  const nfc = normalizePassword(password);
  if (await bcrypt.compare(nfc, hash)) return { ok: true, legacyForm: false };
  if (nfc !== password && (await bcrypt.compare(password, hash))) return { ok: true, legacyForm: true };
  return { ok: false, legacyForm: false };
}

export function hashPassword(password: string): Promise<string> {
  return withSlot(() => bcrypt.hash(normalizePassword(password), SALT_ROUNDS));
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withSlot(async () => (await compareStored(password, hash)).ok);
}

/**
 * ④ GİRİŞ YOLU: doğrula + saklanan hash'in yükseltilmesi gerekip gerekmediğini söyle
 * (maliyet < `SALT_ROUNDS` ya da eski ham biçim). Yükseltme YALNIZ doğru parolada
 * istenir. Yazmayı çağıran yapar (`password-upgrade.ts`, CAS'lı ve kuyruksuz).
 */
export function verifyPasswordForLogin(
  password: string,
  hash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  return withSlot(async () => {
    const r = await compareStored(password, hash);
    // Bozuk/tanınmayan hash'te `getRounds` NaN döner → karşılaştırma false → yükseltme yok.
    return { ok: r.ok, needsRehash: r.ok && (r.legacyForm || bcrypt.getRounds(hash) < SALT_ROUNDS) };
  });
}

/**
 * Yalnız ŞU AN boş bir yuva varsa hash'ler; yoksa `null` döner ve KUYRUĞA GİRMEZ.
 * Arka plan niteliğindeki işler (girişte hash yükseltme) içindir: meşru girişlerin
 * kuyruğunu uzatmamalı, doluysa bir sonraki fırsata kalır.
 */
export async function hashPasswordIfIdle(password: string): Promise<string | null> {
  // Yuva boşsa kuyruk da boştur: `release` yuvayı bekleyene DEVREDER, boşaltmaz.
  if (inFlight >= maxInFlight()) return null;
  inFlight++;
  try {
    return await bcrypt.hash(normalizePassword(password), SALT_ROUNDS);
  } finally {
    release();
  }
}

// A fixed, valid bcrypt hash (cost 12, matching SALT_ROUNDS) of a throwaway
// secret. It is NEVER anyone's real password, so a comparison against it always
// fails — its only job is to spend the SAME bcrypt time on a login attempt for a
// non-existent email as for a real account.
const DUMMY_HASH = "$2a$12$pW7aCpH9gDjLDJgWwMZS9e4XetljqUVeM6688s259LuXEGh42XYii";

/**
 * Constant-time guard for the "no such user" branch: runs a real bcrypt compare
 * (result discarded) so an attacker can't tell a registered email from an
 * unregistered one by response latency (user enumeration). Always resolves; the
 * caller still returns the same generic "wrong credentials" error either way.
 * (Goes through the SAME concurrency gate as a real verify — see above.)
 * ③ Aynı SAYIDA karşılaştırma: NFC olmayan girdide gerçek yol başarısızken iki kez
 * karşılaştırır (NFC + ham), sahte yol da iki kez — yoksa bilinmeyen hesap ölçülebilir
 * biçimde hızlı döner.
 */
export async function dummyVerifyPassword(password: string): Promise<void> {
  await withSlot(async () => {
    const nfc = normalizePassword(password);
    await bcrypt.compare(nfc, DUMMY_HASH);
    if (nfc !== password) await bcrypt.compare(password, DUMMY_HASH);
  });
}
