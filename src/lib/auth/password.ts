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

// ---------------------------------------------------------------------------
// 🚨 ESKİ HASH ZAMANLAMA KÂHİNİ (09-23 saldırgan turu, ölçüldü). Bilinmeyen e-posta
// maliyet-12 SAHTE hash'e karşı doğrulanır (~315 ms); 05-31 → 06-09 arasında belirlenmiş
// parolalar maliyet-10'dur (~80 ms) → yanlış parolayla TEK istek "bu e-posta kayıtlı (ve erken
// dönem hesabı)" diye okunuyordu (4 kat fark, ilk hesaplar dahil). Girişte yükseltme (④) yalnız
// giriş YAPAN hesabı kapatır.
//
// Çözüm İŞ EŞİTLİĞİ: maliyeti r olan karşılaştırma 2^r tur yapar ve maliyet-12 =
// maliyet-10 + maliyet-10 + maliyet-11 (1024 + 1024 + 2048 = 4096). Başarısız doğrulamadan sonra,
// AYNI YUVANIN İÇİNDE, r..11 maliyetli birer sahte karşılaştırma yapılır → toplam iş sahte yolla
// birebir aynı ve yük altında da öyle kalır (ikisi de aynı işlemciyi aynı biçimde kullanır).
// 🚨 İlk çözüm (yuvayı bırakıp gözlenen maliyet-12 ortalamasına kadar UYUMAK) iki yerden
// sızıyordu (inceleme ajanı, 09-23): yuvayı erken bıraktığı için eşzamanlı isteklerde bitiş sırası
// farklıydı; ortalama da saldırganın ürettiği yükle kaydırılabiliyordu. UYKUYA GERİ DÖNME.
// Ölçüm (bu konteyner): tek istek 318 ms ↔ 319 ms; 6 eşzamanlı istek 1,95 sn ↔ 1,90 sn.
// Başarılı giriş dolgulanmaz (sahibin girişi yavaşlamaz; başarı zaten yanıttan belli).
// ---------------------------------------------------------------------------

// Kimsenin parolası olmayan atılmış sırların sabit hash'leri (DUMMY_HASH gibi).
const PAD_HASH: Record<number, string> = {
  10: "$2a$10$0kcZHXK5X7dZx3PSVXrO7.yL6Slrxmr1Q6IpbAmY1vdF5jJ8RntNC",
  11: "$2a$11$y6pHMA9mnaj.ULekVMo9Pum553XQiK7nI2FKk3CElBn1TNZqNn.tK",
};

/** Başarısız TEK karşılaştırmayı sahte yolun işine tamamlar. Yuvanın İÇİNDE çağrılır. */
async function padLowCostFailure(value: string, rounds: number): Promise<void> {
  if (rounds === 10 || rounds === 11) {
    for (let k = rounds; k < SALT_ROUNDS; k++) await bcrypt.compare(value, PAD_HASH[k]);
  } else {
    // Üretimde yok (yalnız maliyet 10 ve 12 var): tam bir sahte karşılaştırma — fark en fazla
    // maliyet-r'nin kendisi kadar (≤ maliyet-9 ≈ 40 ms).
    await bcrypt.compare(value, DUMMY_HASH);
  }
}

/**
 * ④ GİRİŞ YOLU: doğrula + saklanan hash'in yükseltilmesi gerekip gerekmediğini söyle
 * (maliyet < `SALT_ROUNDS` ya da eski ham biçim). Yükseltme YALNIZ doğru parolada
 * istenir. Yazmayı çağıran yapar (`password-upgrade.ts`, CAS'lı ve kuyruksuz).
 */
export async function verifyPasswordForLogin(
  password: string,
  hash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  // Bozuk/tanınmayan hash'te `getRounds` NaN döner → karşılaştırmalar false → dolgu ve yükseltme yok.
  const rounds = bcrypt.getRounds(hash);
  const r = await withSlot(async () => {
    const out = await compareStored(password, hash);
    if (!out.ok && rounds < SALT_ROUNDS) {
      // `compareStored` ile AYNI sayıda: NFC her zaman, ham biçim yalnız NFC'den farklıysa.
      const nfc = normalizePassword(password);
      await padLowCostFailure(nfc, rounds);
      if (nfc !== password) await padLowCostFailure(password, rounds);
    }
    return out;
  });
  return { ok: r.ok, needsRehash: r.ok && (r.legacyForm || rounds < SALT_ROUNDS) };
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
