import "server-only";

import { prisma } from "@/lib/db";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { buildLearnPairs } from "./pairs";
import { maskPairs } from "./mask";
import { DRAFT_FLAGS, extractDraftsFromPairs, gateDraft, historyLearnEffort, historyLearnModel, LEARN_CATEGORIES, type DraftFlag } from "./extract";
import { detectKbInstructionHijack } from "@/lib/ai/fallback";
import { qrReplyHasDoorCode } from "@/lib/guest-chat";
import { namesPaymentMethod } from "@/lib/payment-method-guard";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — SERVİS (migration 65). Anahtar `HISTORY_LEARN_ENABLED` (varsayılan KAPALI; panel + rotalar 404).
//
// Akış: başlat (kurallar TEK işlemde: mülk başına tek çalıştırma · işletme başına aylık tavan) → arka planda yürüt (sahiplenme CAS
// queued→running; mesajlar → çiftler → maske → Luna → taslak satırları) → ev sahibi onaylar / reddeder (CAS pending→…; onay = A1
// sözleşmesiyle ONAYLI bilgi tabanı kalemi, kaynak `suggestion_accepted`, iz `hl:<taslak>`).
// Taslak bilgi tabanına ONAYDAN ÖNCE yazılmaz (modele giden kalem yalnız onaylı; taslak kendi tablosunda).
// ---------------------------------------------------------------------------

export function historyLearnEnabled(): boolean {
  return process.env.HISTORY_LEARN_ENABLED === "1";
}

/** Tek çalıştırmada okunacak en çok misafir sorusu (kurucu: "ilk deneme 300"). */
export const HISTORY_LEARN_MAX_QUESTIONS = 300;
export const HISTORY_LEARN_MIN_QUESTIONS = 20;
/** İşletme başına takvim ayında en çok çalıştırma (maliyet tavanı; Luna'da 300 soru ≈ $0,01 — tavan kötüye kullanım içindir). */
export const HISTORY_LEARN_MONTHLY_RUNS = 10;
/** Bu süreden uzun "running/queued" kalan çalıştırma takılmış sayılır (süreç yeniden başladı vb.) → yeni çalıştırmayı engellemez. */
export const HISTORY_LEARN_STALE_MS = 30 * 60_000;
/** Geriye bakış (gün) ve okunan mesaj tavanı. */
export const HISTORY_LEARN_WINDOW_DAYS = 540;
export const HISTORY_LEARN_MESSAGE_CAP = 6_000;

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "not_found" | "running" | "monthly_cap" };

export function clampQuestions(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return HISTORY_LEARN_MAX_QUESTIONS;
  return Math.min(HISTORY_LEARN_MAX_QUESTIONS, Math.max(HISTORY_LEARN_MIN_QUESTIONS, n));
}

const monthStartUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Çalıştırma satırı açar. Kurallar TEK işlemde ve mülk satırı kilitliyken (eşzamanlı iki "Başlat" tıklaması iki çalıştırma
 * açamasın — kilit `SELECT … FOR UPDATE`).
 */
export async function startHistoryLearnRun(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  now?: Date;
}): Promise<StartResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Property" WHERE "id" = ${input.propertyId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    if (!locked.length) return { ok: false, reason: "not_found" } as const;
    const active = await tx.historyLearnRun.count({
      where: {
        propertyId: input.propertyId,
        status: { in: ["queued", "running"] },
        createdAt: { gt: new Date(now.getTime() - HISTORY_LEARN_STALE_MS) },
      },
    });
    if (active) return { ok: false, reason: "running" } as const;
    const thisMonth = await tx.historyLearnRun.count({
      where: { organizationId: input.organizationId, createdAt: { gte: monthStartUtc(now) } },
    });
    if (thisMonth >= HISTORY_LEARN_MONTHLY_RUNS) return { ok: false, reason: "monthly_cap" } as const;
    const run = await tx.historyLearnRun.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        requestedById: input.userId,
        model: historyLearnModel(),
        effort: historyLearnEffort(),
      },
      select: { id: true },
    });
    return { ok: true, runId: run.id } as const;
  });
}

/** Jeton sayacı: sağlayıcı cevabındaki `usage` okunur (gövde klonlanır; cevap değişmez). */
function meteredFetch(base: typeof fetch, acc: { in: number; out: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await base(input, init);
    try {
      const j = (await res.clone().json()) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      acc.in += n(j.usage?.prompt_tokens);
      acc.out += n(j.usage?.completion_tokens);
    } catch {
      /* JSON olmayan yanıt */
    }
    return res;
  }) as typeof fetch;
}

export type RunErrorCode = "no_key" | "model" | "internal";

/**
 * Çalıştırmayı yürütür. ASLA fırlatmaz (arka planda `void` ile çağrılır). Sahiplenme CAS: yalnız `queued` satır `running` olur —
 * aynı çalıştırma iki kez yürütülemez.
 */
export async function executeHistoryLearnRun(
  runId: string,
  opts: { questions?: number; fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<void> {
  const claimed = await prisma.historyLearnRun.updateMany({
    where: { id: runId, status: "queued" },
    data: { status: "running", startedAt: new Date() },
  });
  if (claimed.count !== 1) return;
  try {
    const run = await prisma.historyLearnRun.findUniqueOrThrow({ where: { id: runId }, select: { propertyId: true, organizationId: true, model: true, effort: true } });
    const since = new Date(Date.now() - HISTORY_LEARN_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.message.findMany({
      where: {
        createdAt: { gte: since },
        // Kiracı kapsamı: konuşma → mülk → işletme (mülk kimliği tek başına yetmez).
        conversation: { property: { id: run.propertyId, organizationId: run.organizationId } },
      },
      select: {
        id: true,
        conversationId: true,
        direction: true,
        authorType: true,
        senderName: true,
        body: true,
        createdAt: true,
        aiAssisted: true,
        systemEventType: true,
        conversation: { select: { status: true, reservation: { select: { guestName: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LEARN_MESSAGE_CAP,
    });
    const convStatus = new Map<string, string | null>();
    const guestNames: Record<string, string | null> = {};
    for (const m of rows) {
      convStatus.set(m.conversationId, m.conversation?.status ?? null);
      guestNames[m.conversationId] = m.conversation?.reservation?.guestName ?? null;
    }
    const pairs = buildLearnPairs(
      rows.map((m) => ({ ...m, propertyId: run.propertyId })),
      [...convStatus].map(([id, status]) => ({ id, status })),
    ).slice(0, clampQuestions(opts.questions ?? HISTORY_LEARN_MAX_QUESTIONS));
    const masked = maskPairs(pairs, guestNames);
    const usage = { in: 0, out: 0 };
    const result = await extractDraftsFromPairs(masked, {
      model: run.model,
      reasoningEffort: run.effort ?? undefined,
      apiKey: opts.apiKey,
      fetchImpl: meteredFetch(opts.fetchImpl ?? fetch, usage),
      guestNames: Object.values(guestNames).filter((n): n is string => Boolean(n)),
    });
    const noKey = pairs.length > 0 && result.calls === 0;
    const allFailed = result.calls > 0 && result.failedCalls === result.calls;
    const byN = new Map(masked.map((p, i) => [p.n, pairs[i]]));
    await prisma.$transaction([
      prisma.historyLearnDraft.createMany({
        data: result.drafts.map((d) => ({
          runId,
          propertyId: run.propertyId,
          category: d.category,
          title: d.title,
          content: d.content,
          supportConversations: d.conversationIds.length,
          newestMonth: d.newestMonth,
          oldestMonth: d.oldestMonth,
          conflict: d.conflict,
          conflictNote: d.conflictNote || null,
          flagsJson: JSON.stringify(d.flags),
          evidenceMessageIdsJson: JSON.stringify(d.evidence.flatMap((n) => byN.get(n)?.answerIds ?? [])),
        })),
      }),
      prisma.historyLearnRun.update({
        where: { id: runId },
        data: {
          status: noKey || allFailed ? "failed" : "done",
          errorCode: noKey ? "no_key" : allFailed ? "model" : null,
          pairCount: pairs.length,
          draftCount: result.drafts.length,
          calls: result.calls,
          failedCalls: result.failedCalls,
          tokensIn: usage.in,
          tokensOut: usage.out,
          finishedAt: new Date(),
        },
      }),
    ]);
  } catch {
    await prisma.historyLearnRun
      .updateMany({ where: { id: runId, status: "running" }, data: { status: "failed", errorCode: "internal", finishedAt: new Date() } })
      .catch(() => {});
  }
}

export const DRAFT_EDIT_MAX_TITLE = 120;
export const DRAFT_EDIT_MAX_CONTENT = 2_000;
/** Ev sahibinin bakmadan onaylayamayacağı işaretler (açık `confirmFlags` ister). */
export const CONFIRM_REQUIRED_FLAGS: readonly DraftFlag[] = DRAFT_FLAGS;

export type ReviewResult =
  | { ok: true; kbItemId: string | null }
  | { ok: false; reason: "not_found" | "already_reviewed" | "invalid" | "door_code" | "hijack" | "needs_confirm" };

/**
 * Taslak onayı / reddi. Onayda düzenlenmiş metin KOD KAPILARINDAN yeniden geçer (kapı kodu / ele geçirme → ret); işaretli ya da
 * çelişkili taslak `confirmFlags` olmadan onaylanmaz. Yazma CAS: `pending` olmayan taslak ikinci kez işlenmez (çift tıklama iki
 * bilgi tabanı kalemi açamaz).
 */
export async function reviewHistoryLearnDraft(input: {
  organizationId: string;
  draftId: string;
  userId: string | null;
  action: "approve" | "reject";
  title?: string;
  content?: string;
  category?: string;
  confirmFlags?: boolean;
}): Promise<ReviewResult> {
  const draft = await prisma.historyLearnDraft.findFirst({
    where: { id: input.draftId, property: { organizationId: input.organizationId } },
    select: { id: true, propertyId: true, category: true, title: true, content: true, flagsJson: true, conflict: true, state: true },
  });
  if (!draft) return { ok: false, reason: "not_found" };
  if (draft.state !== "pending") return { ok: false, reason: "already_reviewed" };
  const now = new Date();
  if (input.action === "reject") {
    const r = await prisma.historyLearnDraft.updateMany({
      where: { id: draft.id, state: "pending" },
      data: { state: "rejected", reviewedById: input.userId, reviewedAt: now },
    });
    return r.count === 1 ? { ok: true, kbItemId: null } : { ok: false, reason: "already_reviewed" };
  }
  const title = (input.title ?? draft.title).trim();
  const content = (input.content ?? draft.content).trim();
  const category = input.category ?? draft.category;
  if (!title || !content || title.length > DRAFT_EDIT_MAX_TITLE || content.length > DRAFT_EDIT_MAX_CONTENT) return { ok: false, reason: "invalid" };
  if (!(LEARN_CATEGORIES as readonly string[]).includes(category)) return { ok: false, reason: "invalid" };
  const gate = gateDraft(title, content);
  if (!gate.ok) return { ok: false, reason: gate.reason === "empty" ? "invalid" : gate.reason };
  const edited = title !== draft.title || content !== draft.content;
  const storedFlags = parseFlags(draft.flagsJson);
  // Düzenlenmiş metinde saklı işaretler (ör. dayanaksız değer) artık geçerli değil; YENİ metnin işaretleri sayılır.
  const flags = edited ? gate.flags : [...new Set([...storedFlags, ...gate.flags])];
  if ((flags.some((f) => CONFIRM_REQUIRED_FLAGS.includes(f)) || draft.conflict) && !input.confirmFlags) return { ok: false, reason: "needs_confirm" };
  const kbItemId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.historyLearnDraft.updateMany({
      where: { id: draft.id, state: "pending" },
      data: { state: "approved", reviewedById: input.userId, reviewedAt: now },
    });
    if (claimed.count !== 1) return null;
    const kb = await tx.knowledgeBaseItem.create({
      data: {
        propertyId: draft.propertyId,
        category,
        title,
        content,
        isActive: true,
        source: "suggestion_accepted",
        reviewState: "approved",
        approvedAt: now,
        sourceRef: `hl:${draft.id}`,
      },
      select: { id: true },
    });
    await tx.historyLearnDraft.update({ where: { id: draft.id }, data: { kbItemId: kb.id } });
    return kb.id;
  });
  if (!kbItemId) return { ok: false, reason: "already_reviewed" };
  await refreshPropertyMemoryBestEffort(input.organizationId, draft.propertyId);
  return { ok: true, kbItemId };
}

export function parseFlags(json: string | null | undefined): DraftFlag[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? DRAFT_FLAGS.filter((f) => v.includes(f)) : [];
  } catch {
    return [];
  }
}

// ── Mülke özgü talimat ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const INSTRUCTION_MAX_CHARS = 500;
export const INSTRUCTIONS_MAX_ACTIVE = 20;

export type InstructionRejectReason = "empty" | "too_long" | "door_code" | "hijack" | "payment";
export type InstructionCheck = { ok: true; content: string } | { ok: false; reason: InstructionRejectReason };

/**
 * Talimat metni kapısı (talimat cevap istemine girer → ev sahibi metni İSTEMDİR): kapı kodu değeri · bilgi tabanı ele geçirme kalıbı
 * · ödeme yöntemi / yeri (TEK KAYNAK `payment-method-guard`, ŞÜPHEDE REDDET) · uzunluk tavanı. Kaydederken VE isteme girerken koşar.
 */
export function checkInstruction(raw: string): InstructionCheck {
  const content = raw.replace(/\s+/gu, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > INSTRUCTION_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (qrReplyHasDoorCode(content, [])) return { ok: false, reason: "door_code" };
  if (detectKbInstructionHijack(content)) return { ok: false, reason: "hijack" };
  if (namesPaymentMethod(content)) return { ok: false, reason: "payment" };
  return { ok: true, content };
}

export async function addPropertyInstruction(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  content: string;
  source?: "host_note" | "history_learn";
}): Promise<{ ok: true; id: string } | { ok: false; reason: InstructionRejectReason | "not_found" | "limit" }> {
  const check = checkInstruction(input.content);
  if (!check.ok) return check;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Property" WHERE "id" = ${input.propertyId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    if (!locked.length) return { ok: false, reason: "not_found" } as const;
    const active = await tx.propertyInstruction.count({ where: { propertyId: input.propertyId, status: "active" } });
    if (active >= INSTRUCTIONS_MAX_ACTIVE) return { ok: false, reason: "limit" } as const;
    const row = await tx.propertyInstruction.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        content: check.content,
        source: input.source ?? "host_note",
        createdById: input.userId,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id } as const;
  });
}

export async function retirePropertyInstruction(organizationId: string, id: string): Promise<boolean> {
  const r = await prisma.propertyInstruction.updateMany({
    where: { id, organizationId, status: "active" },
    data: { status: "retired", retiredAt: new Date() },
  });
  return r.count === 1;
}
