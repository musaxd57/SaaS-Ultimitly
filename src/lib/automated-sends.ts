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
