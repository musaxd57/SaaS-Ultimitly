import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// KURUCU YAPAY ZEKÂ KALİTE KONSOLU (kurucu talimatı 09-07 "Founder AI Quality Console"; migration 60 tasarımı §E).
//
// Sözleşme:
//   · Yalnız izin listesindeki + bu oturumda 2FA'dan geçmiş operatör (`isSuperAdmin`), KENDİ hesabından (bürünme değil).
//   · SALT-OKUMA: üretim izini okur; müşteri verisini, mesajları, konuşma durumunu, gönderimi DEĞİŞTİREN hiçbir yol yok.
//     Tek yazma: kurucu etiketi (`AiReviewLabel`) — operasyon verisinden ayrı tablo.
//   · Her görüntüleme ve her reddedilen deneme `AuditLog`a. Amaç KAPALI KÜME (kurucu kararı 09-30, operatör dışa aktarımı emsali:
//     serbest metin kişisel veri taşıyabilir ve kayıt müşterinin KVKK ihracına girer). Operatörün IP'si / e-postası kayda YAZILMAZ
//     (denetim 08-01: kayıt müşteriye aktarılır, operatörün kişisel verisi üçüncü kişi verisidir) — kimlik opak `actorUserId`.
//   · Kiracı süzgeci HER sorguda `organizationId` (istekten gelen id ile iz satırının org'u birlikte eşleşmeli).
// ---------------------------------------------------------------------------

export const AI_QUALITY_PURPOSES = {
  quality_review: "Kalite incelemesi",
  incident_review: "Olay incelemesi",
  complaint_review: "Şikâyet incelemesi",
} as const;
export type AiQualityPurpose = keyof typeof AI_QUALITY_PURPOSES;

export const AI_REVIEW_LABELS = [
  "correct",
  "hallucinated_fact",
  "missed_context",
  "repeated_greeting",
  "wrong_tone",
  "temporal_error",
  "stale_knowledge",
  "retrieval_failure",
  "tool_should_have_been_used",
  "unsafe_auto_send",
  "escalation_failure",
] as const;
export type AiReviewLabelCode = (typeof AI_REVIEW_LABELS)[number];

const DECISIONS = new Set(["auto_sent", "human_review", "no_reply"]);
const TICKET_RE = /^[A-Za-z0-9#_-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const AI_QUALITY_PAGE_SIZE = 50;
export const AI_REVIEW_NOTE_MAX = 1_000;

type Errors = Record<string, string>;

function purposeTicket(purposeRaw: unknown, ticketRaw: unknown, errors: Errors) {
  const purpose = typeof purposeRaw === "string" ? purposeRaw.trim() : "";
  const ticket = typeof ticketRaw === "string" ? ticketRaw.trim() : "";
  if (!Object.hasOwn(AI_QUALITY_PURPOSES, purpose)) errors.purpose = "İnceleme amacını seçin.";
  if (ticket && !TICKET_RE.test(ticket)) errors.ticket = "Talep numarası yalnız harf, rakam ve tire içerebilir.";
  return { purpose: purpose as AiQualityPurpose, ticket: ticket || null };
}

export function parseAiQualityQuery(
  params: URLSearchParams,
):
  | { ok: true; orgId: string; purpose: AiQualityPurpose; ticket: string | null; decision: string | null; before: string | null }
  | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const orgId = params.get("orgId")?.trim() ?? "";
  if (!ID_RE.test(orgId)) errors.orgId = "orgId gerekli";
  const { purpose, ticket } = purposeTicket(params.get("purpose"), params.get("ticket"), errors);
  const decision = params.get("decision")?.trim() || null;
  if (decision && !DECISIONS.has(decision)) errors.decision = "Bilinmeyen karar süzgeci.";
  const before = params.get("before")?.trim() || null;
  if (before && !ID_RE.test(before)) errors.before = "Geçersiz sayfa imleci.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, orgId, purpose, ticket, decision, before };
}

export function parseAiReviewLabelBody(
  body: unknown,
):
  | { ok: true; orgId: string; generationId: string; label: AiReviewLabelCode; note: string | null; purpose: AiQualityPurpose; ticket: string | null }
  | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const orgId = typeof b.orgId === "string" ? b.orgId.trim() : "";
  const generationId = typeof b.generationId === "string" ? b.generationId.trim() : "";
  if (!ID_RE.test(orgId)) errors.orgId = "orgId gerekli";
  if (!ID_RE.test(generationId)) errors.generationId = "generationId gerekli";
  const label = typeof b.label === "string" ? b.label : "";
  if (!(AI_REVIEW_LABELS as readonly string[]).includes(label)) errors.label = "Bilinmeyen etiket.";
  let note: string | null = null;
  if (b.note != null) {
    if (typeof b.note !== "string") errors.note = "Not metin olmalı.";
    else if (b.note.length > AI_REVIEW_NOTE_MAX) errors.note = `Not en çok ${AI_REVIEW_NOTE_MAX} karakter olabilir.`;
    else note = b.note.replace(/\u0000/g, "").trim() || null;
  }
  const { purpose, ticket } = purposeTicket(b.purpose, b.ticket, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, orgId, generationId, label: label as AiReviewLabelCode, note, purpose, ticket };
}

/** Bir org'un üretim izleri — yeniden eskiye, imleçli. Kiracı süzgeci `organizationId`. */
export async function listAiGenerations(orgId: string, opts: { decision: string | null; before: string | null }) {
  const cursorRow = opts.before
    ? await prisma.aiGeneration.findFirst({ where: { id: opts.before, organizationId: orgId }, select: { createdAt: true, id: true } })
    : null;
  const rows = await prisma.aiGeneration.findMany({
    where: {
      organizationId: orgId,
      ...(opts.decision ? { decision: opts.decision } : {}),
      ...(cursorRow
        ? { OR: [{ createdAt: { lt: cursorRow.createdAt } }, { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AI_QUALITY_PAGE_SIZE,
    select: {
      id: true,
      conversationId: true,
      propertyId: true,
      surface: true,
      model: true,
      promptVersion: true,
      decision: true,
      gateReason: true,
      kbEvidenceJson: true,
      latencyMs: true,
      promptTokens: true,
      completionTokens: true,
      reasoningTokens: true,
      draftText: true,
      sentText: true,
      createdAt: true,
      labels: { select: { id: true, label: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return { rows, nextBefore: rows.length === AI_QUALITY_PAGE_SIZE ? rows[rows.length - 1].id : null };
}

/**
 * Kurucu etiketi yazar. İz satırı BU org'a ait değilse `null` (istekteki org id ile iz kimliği birlikte eşleşmeli — gövdeye başka
 * kiracının iz kimliğini yazmak işe yaramaz). Yalnız `AiReviewLabel` satırı oluşturur; başka hiçbir tabloya dokunmaz.
 */
export async function createAiReviewLabel(
  input: {
    orgId: string;
    generationId: string;
    label: AiReviewLabelCode;
    note: string | null;
    reviewerUserId: string;
  },
  db: Prisma.TransactionClient = prisma,
) {
  const gen = await db.aiGeneration.findFirst({
    where: { id: input.generationId, organizationId: input.orgId },
    select: { id: true },
  });
  if (!gen) return null;
  return db.aiReviewLabel.create({
    data: { generationId: gen.id, label: input.label, note: input.note, reviewerUserId: input.reviewerUserId },
    select: { id: true, label: true, note: true, createdAt: true },
  });
}
