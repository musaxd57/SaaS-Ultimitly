import "server-only";

import { prisma } from "@/lib/db";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { warmPropertyKbVectorsBestEffort } from "@/lib/ai/embeddings/kb-warm";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { buildLearnPairs } from "./pairs";
import { maskPairs, maskForLearning } from "./mask";
import { DRAFT_FLAGS, extractDraftsFromPairs, gateDraft, historyLearnEffort, historyLearnModel, LEARN_CATEGORIES, type DraftFlag } from "./extract";
import { detectKbInstructionHijack, foldTurkishAscii } from "@/lib/ai/fallback";
import { qrReplyHasDoorCode } from "@/lib/guest-chat";
import { namesPaymentMethod } from "@/lib/payment-method-guard";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — SERVİS (migration 65). Anahtar `HISTORY_LEARN_ENABLED` (varsayılan KAPALI; panel + rotalar 404).
//
// Akış: başlat (kurallar TEK işlemde, İŞLETME satırı kilitli: mülk başına tek etkin çalıştırma · işletme başına aylık tavan) →
// yürüt (sahiplenme CAS queued→running; mesajlar → çiftler → maske → Luna → taslak satırları; aynı mülkün önceki bekleyen taslakları
// `superseded`) → ev sahibi onaylar / reddeder (CAS pending→…; onay = A1 sözleşmesiyle ONAYLI bilgi tabanı kalemi, plan sınırı ile).
// Taslak bilgi tabanına ONAYDAN ÖNCE yazılmaz. Takılı çalıştırma (süreç yeniden başladı) `failed / interrupted` olur (başlatma ve
// zamanlanmış süpürge); kuyrukta kalan çalıştırmayı zamanlanmış iş yürütür (rota `void` ile hemen de başlatır; CAS çift yürütmeyi önler).
// Opus incelemesi 10-15 (iki tur) bulguları işlendi — ayrıntı ilgili satırlarda.
// ---------------------------------------------------------------------------

export function historyLearnEnabled(): boolean {
  return process.env.HISTORY_LEARN_ENABLED === "1";
}

/** Tek çalıştırmada okunacak en çok soru ↔ cevap çifti (kurucu: "ilk deneme 300"). */
export const HISTORY_LEARN_MAX_QUESTIONS = 300;
export const HISTORY_LEARN_MIN_QUESTIONS = 20;
/** İşletme başına takvim ayında en çok MODEL ÇAĞIRAN çalıştırma (maliyet tavanı; Luna'da 300 soru ≈ $0,01 — kötüye kullanım içindir). */
export const HISTORY_LEARN_MONTHLY_RUNS = 10;
/** Bu süreden uzun "queued / running" kalan çalıştırma takılmış sayılır. En kötü durum ~14 çağrı × 120 sn ≈ 28 dk → 60 dk pay. */
export const HISTORY_LEARN_STALE_MS = 60 * 60_000;
/** Geriye bakış (gün) ve okunan mesaj tavanı. */
export const HISTORY_LEARN_WINDOW_DAYS = 540;
export const HISTORY_LEARN_MESSAGE_CAP = 6_000;
/** Onaylanmamış taslak saklama süresi (gün) — maskeye rağmen misafir kırıntısı taşıyabilir (Opus 10-15 KVKK). */
export const HISTORY_LEARN_DRAFT_RETENTION_DAYS = 90;

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "not_found" | "running" | "monthly_cap" };

export function clampQuestions(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return HISTORY_LEARN_MAX_QUESTIONS;
  return Math.min(HISTORY_LEARN_MAX_QUESTIONS, Math.max(HISTORY_LEARN_MIN_QUESTIONS, n));
}

const monthStartUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Takılı çalıştırmaları kapatır (yeniden başlama / ölü süreç). Kapsam verilirse yalnız o işletme. */
async function failStuckRuns(db: Tx | typeof prisma, now: Date, organizationId?: string): Promise<number> {
  const cut = new Date(now.getTime() - HISTORY_LEARN_STALE_MS);
  const r = await db.historyLearnRun.updateMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      // Kuyruk: oluşturulma; yürüyen: BAŞLAMA anı (Opus 10-15 B8 — 59 dk kuyrukta bekleyip yeni başlayan koşu "takılı" sayılmasın).
      OR: [
        { status: "queued", createdAt: { lt: cut } },
        { status: "running", OR: [{ startedAt: { lt: cut } }, { startedAt: null, createdAt: { lt: cut } }] },
      ],
    },
    data: { status: "failed", errorCode: "interrupted", finishedAt: now },
  });
  return r.count;
}

/**
 * Çalıştırma satırı açar. Kurallar TEK işlemde ve İŞLETME satırı kilitliyken (Opus 10-15 B6: mülk kilidi aylık tavanı korumuyordu —
 * iki daire aynı anda başlatınca tavan aşılıyordu). Tavan yalnız MODEL ÇAĞIRAN (ya da sürmekte olan) çalıştırmaları sayar: anahtarsız /
 * takılı çalıştırma ayı yakmaz (B7).
 */
export async function startHistoryLearnRun(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  now?: Date;
}): Promise<StartResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const org = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Organization" WHERE "id" = ${input.organizationId} FOR UPDATE`;
    if (!org.length) return { ok: false, reason: "not_found" } as const;
    const property = await tx.property.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId }, select: { id: true } });
    if (!property) return { ok: false, reason: "not_found" } as const;
    await failStuckRuns(tx, now, input.organizationId);
    const active = await tx.historyLearnRun.count({ where: { propertyId: input.propertyId, status: { in: ["queued", "running"] } } });
    if (active) return { ok: false, reason: "running" } as const;
    const thisMonth = await tx.historyLearnRun.count({
      where: {
        organizationId: input.organizationId,
        createdAt: { gte: monthStartUtc(now) },
        // Yalnız anahtarsız (hiç model çağırmayan) çalıştırma sayılmaz; yarıda kalan / kesilen çalıştırma jeton harcamış olabilir → sayılır.
        OR: [{ errorCode: null }, { errorCode: { not: "no_key" } }],
      },
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

/**
 * Konuşmanın misafir ADLARI — maske için. Rezervasyon adı yoksa (soru aşaması, bağlanmamış rezervasyon) konuşmanın görünen misafir
 * kimliği ve misafir satırlarının gönderen adı da sayılır (Opus 10-15 B2: yalnız rezervasyon adı "Merhaba Ayşe Hanım"ı açıkta bırakıyordu).
 */
function guestNamesOf(rows: readonly { conversationId: string; direction: string; senderName?: string | null; conversation?: { guestIdentifier?: string | null; reservation?: { guestName?: string | null } | null } | null }[]) {
  const byConv = new Map<string, Set<string>>();
  const add = (conv: string, name: string | null | undefined) => {
    const n = name?.trim();
    if (!n || n.length < 2 || n.length > 80 || isPlaceholderName(n)) return;
    const set = byConv.get(conv) ?? new Set<string>();
    set.add(n);
    byConv.set(conv, set);
  };
  for (const m of rows) {
    add(m.conversationId, m.conversation?.reservation?.guestName);
    add(m.conversationId, m.conversation?.guestIdentifier);
    if (m.direction === "inbound") add(m.conversationId, m.senderName);
  }
  return byConv;
}

/**
 * Yer tutucu "ad" (Opus 10-15): adsız konuşmanın görünen kimliği "Misafir" / "Rezervasyon <kod>", silinmiş misafir `ANON`, telefon ya
 * da e-posta biçimli kimlik. Bunlar ad maskesine girerse "Misafir sayısı en çok 4" gibi her cevap `{isim}` olur ve her taslak işaretlenir.
 */
export function isPlaceholderName(n: string): boolean {
  const f = foldTurkishAscii(n);
  if (/[\d@]/u.test(n)) return true;
  if (/^(misafir|guest|gast|gost|rezervasyon|reservation|booking|anonim|anonymous|silindi|erased|kullanici|user)(\s|$)/u.test(f)) return true;
  return false;
}

export type RunErrorCode = "no_key" | "model" | "internal" | "interrupted";

/**
 * Çalıştırmayı yürütür. ASLA fırlatmaz (arka planda çağrılır). Sahiplenme CAS: yalnız `queued` satır `running` olur — aynı çalıştırma
 * iki kez yürütülemez (rota + zamanlanmış iş aynı anda tetiklese de).
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
        // Kiracı kapsamı: konuşma → mülk → işletme (mülk kimliği tekil; işletme koşulu derinlemesine savunma — eşdeğer mutant).
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
        conversation: { select: { status: true, guestIdentifier: true, reservation: { select: { guestName: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LEARN_MESSAGE_CAP,
    });
    const convStatus = new Map<string, string | null>();
    for (const m of rows) convStatus.set(m.conversationId, m.conversation?.status ?? null);
    const names = guestNamesOf(rows);
    const pairs = buildLearnPairs(
      rows.map((m) => ({ ...m, propertyId: run.propertyId })),
      [...convStatus].map(([id, status]) => ({ id, status })),
    ).slice(0, clampQuestions(opts.questions ?? HISTORY_LEARN_MAX_QUESTIONS));
    const masked = maskPairs(pairs, Object.fromEntries([...names].map(([c, s]) => [c, [...s]])));
    const usage = { in: 0, out: 0 };
    const result = await extractDraftsFromPairs(masked, {
      model: run.model,
      reasoningEffort: run.effort ?? undefined,
      apiKey: opts.apiKey,
      fetchImpl: meteredFetch(opts.fetchImpl ?? fetch, usage),
      guestNames: [...new Set([...names.values()].flatMap((s) => [...s]))],
    });
    const noKey = pairs.length > 0 && result.calls === 0;
    const allFailed = result.calls > 0 && result.failedCalls === result.calls;
    const byN = new Map(masked.map((p, i) => [p.n, pairs[i]]));
    const failed = noKey || allFailed;
    // Önceki bekleyen taslaklar YALNIZ temiz ve taslak üreten okumada geri çekilir (Opus 10-15: boş / yarı arızalı okuma eski taslakları
    // yerine bir şey koymadan siliyordu).
    const supersede = !failed && result.failedCalls === 0 && result.drafts.length > 0;
    await prisma.$transaction(async (tx) => {
      // SON YAZMA CAS (Opus 10-15 B8): bu arada "takılı" sayılıp kapatılan çalıştırma sonucunu yazamaz, taslak ekleyemez.
      const still = await tx.historyLearnRun.updateMany({
        where: { id: runId, status: "running" },
        data: {
          status: failed ? "failed" : "done",
          errorCode: noKey ? "no_key" : allFailed ? "model" : null,
          pairCount: pairs.length,
          draftCount: result.drafts.length,
          calls: result.calls,
          failedCalls: result.failedCalls,
          tokensIn: usage.in,
          tokensOut: usage.out,
          finishedAt: new Date(),
        },
      });
      if (still.count !== 1) return;
      if (supersede) {
        await tx.historyLearnDraft.updateMany({ where: { propertyId: run.propertyId, state: "pending", runId: { not: runId } }, data: { state: "superseded" } });
      }
      await tx.historyLearnDraft.createMany({
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
      });
    });
  } catch {
    await prisma.historyLearnRun
      .updateMany({ where: { id: runId, status: "running" }, data: { status: "failed", errorCode: "internal", finishedAt: new Date() } })
      .catch(() => {});
  }
}

/**
 * Zamanlanmış iş (2 dk döngü): takılı çalıştırmaları kapatır, kuyrukta bekleyenleri (rota tetiklemesi süreç ölünce kaybolduysa)
 * sırayla yürütür. Anahtar kapalıyken hiçbir şey yapmaz. Döngü başına en çok `max` çalıştırma (müşteri hesabında patlama yok).
 */
export async function sweepHistoryLearnRuns(now: Date = new Date(), max = 2): Promise<{ failed: number; executed: number }> {
  if (!historyLearnEnabled()) return { failed: 0, executed: 0 };
  const failed = await failStuckRuns(prisma, now);
  const queued = await prisma.historyLearnRun.findMany({
    where: { status: "queued", createdAt: { lt: new Date(now.getTime() - 60_000) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: max,
    select: { id: true },
  });
  // Arka plana atılır: senkron döngüsü (kilit TTL 15 dk) 30 dakikalık okumayı BEKLEMEZ. Yürütücü fırlatmaz; CAS çift yürütmeyi önler.
  for (const q of queued) void executeHistoryLearnRun(q.id);
  return { failed, executed: queued.length };
}

/** Saklama: onaylanmamış taslaklar `HISTORY_LEARN_DRAFT_RETENTION_DAYS` sonra silinir (onaylanan bilgi tabanı kalemi olarak yaşar). */
export async function purgeOldHistoryLearnDrafts(now: Date = new Date()): Promise<{ deleted: number }> {
  const r = await prisma.historyLearnDraft.deleteMany({
    where: { state: { not: "approved" }, createdAt: { lt: new Date(now.getTime() - HISTORY_LEARN_DRAFT_RETENTION_DAYS * 86_400_000) } },
  });
  return { deleted: r.count };
}

export const DRAFT_EDIT_MAX_TITLE = 120;
export const DRAFT_EDIT_MAX_CONTENT = 2_000;

export type ReviewResult =
  | { ok: true; kbItemId: string | null }
  | { ok: false; reason: "not_found" | "already_reviewed" | "invalid" | "door_code" | "hijack" | "plan_items" | "plan_chars" }
  | { ok: false; reason: "needs_confirm"; flags: DraftFlag[]; conflict: boolean };

/**
 * Kanıt bağlamı (onay anında YENİDEN kurulur — Opus 10-15 B3: bağlamsız kapı düzenlenen metindeki misafir adını / dayanaksız değeri
 * görmüyordu): kanıt ev sahibi mesajları (maskeli) + o konuşmaların misafir adları. Mesaj saklama süresiyle silindiyse bağlam boş kalır.
 */
async function evidenceContext(organizationId: string, evidenceJson: string) {
  let ids: string[] = [];
  try {
    const v = JSON.parse(evidenceJson);
    if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === "string").slice(0, 200);
  } catch {
    /* bozuk iz → bağlamsız */
  }
  if (!ids.length) return { hostAnswers: undefined, guestNames: [] as string[] };
  const msgs = await prisma.message.findMany({
    where: { id: { in: ids }, conversation: { property: { organizationId } } },
    select: { conversationId: true, body: true },
  });
  const convIds = [...new Set(msgs.map((m) => m.conversationId))];
  const nameRows = await prisma.message.findMany({
    where: { conversationId: { in: convIds } },
    select: { conversationId: true, direction: true, senderName: true, conversation: { select: { guestIdentifier: true, reservation: { select: { guestName: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2_000,
  });
  const names = [...new Set([...guestNamesOf(nameRows).values()].flatMap((s) => [...s]))];
  const hostAnswers = msgs.length ? msgs.map((m) => maskForLearning(m.body ?? "", names)) : undefined;
  return { hostAnswers, guestNames: names };
}

/**
 * Taslak onayı / reddi. Onayda metin (düzenlenmiş ya da değil) KOD KAPILARINDAN kanıt bağlamıyla yeniden geçer (kapı kodu / ele geçirme
 * → ret); işaretli ya da çelişkili taslak `confirmFlags` olmadan onaylanmaz; plan sınırı (kalem sayısı + karakter) bilgi tabanı rotasıyla
 * AYNI (B4). Yazma CAS: `pending` olmayan taslak ikinci kez işlenmez (çift tıklama iki kalem açamaz).
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
    select: { id: true, propertyId: true, category: true, title: true, content: true, flagsJson: true, conflict: true, state: true, evidenceMessageIdsJson: true },
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
  const ctx = await evidenceContext(input.organizationId, draft.evidenceMessageIdsJson);
  const gate = gateDraft(title, content, ctx);
  if (!gate.ok) return { ok: false, reason: gate.reason === "empty" ? "invalid" : gate.reason };
  // Düzenlenmemiş metin: saklı işaretler (çıkarım anındaki bağlamla) + bugünkü kapı. Düzenlenmiş metin: bugünkü kapı (kanıt bağlamıyla)
  // + metinden yeniden hesaplanamayan `outdated` (taslaklar arası karşılaştırma).
  const stored = parseFlags(draft.flagsJson);
  const edited = title !== draft.title || content !== draft.content;
  const flags = [...new Set([...gate.flags, ...(edited ? stored.filter((f) => f === "outdated") : stored)])];
  if ((flags.length > 0 || draft.conflict) && !input.confirmFlags) return { ok: false, reason: "needs_confirm", flags, conflict: draft.conflict };
  const limits = await limitsForOrg(input.organizationId);
  if (content.length > limits.kbCharsPerItem) return { ok: false, reason: "plan_chars" };
  const kbItemId = await prisma.$transaction(async (tx) => {
    const active = await tx.knowledgeBaseItem.count({ where: { propertyId: draft.propertyId, isActive: true } });
    if (active >= limits.kbItemsPerProperty) return "plan_items" as const;
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
  if (kbItemId === "plan_items") return { ok: false, reason: "plan_items" };
  if (!kbItemId) return { ok: false, reason: "already_reviewed" };
  await refreshPropertyMemoryBestEffort(input.organizationId, draft.propertyId);
  warmPropertyKbVectorsBestEffort(draft.propertyId);
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
/** Etkin talimat tavanı. İsteme giren TOPLAM ayrıca sınırlı (istem bağlama dilimi). */
export const INSTRUCTIONS_MAX_ACTIVE = 10;

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
