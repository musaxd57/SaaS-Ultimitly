// ---------------------------------------------------------------------------
// GÖNDERDİĞİMİZ OTOMATİK MESAJIN İZİ (K7, migration 58, kurucu onayı 09-30).
//
// Karşılama / giriş / çıkış mesajlarını kanala biz göndeririz; sağlayıcı bir sonraki senkronda aynı mesajı konuşmanın
// giden mesajı olarak geri getirir. Eskiden içe aktarma yazar bilgisi olmayan her giden mesajı "ev sahibi" yazıyordu →
// ev sahibinde tutulan hassas istek (ör. IBAN) "Yanıtladınız" oluyor, konuşma "cevaplandı" görünüyor, cevapsız misafir
// penceresi sıfırlanıyor ve ardından gelen "Teşekkürler" konuşmayı gizleyebiliyordu (inceleme b6-1 / b2-2, CANLI).
//
// Kural: gönderimden ÖNCE bir iz yazılır (metin DEĞİL, normalize edilmiş gövdenin SHA-256 özeti), sonuçla kapanır. İçe
// aktarma giden bir sağlayıcı mesajını yazmadan önce bu izle eşleştirir; eşleşen mesaj `authorType: "automation"` olur
// (`message-author.ts` — cevap değildir). Eşleşme sırası: sağlayıcı mesaj kimliği → aynı thread + aynı özet + sağlayıcı
// anı [gönderim − 2 dk, gönderim + 24 sa]. Bire bir: bir iz tek bir sağlayıcı mesajına bağlanır (aynı mesajın yeniden
// içe aktarımı aynı ize yeniden bağlanabilir).
//
// Her şey EN İYİ ÇABA: izin yazılamaması gönderimi durdurmaz (mesaj bugünkü gibi "ev sahibi" olarak geri gelir).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const AUTOMATED_SEND_KINDS = ["welcome", "checkin", "checkout"] as const;
export type AutomatedSendKind = (typeof AUTOMATED_SEND_KINDS)[number];

export function isAutomatedSendKind(v: string | null | undefined): v is AutomatedSendKind {
  return (AUTOMATED_SEND_KINDS as readonly string[]).includes(v ?? "");
}

/** Sağlayıcının mesaj anı gönderimden en çok bu kadar ÖNCE olabilir (saat farkı payı). */
export const AUTOMATED_MATCH_BEFORE_MS = 2 * 60_000;
/** … ve en çok bu kadar SONRA (senkron gecikmesi / belirsiz gönderimin sonradan görünmesi). */
export const AUTOMATED_MATCH_AFTER_MS = 24 * 3_600_000;
/** İz ömrü — eşleşme penceresinin çok üstünde; metin taşımasa da süresiz tutulmaz. */
export const AUTOMATED_SEND_RETENTION_MS = 14 * 86_400_000;

/** Eşleşmeye aday durumlar: `failed` = teslim edilmedi, eşleşmez. */
const MATCHABLE_STATES = ["pending", "sent", "unverified"] as const;

/**
 * Özetin girdisi: NFC, NUL yok, satır sonu LF, satır sonu boşlukları kırpılır, 3+ boş satır 2'ye iner, baş/son kırpılır.
 * DOĞRUSAL — satır başına `trimEnd` (düzenli ifadeyle "boşluk+$" uzun boşluk dizisinde karesel iş yapardı).
 */
export function normalizeAutomatedBody(body: string): string {
  const lines = body.normalize("NFC").split("\u0000").join("").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let blank = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "") {
      blank++;
      if (blank > 1) continue;
    } else {
      blank = 0;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export function automatedBodyHash(body: string): string {
  return createHash("sha256").update(normalizeAutomatedBody(body), "utf8").digest("hex");
}

export interface AutomatedSendTarget {
  organizationId: string;
  propertyId: string;
  reservationId: string | null;
  externalReservationId: string;
  kind: AutomatedSendKind;
  body: string;
  /** UYGULAMA saati (şema varsayılanı değil). */
  sentAt: Date;
}

/**
 * Gönderimden ÖNCE iz yaz (`pending`). Kimliği döner; yazılamazsa null — gönderim yine yapılır (en iyi çaba), mesaj
 * geri geldiğinde bugünkü gibi "ev sahibi" sayılır.
 */
export async function recordAutomatedSend(db: Db, t: AutomatedSendTarget): Promise<string | null> {
  try {
    const row = await db.automatedMessageSend.create({
      data: {
        organizationId: t.organizationId,
        propertyId: t.propertyId,
        reservationId: t.reservationId,
        externalReservationId: t.externalReservationId,
        kind: t.kind,
        bodyHash: automatedBodyHash(t.body),
        state: "pending",
        sentAt: t.sentAt,
      },
      select: { id: true },
    });
    return row.id;
  } catch {
    return null;
  }
}

/**
 * İzi sonuçla kapat: `sent` (sağlayıcı kimliğiyle) · `unverified` (belirsiz — teslim edilmiş olabilir, eşleşmeye açık
 * kalır) · `failed` (teslim edilmedi — eşleşmez).
 */
export async function settleAutomatedSend(
  db: Db,
  id: string | null,
  outcome: "sent" | "unverified" | "failed",
  providerMessageId?: string | null,
): Promise<void> {
  if (!id) return;
  try {
    await db.automatedMessageSend.update({
      where: { id },
      data: { state: outcome, ...(outcome === "sent" && providerMessageId ? { providerMessageId } : {}) },
    });
  } catch {
    // En iyi çaba: iz `pending` kalır (eşleşmeye açık) — teslim edilmemiş bir mesajın izinin eşleşmesi için aynı thread'de
    // aynı metnin 24 saat içinde gerçekten gönderilmesi gerekir.
  }
}

/**
 * İzi SİL — gönderim hiç yapılmamış sayılır. Yalnız sağlayıcının "çok fazla istek" (429) cevabında: mesaj teslim edilmedi (eşleşecek bir
 * şey yok) ve hata bu MESAJIN hatası değil (↓ yeniden deneme defteri onu saymamalı). En iyi çaba.
 */
export async function discardAutomatedSend(db: Db, id: string | null): Promise<void> {
  if (!id) return;
  try {
    await db.automatedMessageSend.delete({ where: { id } });
  } catch {
    // İz `pending` kalır: 24 saatlik eşleşme penceresinde aynı metin gerçekten gönderilirse ona bağlanabilir (zararsız).
  }
}

// ---------------------------------------------------------------------------
// YENİDEN DENEME DEFTERİ (S8, kurucu kararı 11-11: "rezervasyona tek sayaç değil; her gönderim niyetinin kendi durumu, deneme sayısı,
// sonraki deneme zamanı olsun; mevcut otomatik gönderim kaydı genişletilsin, ikinci bir kuyruk kurulmasın").
//
// Kalıcı kuyruk KAPALIYKEN çalışan doğrudan yol, sağlayıcının KESİN reddinde (4xx) damgayı geri alıp aynı mesajı HER turda (2 dakikada bir)
// yeniden deniyordu — günde 720 istek, konaklama tarihi geçene kadar. Ayrıca reddedilen rezervasyonlar 25'lik listenin başını dolduruyor,
// arkadaki gönderilebilir rezervasyona sıra gelmiyordu.
//
// Yeni tablo / sütun YOK: bu tablo zaten her denemeyi niyet başına (işletme + rezervasyon + tür) yazıyor ve kesin reddi `failed` ile
// kapatıyor. Deneme sayısı ve son deneme anı o satırlardan TÜRETİLİR:
//  · aynı içerikle (gövde özeti) n kez reddedildiyse sıradaki deneme en erken son denemeden `lifecycleRetryDelayMs(n)` sonra;
//  · ev sahibi metni düzeltince özet değişir → sayaç kendiliğinden sıfırdan başlar (hemen denenir);
//  · karşılama mesajının reddi giriş / çıkış mesajını geciktirmez (tür anahtarın parçası);
//  · hiçbir zaman "bıraktım" denmez: aralık büyür ve tavanda (günde ~4 deneme) kalır; mesajın zamanı geçince aday olmaktan zaten çıkar.
// Kalıcı kuyruk AÇIKKEN bu defter okunmaz — orada durum kuyruk satırının kendisindedir (`outbox/state.ts`).
// ---------------------------------------------------------------------------

/** İlk yeniden deneme bir sonraki turda (2 dk) yapılabilsin diye 2 dakikanın altında; sonra her seferinde ikiye katlanır. */
export const LIFECYCLE_RETRY_BASE_MS = 90_000;
/** Aralığın tavanı: aynı içerikle reddedilen mesaj günde en çok ~4 kez denenir. */
export const LIFECYCLE_RETRY_CAP_MS = 6 * 3_600_000;

/**
 * `failedAttempts` kez kesin reddedilmiş niyetin bir sonraki denemesine kadar beklenecek süre. Katlanarak büyür (90 sn · 2^(n−1), tavan
 * 6 saat) ve ±%20 sapma taşır — sapma `seed`den türetilir (rastgele sayı yok: aynı girdi aynı sonucu verir, testler saate bağlı kalmaz;
 * rezervasyonlar aynı ana yığılmaz). 0 ya da negatif deneme → bekleme yok.
 */
export function lifecycleRetryDelayMs(failedAttempts: number, seed: string): number {
  if (!(failedAttempts > 0)) return 0;
  const exp = Math.min(LIFECYCLE_RETRY_CAP_MS, LIFECYCLE_RETRY_BASE_MS * 2 ** Math.min(failedAttempts - 1, 30));
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Math.round(exp * (0.8 + (h % 400) / 1000)); // 0,800 … 1,199
}

export interface FailedSendLedger {
  /** Bu rezervasyona bu GÖVDEYLE yapılacak denemenin vadesi henüz gelmedi mi (daha önce kesin reddedildi ve bekleme süresi dolmadı). */
  notDue(externalReservationId: string, body: string, now: Date): boolean;
}

const EMPTY_LEDGER: FailedSendLedger = { notDue: () => false };

/**
 * Verilen rezervasyonların bu türdeki kesin reddedilmiş denemeleri (iz ömrü içinde). Tek sorgu; okunamadıysa BOŞ defter döner (gönderici
 * bugünkü gibi dener — okuma arızası mesajı sessizce bekletmesin).
 */
export async function loadFailedSendLedger(
  db: Db,
  scope: { organizationId: string; kind: AutomatedSendKind },
  externalReservationIds: readonly string[],
  now: Date,
): Promise<FailedSendLedger> {
  const refs = [...new Set(externalReservationIds)];
  if (refs.length === 0) return EMPTY_LEDGER;
  let rows: { externalReservationId: string; bodyHash: string; sentAt: Date }[];
  try {
    rows = await db.automatedMessageSend.findMany({
      where: {
        organizationId: scope.organizationId,
        kind: scope.kind,
        state: "failed",
        externalReservationId: { in: refs },
        sentAt: { gte: new Date(now.getTime() - AUTOMATED_SEND_RETENTION_MS) },
      },
      select: { externalReservationId: true, bodyHash: true, sentAt: true },
    });
  } catch {
    return EMPTY_LEDGER;
  }
  if (rows.length === 0) return EMPTY_LEDGER;
  const byIntent = new Map<string, { count: number; lastAt: number }>();
  const keyOf = (ref: string, hash: string) => `${ref}\n${hash}`;
  for (const row of rows) {
    const key = keyOf(row.externalReservationId, row.bodyHash);
    const entry = byIntent.get(key);
    const at = row.sentAt.getTime();
    if (entry) {
      entry.count++;
      if (at > entry.lastAt) entry.lastAt = at;
    } else byIntent.set(key, { count: 1, lastAt: at });
  }
  return {
    notDue(externalReservationId, body, at) {
      const entry = byIntent.get(keyOf(externalReservationId, automatedBodyHash(body)));
      if (!entry) return false;
      return at.getTime() < entry.lastAt + lifecycleRetryDelayMs(entry.count, `${scope.kind}:${externalReservationId}`);
    },
  };
}

export interface AutomatedMatchCandidate {
  externalId: string;
  body: string;
  createdAt: Date | null;
}

export interface AutomatedMatch {
  recordId: string;
  kind: AutomatedSendKind;
}

/**
 * SALT OKUMA ön eşleşme: thread'in giden, henüz yazılmamış sağlayıcı mesajlarını izlerle BİRE BİR eşler (kronolojik;
 * önce sağlayıcı kimliği, sonra özet + pencere). Sahiplenme `claimAutomatedSend` ile mesaj yazılırken yapılır — içe
 * aktarma thread kilidi altında koştuğu için arada başka bir yazan yoktur.
 */
export async function planAutomatedMatches(
  db: Db,
  scope: { organizationId: string; propertyId: string; externalReservationId: string },
  candidates: readonly AutomatedMatchCandidate[],
): Promise<Map<string, AutomatedMatch>> {
  const plan = new Map<string, AutomatedMatch>();
  if (candidates.length === 0) return plan;
  const rows = await db.automatedMessageSend.findMany({
    where: {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      externalReservationId: scope.externalReservationId,
      state: { in: [...MATCHABLE_STATES] },
    },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, bodyHash: true, providerMessageId: true, sentAt: true, matchedExternalId: true },
  });
  if (rows.length === 0) return plan;
  const used = new Set<string>();
  const usable = (r: (typeof rows)[number], externalId: string) =>
    !used.has(r.id) && isAutomatedSendKind(r.kind) && (r.matchedExternalId === null || r.matchedExternalId === externalId);
  // 1) Sağlayıcı kimliği (POST cevabının kimliği okuma kimliğiyle aynıysa kesin eşleşme).
  for (const c of candidates) {
    const r = rows.find((row) => row.providerMessageId === c.externalId && usable(row, c.externalId));
    if (r) {
      used.add(r.id);
      plan.set(c.externalId, { recordId: r.id, kind: r.kind as AutomatedSendKind });
    }
  }
  // 1b) Daha önce bu sağlayıcı mesajına bağlanmış iz (aynı mesajın yeniden içe aktarımı).
  for (const c of candidates) {
    if (plan.has(c.externalId)) continue;
    const r = rows.find((row) => row.matchedExternalId === c.externalId && usable(row, c.externalId));
    if (r) {
      used.add(r.id);
      plan.set(c.externalId, { recordId: r.id, kind: r.kind as AutomatedSendKind });
    }
  }
  // 2) Aynı gövde özeti + zaman penceresi, en eski iz önce.
  for (const c of candidates) {
    if (plan.has(c.externalId)) continue;
    const hash = automatedBodyHash(c.body);
    const r = rows.find((row) => {
      if (row.bodyHash !== hash || !usable(row, c.externalId)) return false;
      if (!c.createdAt) return true;
      const at = c.createdAt.getTime();
      return at >= row.sentAt.getTime() - AUTOMATED_MATCH_BEFORE_MS && at <= row.sentAt.getTime() + AUTOMATED_MATCH_AFTER_MS;
    });
    if (r) {
      used.add(r.id);
      plan.set(c.externalId, { recordId: r.id, kind: r.kind as AutomatedSendKind });
    }
  }
  return plan;
}

/** İzi sağlayıcı mesajına bağla (bire bir; aynı mesajın yeniden içe aktarımı idempotent). true = bağlandı. */
export async function claimAutomatedSend(db: Db, recordId: string, externalId: string, now: Date): Promise<boolean> {
  const res = await db.automatedMessageSend.updateMany({
    where: { id: recordId, OR: [{ matchedExternalId: null }, { matchedExternalId: externalId }] },
    data: { matchedExternalId: externalId, matchedAt: now },
  });
  return res.count === 1;
}

/** Eski izleri sil (KVKK + tablo boyu). Silinen sayı döner. */
export async function purgeAutomatedSends(db: Db, now: Date = new Date()): Promise<number> {
  const res = await db.automatedMessageSend.deleteMany({
    where: { sentAt: { lt: new Date(now.getTime() - AUTOMATED_SEND_RETENTION_MS) } },
  });
  return res.count;
}
