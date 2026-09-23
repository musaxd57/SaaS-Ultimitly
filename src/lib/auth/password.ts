import bcrypt from "bcryptjs";

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

export function hashPassword(password: string): Promise<string> {
  return withSlot(() => bcrypt.hash(password, SALT_ROUNDS));
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withSlot(() => bcrypt.compare(password, hash));
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
 */
export async function dummyVerifyPassword(password: string): Promise<void> {
  await withSlot(() => bcrypt.compare(password, DUMMY_HASH));
}
