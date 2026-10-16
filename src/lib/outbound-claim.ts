import "server-only";

import { createHash, createHmac } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Short-lived, DB-backed duplicate-send guard for MANUAL outbound replies.
// A double-click, a browser/proxy POST retry, or two tabs can hit the reply
// route concurrently — the route had no server-side idempotency, so the same
// text could reach the guest twice. Same primitive as the plan-change nonce:
// SystemLock's unique @id makes create() the atomic claim, which is correct
// across replicas (unlike the in-memory rate limiter).
//
// The key is {conversationId, sha256(body)}. The TTL must EXCEED the worst-case
// delivery duration (the sweep below deletes expired rows — a TTL shorter than a
// slow in-flight send would let a late browser/proxy retry sweep the live claim and
// deliver twice; adversarial-review finding). The send itself is now a SINGLE shot
// (`retries: 0` in channels/hospitable-outbound.ts — POST /messages is not
// idempotent); the TTL was sized for the older 4×20s client retry (~87s) and is
// kept as headroom for one slow attempt (10-16 kuyruk envanteri). 120s; the
// cost is only that the SAME text can't be re-sent for 2 minutes after success
// (a failed send releases immediately). Auto-reply paths have their own
// claim-then-send (conversation/reservation updateMany) and don't use this.
// ---------------------------------------------------------------------------

const CLAIM_TTL_MS = 120_000;
const PREFIX = "outbound-send:";

function claimName(conversationId: string, body: string): string {
  const digest = createHash("sha256").update(body).digest("base64url").slice(0, 24);
  return `${PREFIX}${conversationId}:${digest}`;
}

/**
 * Atomically claim "this exact text is being sent on this conversation right now".
 * "claimed" on the first claim; "duplicate" when an identical send is in flight
 * or just happened (within the TTL); "unavailable" (fail-CLOSED) when the lock
 * store itself errors — with the store down a duplicate delivery could not be
 * detected, so the send is refused instead.
 */
export type OutboundClaim = "claimed" | "duplicate" | "unavailable";

export async function claimOutboundSend(conversationId: string, body: string): Promise<OutboundClaim> {
  const now = new Date();
  // Opportunistic sweep: expired claims can't dedup anything anymore (their TTL
  // has passed), so drop them to keep SystemLock from growing unbounded.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: PREFIX }, lockedUntil: { lt: now } } })
    .catch(() => {});
  try {
    await prisma.systemLock.create({
      data: { name: claimName(conversationId, body), lockedUntil: new Date(now.getTime() + CLAIM_TTL_MS) },
    });
    return "claimed";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    // Unknown store error → fail CLOSED (Codex): with the lock store down the
    // post-send persist would fail too, and a user retry would re-deliver to the
    // guest. A 503 "try again shortly" is the safe, honest answer.
    return "unavailable";
  }
}

/** Release after a FAILED delivery so the same text can be retried immediately. */
export async function releaseOutboundSend(conversationId: string, body: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: claimName(conversationId, body) } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Keyed variant (QR guest chat, Codex 07-24 r2): the claim key is the caller's
// SCOPE id alone (e.g. qr-in:{reservationId}:{requestId}) and the payload
// digest is stored IN the row (SystemLock.holder). A duplicate can then be
// CLASSIFIED instead of guessed: same digest → a true retry of the same
// composed message ("duplicate" → dedupe); different digest → the id was
// REUSED with different content ("mismatch" → the caller 409s, so the second
// message is neither silently swallowed nor double-processed). The body-in-key
// scheme above cannot make this distinction — a different body just misses the
// existing claim entirely.
//
// ÇALIŞAN İŞLEM KİLİDİ ≠ TAMAMLANMIŞ İSTEK KAYDI (kurucu 10-16, "300'e çıkarmayın"): aynı satırın iki hâli.
//  · Çalışan: `holder = <özet>.<işçi jetonu>`, süre 120 sn (çöken işçi en geç 2 dk sonra yeniden denemeyi serbest bırakır).
//  · Tamamlanmış: iş KAYDEDİLDİĞİ İŞLEMDE `holder = done:<özet>`, süre 24 sa → aynı isteğin geç tekrarı (kopan bağlantı, uyuyan
//    telefon) yine "duplicate"; misafirin YENİ mesajı yeni kimlik taşır, hiç beklemez.
//  · Fencing: kilit süresi dolup başka işçi aynı isteği aldıysa eski işçinin kaydı (`completeKeyedOutboundSend`) işlemi geri alır
//    (`KeyedClaimLostError`) ve bırakma yalnız KENDİ jetonlu satırını siler — yeni işçinin canlı kilidine dokunmaz.
// Jetonsuz eski biçim (`holder = <özet>`, önceki sürümün yazdığı satır) okunurken özet olarak tanınır (sürüm geçişinde sınıflandırma bozulmaz).
// ---------------------------------------------------------------------------

export type KeyedOutboundClaim = "claimed" | "duplicate" | "mismatch" | "unavailable";

/** Tamamlanmış istek kaydının ömrü (kurucu 10-16). */
export const KEYED_DONE_TTL_MS = 24 * 3_600_000;
const DONE_PREFIX = "done:";

/**
 * Misafir metninin ANAHTARLI özeti (Opus F7, 10-16): satır 24 saat yaşıyor ve misafirden türeyen metin VERİDİR — anahtarsız SHA-256 kısa
 * metinlerde ("Merhaba", oda no) sözlükle geri çevrilebilirdi. Karşılaştırma yalnız eşitlik ister; anahtar sunucu sırrı (`AUTH_SECRET`,
 * açılış doğrulamasıyla zorunlu). Sır yoksa (yalnız yerel / test) eski anahtarsız özet. base64url → "." ve ":" içermez (biçim ayrıştırması).
 */
function bodyDigest(body: string): string {
  const key = process.env.AUTH_SECRET;
  const h = key ? createHmac("sha256", key).update(`qr-claim:v1:${body}`) : createHash("sha256").update(body);
  return h.digest("base64url").slice(0, 24);
}

/** Önceki sürümün anahtarsız özeti — yalnız SINIFLANDIRMADA (Haiku 10-16): yayından hemen önce yazılmış kilidin (≤ 120 sn) tekrarı
 *  "farklı içerik" 409'u almasın. Yeni satır HİÇBİR ZAMAN bu biçimle yazılmaz. */
function legacyBodyDigest(body: string): string {
  return createHash("sha256").update(body).digest("base64url").slice(0, 24);
}

function inflightHolder(digest: string, token: string): string {
  return `${digest}.${token}`;
}

/** Satırdaki özet: tamamlanmış (`done:<özet>`), çalışan (`<özet>.<jeton>`) ya da eski sürümün jetonsuz biçimi (`<özet>`). base64url'de "." yok. */
function digestOfHolder(holder: string | null): string | null {
  if (!holder) return null;
  if (holder.startsWith(DONE_PREFIX)) return holder.slice(DONE_PREFIX.length);
  const dot = holder.indexOf(".");
  return dot === -1 ? holder : holder.slice(0, dot);
}

/** Eski işçi işini kaybetti: kilidin süresi doldu ve aynı isteği başka işçi aldı / bitirdi. Kayıt işlemi geri alınır. */
export class KeyedClaimLostError extends Error {
  constructor() {
    super("keyed outbound claim lost to a newer holder");
    this.name = "KeyedClaimLostError";
  }
}

export async function claimKeyedOutboundSend(scopeId: string, body: string, token: string): Promise<KeyedOutboundClaim> {
  const now = new Date();
  const digest = bodyDigest(body);
  const name = `${PREFIX}${scopeId}`;
  // Same opportunistic sweep as claimOutboundSend: an EXPIRED claim (its holder
  // crashed mid-flight, or the completed record's 24 h passed) must never block a
  // retry — after the TTL the row is dropped and the retry claims fresh.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: PREFIX }, lockedUntil: { lt: now } } })
    .catch(() => {});
  try {
    await prisma.systemLock.create({
      data: { name, lockedUntil: new Date(now.getTime() + CLAIM_TTL_MS), holder: inflightHolder(digest, token) },
    });
    return "claimed";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      try {
        const row = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true } });
        // Row vanished between the failed create and this read (a racing sweep on
        // a just-expired row) — refuse honestly; the client's next retry claims.
        if (!row) return "unavailable";
        const stored = digestOfHolder(row.holder);
        return stored === digest || stored === legacyBodyDigest(body) ? "duplicate" : "mismatch";
      } catch {
        return "unavailable";
      }
    }
    // Store down → fail CLOSED (same reasoning as claimOutboundSend).
    return "unavailable";
  }
}

/**
 * İşin KAYDEDİLDİĞİ işlemin içinde çağrılır: bu işçinin çalışan kilidi 24 saatlik tamamlanmış kayda döner. Kilit artık bu işçinin değilse
 * (süresi doldu, başka işçi aldı ya da bitirdi) `KeyedClaimLostError` → işlem geri alınır, hiçbir şey yazılmaz. Kilit süpürülmüş ve kimse
 * almamışsa kaydı bu işçi yazar (yarışan alıcı anahtarda bekler, sonra "duplicate" görür).
 */
export async function completeKeyedOutboundSend(
  tx: Prisma.TransactionClient,
  scopeId: string,
  body: string,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  const name = `${PREFIX}${scopeId}`;
  const digest = bodyDigest(body);
  const done = { holder: `${DONE_PREFIX}${digest}`, lockedUntil: new Date(now.getTime() + KEYED_DONE_TTL_MS) };
  const own = await tx.systemLock.updateMany({ where: { name, holder: inflightHolder(digest, token) }, data: done });
  if (own.count === 1) return;
  // Kendi kilidimiz yok: satır başka işçinindir (anahtar çakışır → kaybettik) ya da süpürülmüştür (kaydı biz yazarız).
  try {
    await tx.systemLock.create({ data: { name, ...done } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new KeyedClaimLostError();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// KİLİT YENİLEME (kurucu 10-16: "yalnız işin sonunda sahiplik kontrolüyle yetinme — kilit yenileme, sahiplik kaybı ve kalıcı kayıtların
// tekilliği, eski işçi hâlâ çalışırken ikinci işçinin devreye girdiği testle doğrulansın"). Canlı işçi çalışırken kilidini düzenli YENİLER →
// süre dolup başka işçinin aynı isteği alması yalnız işçi gerçekten durduğunda olur. Yenileme kendi jetonlu satırı bulamazsa SAHİPLİK
// KAYBEDİLMİŞTİR (süpürüldü / başka işçi aldı) → `onLost` çağrılır; çağıran sonraki ücretli adımdan önce durur. Son güvence yine kayıt
// işlemindeki tamamlama (`completeKeyedOutboundSend`).
// ---------------------------------------------------------------------------

let heartbeatMs = 30_000;

/** Tek yenileme: bu işçinin çalışan kilidini 120 sn uzatır; satır artık bu işçinin değilse false. */
export async function renewKeyedOutboundSend(scopeId: string, body: string, token: string, now: Date = new Date()): Promise<boolean> {
  const name = `${PREFIX}${scopeId}`;
  const holder = inflightHolder(bodyDigest(body), token);
  const lockedUntil = new Date(now.getTime() + CLAIM_TTL_MS);
  const r = await prisma.systemLock.updateMany({ where: { name, holder }, data: { lockedUntil } });
  if (r.count === 1) return true;
  // Satır HİÇ yoksa (süresi doldu, süpürüldü, kimse almadı) bu işçi kilidi YENİDEN alır — `completeKeyedOutboundSend` ile aynı kural
  // ("kimse almamışsa kaydı bu işçi yazar"; Opus 10-16 N2: aksi hâlde misafir mesajı iz bırakmadan 'deduped' olurdu). Satır başka
  // sahipteyse (yeni işçi ya da tamamlanmış kayıt) eşsiz ad çakışır → sahiplik gerçekten kaybedildi.
  try {
    await prisma.systemLock.create({ data: { name, lockedUntil, holder } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** Yenileme döngüsünü başlatır; durdurma fonksiyonu döner. Veritabanı hatası kayıp SAYILMAZ (bir sonraki turda yeniden denenir). */
export function startKeyedClaimHeartbeat(scopeId: string, body: string, token: string, onLost: () => void): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    renewKeyedOutboundSend(scopeId, body, token)
      .then((held) => {
        if (!held && !stopped) {
          stopped = true;
          clearInterval(timer);
          onLost();
        }
      })
      .catch(() => {});
  }, heartbeatMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Test yardımcısı: yenileme aralığı. */
export function __setKeyedClaimHeartbeatMs(ms: number): void {
  heartbeatMs = ms;
}

/** Release a keyed claim after a failure that recorded NOTHING (the retry must
 *  be processed, not deduped against zero work). Yalnız bu işçinin KENDİ çalışan kilidi silinir (fencing): süresi dolmuş eski işçi,
 *  aynı isteği almış yeni işçinin canlı kilidini ya da tamamlanmış kaydı silemez. */
export async function releaseKeyedOutboundSend(scopeId: string, body: string, token: string): Promise<void> {
  await prisma.systemLock
    .deleteMany({ where: { name: `${PREFIX}${scopeId}`, holder: inflightHolder(bodyDigest(body), token) } })
    .catch(() => {});
}
