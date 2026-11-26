import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { recordSemanticReading, semanticOutcomeOf, type SemanticLayerName } from "./store";

// ---------------------------------------------------------------------------
// ANLAM OKUMASI GÖLGE TURU — ORTAK KOŞUCU (kurucu 11-18 akşam: "anlamı model güçlerine bırak ama arkada çok hızlı kontroller sağlansın, doğru
// anlandığına dair anlama şekli ve nedeni tutulsun"). Her katman (ev sahibinin sözü · cevabın hangi isteğe değindiği …) yalnız ÜÇ şeyi verir:
// okunacak adaylar, bugünkü kuralın kararı, modelin okuması. Tur kuralları TEK yerdedir ve katmanlar arasında aynıdır:
//  · HİÇBİR DAVRANIŞ DEĞİŞMEZ — tur yalnız `SemanticReading` satırı yazar;
//  · açlık yok: adayları katman "henüz okunmamış" süzgeciyle SORGUDA seçer; kalıcı hata satır yazar (bir daha seçilmez), GEÇİCİ sağlayıcı
//    arızasında satır yazılmaz ve tur durur (aynı aday sonraki turda yeniden denenir);
//  · maliyet: tur başına en çok N okuma, süre tavanı, işletme + katman başına günlük sınır (aşan aday model çağrılmadan `budget` satırı alır,
//    bugünkü kuralın kararı yine yazılır — sınır yüzünden kuyruğun başı tıkanmaz);
//  · asla fırlatmaz.
// ---------------------------------------------------------------------------

export interface ShadowCandidate {
  /** Okunan mesajın kimliği (satırın tekilliği: mesaj + katman). */
  id: string;
  conversationId: string;
  organizationId: string;
}

export type ShadowRead =
  | { ok: true; modelDecision: string; agreement: string | null; detail: unknown; model: string; ms: number }
  /** `transient`: sağlayıcının geçici arızası — satır yazılmaz, tur durur. */
  | { ok: false; error: string; model: string | null; ms: number; transient?: true };

export interface ShadowLayerSpec<C extends ShadowCandidate> {
  layer: SemanticLayerName;
  /** İstem kimliği (SHA-256 ilk 12). */
  promptId: string;
  /** Henüz okunmamış adaylar, eskiden yeniye, en çok `limit`. "Okunmamış" süzgeci SORGUDA olmalı. */
  candidates(input: { since: Date; now: Date; limit: number }): Promise<C[]>;
  /** Bugünkü kuralın bu aday için kararı (model çağrılmadan; `budget` satırına da yazılır). */
  currentDecision(candidate: C): string | null;
  read(candidate: C): Promise<ShadowRead>;
}

export interface ShadowPassLimits {
  lookbackHours: number;
  maxPerPass: number;
  dailyCapPerOrg: number;
  budgetMs: number;
}

export interface ShadowPassResult {
  /** Model çağrılıp satırı yazılan aday (başarılı ya da kalıcı hatalı). */
  read: number;
  /** Günlük sınır yüzünden model çağrılmadan satırı yazılan aday. */
  budget: number;
  /** Tur geçici sağlayıcı arızasıyla durdu mu (kalan adaylar sonraki tura). */
  stoppedOnTransient: boolean;
}

/** Katmanın bir turu. `elapsedMs` yalnız testler içindir (varsayılan: gerçek geçen süre). */
export async function runShadowPass<C extends ShadowCandidate>(
  spec: ShadowLayerSpec<C>,
  limits: ShadowPassLimits,
  now: Date,
  opts: { elapsedMs?: () => number; errorContext: string },
): Promise<ShadowPassResult> {
  const out: ShadowPassResult = { read: 0, budget: 0, stoppedOnTransient: false };
  const startedAt = Date.now();
  const elapsedMs = opts.elapsedMs ?? (() => Date.now() - startedAt);
  try {
    const since = new Date(now.getTime() - limits.lookbackHours * 3_600_000);
    const candidates = await spec.candidates({ since, now, limit: limits.maxPerPass });
    if (candidates.length === 0) return out;

    // Günlük sınır: işletme başına bugün (UTC) bu katmanda MODEL ÇAĞRILAN okuma sayısı. `budget` satırları sayılmaz (model çağrılmadı).
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const orgIds = [...new Set(candidates.map((c) => c.organizationId))];
    const usedRows = await prisma.semanticReading.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds }, layer: spec.layer, createdAt: { gte: dayStart }, NOT: { outcome: "budget" } },
      _count: { _all: true },
    });
    const used = new Map(usedRows.map((r) => [r.organizationId, r._count._all]));

    for (const c of candidates) {
      const base = {
        organizationId: c.organizationId,
        conversationId: c.conversationId,
        messageId: c.id,
        layer: spec.layer,
        lexicalDecision: spec.currentDecision(c),
        promptId: spec.promptId,
      };
      if ((used.get(c.organizationId) ?? 0) >= limits.dailyCapPerOrg) {
        if (await write({ ...base, outcome: "budget" })) out.budget++;
        continue;
      }
      // Süre tavanı: yeni model çağrısı başlatılmaz (günlük sınır satırları çağrı yapmadığı için yukarıda yazılmaya devam eder).
      if (elapsedMs() > limits.budgetMs) break;
      const res = await spec.read(c);
      if (!res.ok && res.transient) {
        // Sağlayıcı geçici olarak cevap vermiyor: satır YAZILMAZ (yazılsaydı aday bir daha okunmazdı), tur durur.
        out.stoppedOnTransient = true;
        break;
      }
      used.set(c.organizationId, (used.get(c.organizationId) ?? 0) + 1);
      const written = res.ok
        ? await write({ ...base, outcome: "ok", modelDecision: res.modelDecision, agreement: res.agreement, detail: res.detail, model: res.model, latencyMs: res.ms })
        : await write({ ...base, outcome: semanticOutcomeOf(res.error), model: res.model, latencyMs: res.ms });
      if (written) out.read++;
    }
  } catch (err) {
    await reportError(opts.errorContext, err).catch(() => {});
  }
  return out;
}

/** Satırı yaz; konuşma arada silindiyse (yabancı anahtar) ya da başka bir tur aynı satırı yazdıysa sessizce `false`. */
async function write(input: Parameters<typeof recordSemanticReading>[1]): Promise<boolean> {
  try {
    return await recordSemanticReading(prisma, input);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return false;
    throw err;
  }
}
