import "server-only";

import { prisma } from "@/lib/db";
import { isSuperAdmin } from "@/lib/admin-core";
import type { SessionPayload } from "@/lib/auth";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { warmPropertyKbVectorsBestEffort } from "@/lib/ai/embeddings/kb-warm";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { reportError } from "@/lib/report-error";
import { ANON_BODY } from "@/lib/data-retention";
import { buildLearnPairs } from "./pairs";
import { maskPairs, maskForLearning } from "./mask";
import { DRAFT_FLAGS, extractDraftsFromPairs, gateDraft, historyLearnEffort, historyLearnModel, LEARN_CATEGORIES, type DraftFlag } from "./extract";
import { foldTurkishAscii } from "@/lib/ai/fallback";
import { INSTRUCTIONS_MAX_ACTIVE, checkInstruction, type InstructionRejectReason } from "./instruction-gate";
import { INSTRUCTION_PRESETS, presetByKey } from "./instruction-presets";
import { propertyInstructionsPromptEnabled } from "./prompt-instructions";
// Karşılaştırma yolu (`compare.ts` → otomasyon kapısı) DİNAMİK yüklenir: otomasyon talimat yükleyicisini içe aktarıyor; statik içe
// aktarma döngü kurardı (otomasyon → talimat → servis → karşılaştırma → otomasyon).
import type { DryRunProperty, DryRunResult } from "./compare";

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

/**
 * KİM KULLANIR (kurucu 10-15): bilgi tabanı taslağı ("Geçmişi oku") müşteri (host) özelliğidir. Cevap karşılaştırma + "Böyle yapsın" ve
 * daire talimatları ŞİMDİLİK YALNIZ OPERATÖR (süper yönetici + bu oturumda 2FA) — kurucu: "müşterinin uğraşması gerekmesin; önce ben test
 * ederim, sorun yoksa tüm müşterilere". Kod müşteriler için hazır kalır; açmak = aşağıdaki anahtar "1" (yeniden yazım yok).
 */
export function historyCompareAllowed(session: SessionPayload | null): boolean {
  return isSuperAdmin(session) || process.env.HISTORY_LEARN_CUSTOMER_COMPARE_ENABLED === "1";
}
export function propertyInstructionsAllowed(session: SessionPayload | null): boolean {
  return isSuperAdmin(session) || process.env.HISTORY_LEARN_CUSTOMER_INSTRUCTIONS_ENABLED === "1";
}

/**
 * Hazır seçenekler müşteriye YALNIZ cevaba gerçekten uygulanırken görünür ve yazılabilir (Haiku 10-15: etkisiz kutucuk ve "açıldığında
 * devreye girer" sözü müşteriye gösterilmez — yüzey değil veri kapatılır). Operatör anahtar kapalıyken de görür (önce kendisi dener).
 */
export function presetsAvailable(session: SessionPayload | null): boolean {
  return propertyInstructionsAllowed(session) || propertyInstructionsPromptEnabled();
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
  // Verilmeyen / boş değer → tavan (Number(null) = 0 idi → 20'ye kırpılıyordu).
  if (raw === null || raw === undefined || raw === "") return HISTORY_LEARN_MAX_QUESTIONS;
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
export type RunKind = "learn" | "compare";
/** Karşılaştırmada tek çalıştırmada en çok soru (canlı cevap modeli — maliyet tavanı). */
export const COMPARE_MAX_QUESTIONS = 50;

export async function startHistoryLearnRun(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  kind?: RunKind;
  now?: Date;
}): Promise<StartResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    // FOR NO KEY UPDATE: aynı sıralamayı verir ama işletmeye bağlı satır eklemelerini (denetim kaydı, risk olayı…) bekletmez (Opus 10-15 HL4 F12).
    const org = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Organization" WHERE "id" = ${input.organizationId} FOR NO KEY UPDATE`;
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
        kind: input.kind ?? "learn",
        // Karşılaştırma CANLI cevap modeliyle (kurucu 10-15) — kayıt yalnız iz; asıl model `suggestReply`ın ayarı.
        model: input.kind === "compare" ? process.env.OPENAI_MODEL?.trim() || "default" : historyLearnModel(),
        effort: input.kind === "compare" ? null : historyLearnEffort(),
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
  opts: {
    questions?: number;
    fetchImpl?: typeof fetch;
    apiKey?: string;
    /** Test enjeksiyonu (karşılaştırma); üretimde `compare.ts` `dryRunReply`. */
    dryRun?: (input: { organizationId: string; property: DryRunProperty; message: string; now: Date }) => Promise<DryRunResult>;
  } = {},
): Promise<void> {
  const claimed = await prisma.historyLearnRun.updateMany({
    where: { id: runId, status: "queued" },
    data: { status: "running", startedAt: new Date() },
  });
  if (claimed.count !== 1) return;
  try {
    const run = await prisma.historyLearnRun.findUniqueOrThrow({
      where: { id: runId },
      select: { propertyId: true, organizationId: true, model: true, effort: true, kind: true },
    });
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
        aiSuggestedReply: true,
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
    if (run.kind === "compare") {
      await executeCompare(runId, run, pairs.slice(0, COMPARE_MAX_QUESTIONS), masked, opts.dryRun ?? (await import("./compare")).dryRunReply);
      return;
    }
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
        // Yalnız ÖĞRENME çalıştırmalarının taslakları geri çekilir; "Böyle yapsın" notundan doğan taslak (karşılaştırma) kalır (F13).
        await tx.historyLearnDraft.updateMany({
          where: { propertyId: run.propertyId, state: "pending", runId: { not: runId }, run: { kind: "learn" } },
          data: { state: "superseded" },
        });
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
  } catch (err) {
    // Sessiz kalmaz (Opus 10-15 HL4): beklenmeyen arıza hata kaydına düşer; çalıştırma "failed" olur.
    void reportError("history-learn execute", err).catch(() => {});
    await prisma.historyLearnRun
      .updateMany({ where: { id: runId, status: "running" }, data: { status: "failed", errorCode: "internal", finishedAt: new Date() } })
      .catch(() => {});
  }
}

/**
 * Karşılaştırma yürütücüsü: her geçmiş soru (MASKELİ) için bugünkü ürünün kuru koşu cevabı + kapı sonucu; satır başına UPSERT (aynı soru
 * yeniden karşılaştırılınca ev sahibinin kararı / notu KORUNUR, yalnız yapay zekâ alanları yenilenir). Hiçbir şey gönderilmez.
 */
async function executeCompare(
  runId: string,
  run: { propertyId: string; organizationId: string },
  pairs: readonly import("./pairs").LearnPair[],
  masked: readonly import("./mask").MaskedPair[],
  dryRun: (input: { organizationId: string; property: DryRunProperty; message: string; now: Date }) => Promise<DryRunResult>,
): Promise<void> {
  const property = await prisma.property.findFirstOrThrow({
    where: { id: run.propertyId, organizationId: run.organizationId },
    select: { id: true, name: true, checkInTime: true, checkOutTime: true, address: true, city: true },
  });
  const model = process.env.OPENAI_MODEL?.trim() || null;
  let calls = 0;
  let failed = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    // Kesilen çalıştırma (takılı sayıldı) sonraki soruları çağırmaz.
    const live = await prisma.historyLearnRun.count({ where: { id: runId, status: "running" } });
    if (!live) return;
    const pair = pairs[i];
    const questionMessageId = pair.questionIds[pair.questionIds.length - 1];
    calls += 1;
    let out: DryRunResult;
    try {
      out = await dryRun({ organizationId: run.organizationId, property, message: masked[i].question, now: pair.askedAt });
    } catch (err) {
      // Çalıştırma başına İLK arıza hata kaydına (50 soruda 50 kayıt olmasın).
      if (failed === 0) void reportError("history-learn compare dryRun", err).catch(() => {});
      failed += 1;
      continue;
    }
    // Model arızasının yedek metni "yapay zekâ böyle cevaplardı" diye kaydedilmez; önceki gerçek cevap EZİLMEZ (Opus 10-15 F14).
    if (out.modelFailed) {
      failed += 1;
      continue;
    }
    const ai = { aiAnswer: out.reply, wouldAutoSend: out.wouldAutoSend, gateDetail: out.closing ? "closing" : null, model, runId };
    // Model cevabı beklenirken çalıştırma "takılı" sayılıp kapatıldıysa satır YAZILMAZ (Haiku 10-15) — kontrol yazmayla aynı işlemde.
    const wrote = await prisma.$transaction(async (tx) => {
      // Çalıştırma satırı KİLİTLİ okunur: takılı-kapatma (updateMany) bu yazma bitene kadar bekler (Haiku 10-15).
      const live = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "HistoryLearnRun" WHERE "id" = ${runId} FOR NO KEY UPDATE`;
      if (live[0]?.status !== "running") return false;
      // Karar bir CEVABA verilir: yapay zekâ cevabı değiştiyse eski karar sıfırlanır (not kalır — operatörün yönergesi).
      const prev = await tx.historyLearnComparison.findUnique({
        where: { propertyId_questionMessageId: { propertyId: run.propertyId, questionMessageId } },
        select: { aiAnswer: true },
      });
      const resetVerdict = prev && prev.aiAnswer !== ai.aiAnswer ? { verdict: null } : {};
      await tx.historyLearnComparison.upsert({
        where: { propertyId_questionMessageId: { propertyId: run.propertyId, questionMessageId } },
        create: { propertyId: run.propertyId, questionMessageId, hostAnswerMessageIdsJson: JSON.stringify(pair.answerIds), ...ai },
        update: { hostAnswerMessageIdsJson: JSON.stringify(pair.answerIds), ...ai, ...resetVerdict },
      });
      return true;
    });
    if (!wrote) return;
  }
  await prisma.historyLearnRun.updateMany({
    where: { id: runId, status: "running" },
    data: {
      status: calls > 0 && failed === calls ? "failed" : "done",
      errorCode: calls > 0 && failed === calls ? "model" : null,
      pairCount: pairs.length,
      draftCount: calls - failed,
      calls,
      failedCalls: failed,
      finishedAt: new Date(),
    },
  });
}

/**
 * Zamanlanmış iş (senkron döngüsünün SAATLİK bölümü): takılı çalıştırmaları kapatır, kuyrukta bekleyenleri (rota tetiklemesi süreç ölünce kaybolduysa)
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

/**
 * Saklama: onaylanmamış taslaklar ve cevap karşılaştırmaları `HISTORY_LEARN_DRAFT_RETENTION_DAYS` sonra silinir (Opus 10-15 F2:
 * karşılaştırmanın yapay zekâ cevabı maskeli misafir sorusundan türer ve hiçbir süpürgeye bağlı değildi). Onaylanan taslak bilgi
 * tabanı kalemi olarak yaşar.
 */
export async function purgeOldHistoryLearnDrafts(now: Date = new Date()): Promise<{ deleted: number; comparisons: number }> {
  const cutoff = new Date(now.getTime() - HISTORY_LEARN_DRAFT_RETENTION_DAYS * 86_400_000);
  const r = await prisma.historyLearnDraft.deleteMany({ where: { state: { not: "approved" }, createdAt: { lt: cutoff } } });
  // Oluşturma tarihine göre (Opus 10-15 HL4 F13: `updatedAt` her yeniden karşılaştırma / kararda sıfırlanıyor, saat hiç dolmuyordu).
  const c = await prisma.historyLearnComparison.deleteMany({ where: { createdAt: { lt: cutoff } } });
  // Sorusu artık olmayan karşılaştırma (konuşma birleştirme / silme sonrası — F11): misafir silmesi onu kimlikle bulamaz, burada silinir.
  const orphans = await prisma.$executeRaw`
    DELETE FROM "HistoryLearnComparison" c WHERE NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."id" = c."questionMessageId")`;
  return { deleted: r.count, comparisons: c.count + orphans };
}

export const DRAFT_EDIT_MAX_TITLE = 120;
export const DRAFT_EDIT_MAX_CONTENT = 2_000;

export type ReviewResult =
  | { ok: true; kbItemId: string | null }
  | { ok: false; reason: "not_found" | "already_reviewed" | "invalid" | "door_code" | "hijack" | "plan_items" | "plan_chars" }
  | { ok: false; reason: "needs_confirm"; flags: DraftFlag[]; conflict: boolean };

/**
 * Konuşmaların misafir adları — konuşma BAŞINA (Opus gece-2 M9, ölçüldü: bütün konuşmaların mesajları tek `take: 2_000` sorgusundaydı; 200
 * konuşma × ~15 mesajda en yeni konuşmaların ad satırı gelmiyor, ev sahibinin cevabındaki misafir adı maskesiz kalıyordu). Rezervasyon adı +
 * görünen kimlik konuşma satırından, gelen mesaj gönderen adları (konuşma, ad) çifti başına TEKİL.
 */
async function guestNamesForConversations(convIds: readonly string[]): Promise<Map<string, Set<string>>> {
  if (convIds.length === 0) return new Map();
  const [convs, senders] = await Promise.all([
    prisma.conversation.findMany({
      where: { id: { in: [...convIds] } },
      select: { id: true, guestIdentifier: true, reservation: { select: { guestName: true } } },
    }),
    // SQL GROUP BY (Prisma `distinct` önizleme olmadan BELLEKTE uygulanır — bütün satırları çekerdi; Opus gece-3 P3-c).
    prisma.message.groupBy({
      by: ["conversationId", "senderName"],
      where: { conversationId: { in: [...convIds] }, direction: "inbound" },
      take: 5_000,
      orderBy: [{ conversationId: "asc" }, { senderName: "asc" }],
    }),
  ]);
  return guestNamesOf([
    ...convs.map((c) => ({ conversationId: c.id, direction: "outbound", conversation: { guestIdentifier: c.guestIdentifier, reservation: c.reservation } })),
    ...senders.map((m) => ({ conversationId: m.conversationId, direction: "inbound", senderName: m.senderName })),
  ]);
}

/** Karşılaştırma notundan doğan taslağın başlığı (taslak her zaman "compare" koşusuna bağlıdır — ekran `run.kind` ile ayırır). */
const NOTE_DRAFT_TITLE = "Ev sahibi notu";

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
  const names = [...new Set([...(await guestNamesForConversations(convIds)).values()].flatMap((s) => [...s]))];
  const hostAnswers = msgs.length ? msgs.map((m) => maskForLearning(m.body ?? "", names)) : undefined;
  return { hostAnswers, guestNames: names };
}

/** İnceleme ekranında taslak başına gösterilen örnek cevabın en çok uzunluğu (maskeden SONRA kırpılır — `mask.ts` kuralı). */
export const EVIDENCE_SAMPLE_MAX_CHARS = 280;

/**
 * TASLAĞIN DAYANDIĞI ÖRNEK (Opus 10-15 H6, Codex ilke 1 "mesajı bağlamından koparma"): ekran yalnız çıkarılmış metni gösteriyordu — ev
 * sahibi "bunu nereden çıkardı?" sorusunu cevaplayamıyordu. Taslak başına İLK kanıt mesajı (ev sahibinin kendi cevabı) CANLI satırdan okunur
 * (saklama süresi / misafir silmesi mesajla birlikte işler — kopya tutulmaz), çıkarımla AYNI maskeden geçer (ad / telefon / e-posta / kapı
 * kodu), ay etiketiyle. Kapsam: mülk (çağıran işletmeye ait olduğunu doğruladı). Silinmiş / anonimleştirilmiş mesaj → örnek yok.
 */
export async function draftEvidenceSamples(
  propertyId: string,
  drafts: readonly { id: string; evidenceMessageIdsJson: string }[],
): Promise<Map<string, { text: string; month: string }>> {
  const firstIdOf = new Map<string, string>();
  for (const d of drafts) {
    try {
      const v = JSON.parse(d.evidenceMessageIdsJson);
      const first = Array.isArray(v) ? v.find((x): x is string => typeof x === "string") : undefined;
      if (first) firstIdOf.set(d.id, first);
    } catch {
      /* bozuk iz → örnek yok */
    }
  }
  const out = new Map<string, { text: string; month: string }>();
  if (firstIdOf.size === 0) return out;
  const msgs = await prisma.message.findMany({
    where: { id: { in: [...new Set(firstIdOf.values())] }, conversation: { propertyId } },
    select: { id: true, conversationId: true, body: true, createdAt: true },
  });
  if (msgs.length === 0) return out;
  const namesByConv = await guestNamesForConversations([...new Set(msgs.map((m) => m.conversationId))]);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  for (const [draftId, messageId] of firstIdOf) {
    const m = byId.get(messageId);
    const body = m?.body?.trim();
    if (!m || !body || body === ANON_BODY) continue;
    const masked = maskForLearning(body, [...(namesByConv.get(m.conversationId) ?? [])]);
    const text = masked.length > EVIDENCE_SAMPLE_MAX_CHARS ? `${masked.slice(0, EVIDENCE_SAMPLE_MAX_CHARS)} …` : masked;
    out.set(draftId, { text, month: m.createdAt.toISOString().slice(0, 7) });
  }
  return out;
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
export { INSTRUCTION_MAX_CHARS, INSTRUCTIONS_MAX_ACTIVE, checkInstruction, type InstructionCheck, type InstructionRejectReason } from "./instruction-gate";
export async function addPropertyInstruction(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  content: string;
  source?: "host_note" | "history_learn";
  /** Yazan operatör mü (bkz. `reviewComparison.byOperator`). */
  byOperator?: boolean;
}): Promise<{ ok: true; id: string; reused?: boolean } | { ok: false; reason: InstructionRejectReason | "not_found" | "limit" }> {
  const check = checkInstruction(input.content);
  if (!check.ok) return check;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Property" WHERE "id" = ${input.propertyId} AND "organizationId" = ${input.organizationId} FOR NO KEY UPDATE`;
    if (!locked.length) return { ok: false, reason: "not_found" } as const;
    // Tekrar gönderim (çift tıklama / bağlantı cevap anında koptu) İKİNCİ talimat açmaz (idempotency denetimi 10-15, P2; `reviewComparison`
    // emsali): aynı metinli, aynı yazan sınıfından etkin serbest talimat varsa o döner. Mülk kilidi altında → yarışsız. Tavandan ÖNCE:
    // sınırdaki yeniden deneme "sınır" hatası değil, var olan satırı alır.
    const same = await tx.propertyInstruction.findFirst({
      where: { propertyId: input.propertyId, status: "active", presetKey: null, byOperator: input.byOperator === true, content: check.content },
      select: { id: true },
    });
    if (same) return { ok: true, id: same.id, reused: true } as const;
    // Tavan yalnız SERBEST metne (hazır seçenekler kapalı küme, sayıları sabit).
    const active = await tx.propertyInstruction.count({ where: { propertyId: input.propertyId, status: "active", presetKey: null } });
    if (active >= INSTRUCTIONS_MAX_ACTIVE) return { ok: false, reason: "limit" } as const;
    const row = await tx.propertyInstruction.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        content: check.content,
        source: input.source ?? "host_note",
        byOperator: input.byOperator === true,
        createdById: input.userId,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id } as const;
  });
}

/**
 * HAZIR SEÇENEK aç / kapat (kurucu 10-15: "Müşteri, hazır seçeneklerden seçsin"). Müşteri serbest metin yazmaz; metin koddaki
 * kapalı kümeden gelir ve yine kapıdan geçer (isteme girerken de). İdempotent: açık olanı yeniden açmak / kapalıyı kapatmak değişiklik
 * yapmaz. Mülk satırı kilitli (çift tıklama iki satır açamaz).
 */
export async function setPresetInstruction(input: {
  organizationId: string;
  propertyId: string;
  userId: string | null;
  key: string;
  on: boolean;
}): Promise<{ ok: true; changed: boolean } | { ok: false; reason: "not_found" | "invalid" }> {
  const preset = presetByKey(input.key);
  if (!preset || !checkInstruction(preset.text).ok) return { ok: false, reason: "invalid" };
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Property" WHERE "id" = ${input.propertyId} AND "organizationId" = ${input.organizationId} FOR NO KEY UPDATE`;
    if (!locked.length) return { ok: false, reason: "not_found" } as const;
    const where = { propertyId: input.propertyId, status: "active", presetKey: preset.key };
    if (!input.on) {
      const r = await tx.propertyInstruction.updateMany({ where, data: { status: "retired", retiredAt: new Date() } });
      return { ok: true, changed: r.count > 0 } as const;
    }
    if (await tx.propertyInstruction.count({ where })) return { ok: true, changed: false } as const;
    await tx.propertyInstruction.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        content: preset.text,
        source: "preset",
        presetKey: preset.key,
        createdById: input.userId,
      },
    });
    return { ok: true, changed: true } as const;
  });
}

/** Mülkün hazır seçenek durumları (ekrandaki liste; açık olan = etkin satırı var). */
export async function listPresetStates(propertyId: string): Promise<{ key: string; label: string; description: string; on: boolean }[]> {
  const rows = await prisma.propertyInstruction.findMany({
    where: { propertyId, status: "active", presetKey: { not: null } },
    select: { presetKey: true },
  });
  const on = new Set(rows.map((r) => r.presetKey));
  return INSTRUCTION_PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description, on: on.has(p.key) }));
}

/** Serbest metin talimatını kaldırır. Hazır seçenek satırı buradan KALDIRILMAZ (yalnız aç / kapat yolu: `setPresetInstruction`). */
export async function retirePropertyInstruction(organizationId: string, id: string): Promise<boolean> {
  const r = await prisma.propertyInstruction.updateMany({
    where: { id, organizationId, status: "active", presetKey: null },
    data: { status: "retired", retiredAt: new Date() },
  });
  return r.count === 1;
}

// ── Karşılaştırma kararı (F1) ───────────────────────────────────────────────────────────────────────────────────────────────────
export const COMPARISON_VERDICTS = ["good", "fix", "bad"] as const;

export type ComparisonReviewResult =
  | { ok: true; instructionId: string | null; draftId: string | null }
  | { ok: false; reason: "not_found" | "invalid" | "note_required" | InstructionRejectReason | "limit" | "stale" };

/**
 * Karar + not. `apply` ("böyle yapsın"): not kapılardan geçer (talimat kuralı), sonra AYNI işlemde HEM mülk talimatı (kaynak
 * `history_learn`) HEM bilgi tabanı TASLAĞI olur (onay bekler — A1). Not kapıdan dönerse hiçbir şey yazılmaz.
 */
export async function reviewComparison(input: {
  organizationId: string;
  comparisonId: string;
  userId: string | null;
  /** Verilmezse (undefined) mevcut karar KORUNUR; null = kararı kaldır. */
  verdict?: string | null;
  /** Verilmezse mevcut not KORUNUR; boş metin = notu kaldır. */
  note?: string | null;
  apply: boolean;
  /** Karar verilirken ekranda görülen yapay zekâ cevabı; o arada yeniden karşılaştırma cevabı değiştirdiyse karar YAZILMAZ (stale). */
  seenAnswer?: string | null;
  /** Yazan operatör mü (talimat satırına işlenir — müşteri anahtarı kapanınca yalnız operatörün serbest metni isteme girer). */
  byOperator?: boolean;
}): Promise<ComparisonReviewResult> {
  const cmp = await prisma.historyLearnComparison.findFirst({
    where: { id: input.comparisonId, property: { organizationId: input.organizationId } },
    select: { id: true, propertyId: true, runId: true, hostAnswerMessageIdsJson: true, note: true },
  });
  if (!cmp) return { ok: false, reason: "not_found" };
  if (input.verdict != null && !(COMPARISON_VERDICTS as readonly string[]).includes(input.verdict)) return { ok: false, reason: "invalid" };
  // Not: verilmediyse mevcut (zaten kapıdan geçmiş) not; verildiyse yenisi kapıdan geçer.
  let checked: string | null = cmp.note;
  if (input.note !== undefined) {
    const raw = input.note?.trim() || "";
    if (!raw) checked = null;
    else {
      const c = checkInstruction(raw);
      if (!c.ok) return { ok: false, reason: c.reason };
      checked = c.content;
    }
  }
  if (input.apply && !checked) return { ok: false, reason: "note_required" };
  try {
    return await prisma.$transaction(async (tx) => {
      // Kilit ÖNCE (talimat tavanı yarışı), karar + not, sonra uygulama. Uygulama başarısızsa her şey GERİ ALINIR (Haiku 10-15:
      // eskiden karar + not yazılıp 409 dönüyordu).
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Property" WHERE "id" = ${cmp.propertyId} AND "organizationId" = ${input.organizationId} FOR NO KEY UPDATE`;
      if (!locked.length) throw new ReviewAbort("not_found");
      // Karşılaştırma satırı KİLİTLİ okunur (Haiku 10-15): yeniden karşılaştırmanın yazımı (cevabı değiştirip kararı sıfırlar) bu işlem
      // bitene kadar bekler — denetim ile yazma arasına giremez.
      const cur = await tx.$queryRaw<{ aiAnswer: string | null }[]>`
        SELECT "aiAnswer" FROM "HistoryLearnComparison" WHERE "id" = ${cmp.id} FOR UPDATE`;
      if (!cur.length) throw new ReviewAbort("not_found");
      if (input.seenAnswer !== undefined && (cur[0].aiAnswer ?? null) !== (input.seenAnswer ?? null)) throw new ReviewAbort("stale");
      await tx.historyLearnComparison.update({
        where: { id: cmp.id },
        data: {
          ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
          ...(input.note !== undefined ? { note: checked } : {}),
          createdById: input.userId,
        },
      });
      if (!input.apply || !checked) return { ok: true, instructionId: null, draftId: null } as const;
      // Tekrar gönderim (çift tıklama) İKİNCİ talimat / taslak açmaz: aynı metinli etkin talimat ve bekleyen taslak yeniden kullanılır.
      // Yalnız SERBEST metin satırları (hazır seçenek satırı aynı metni taşısa da yeniden kullanılmaz; tavan da onları saymaz).
      const existingInstr = await tx.propertyInstruction.findFirst({
        // Yazan sınıfı da eşleşmeli (Haiku 10-15): operatörün notu müşterinin aynı metinli satırını yeniden kullanırsa müşteri anahtarı
        // kapanınca istemden düşerdi.
        where: { propertyId: cmp.propertyId, status: "active", presetKey: null, byOperator: input.byOperator === true, content: checked },
        select: { id: true },
      });
      let instructionId = existingInstr?.id ?? null;
      if (!instructionId) {
        const active = await tx.propertyInstruction.count({ where: { propertyId: cmp.propertyId, status: "active", presetKey: null } });
        if (active >= INSTRUCTIONS_MAX_ACTIVE) throw new ReviewAbort("limit");
        instructionId = (
          await tx.propertyInstruction.create({
            data: {
              organizationId: input.organizationId,
              propertyId: cmp.propertyId,
              content: checked,
              source: "history_learn",
              byOperator: input.byOperator === true,
              createdById: input.userId,
            },
            select: { id: true },
          })
        ).id;
      }
      const existingDraft = await tx.historyLearnDraft.findFirst({
        where: { propertyId: cmp.propertyId, state: "pending", content: checked },
        select: { id: true },
      });
      if (existingDraft) return { ok: true, instructionId, draftId: existingDraft.id } as const;
      const runId =
        cmp.runId ??
        (
          await tx.historyLearnRun.create({
            data: { organizationId: input.organizationId, propertyId: cmp.propertyId, kind: "compare", model: "note", status: "done" },
            select: { id: true },
          })
        ).id;
      const gate = gateDraft(NOTE_DRAFT_TITLE, checked);
      if (!gate.ok) throw new ReviewAbort(gate.reason === "empty" ? "note_required" : gate.reason);
      const draft = await tx.historyLearnDraft.create({
        data: {
          runId,
          propertyId: cmp.propertyId,
          category: "faq",
          title: NOTE_DRAFT_TITLE,
          content: checked,
          supportConversations: 1,
          flagsJson: JSON.stringify(gate.flags),
          evidenceMessageIdsJson: cmp.hostAnswerMessageIdsJson,
        },
        select: { id: true },
      });
      return { ok: true, instructionId, draftId: draft.id } as const;
    });
  } catch (err) {
    if (err instanceof ReviewAbort) return { ok: false, reason: err.reason };
    throw err;
  }
}

/** İşlem içi iptal → GERİ ALMA (dönüş değeri işlemi kapatıp yazdığını korurdu). */
class ReviewAbort extends Error {
  constructor(readonly reason: Extract<ComparisonReviewResult, { ok: false }>["reason"]) {
    super(reason);
  }
}
