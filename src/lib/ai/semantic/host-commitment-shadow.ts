import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { detectHostPromises } from "@/lib/ai-suggestions/core";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { recordSemanticReading, semanticOutcomeOf } from "@/lib/semantic-reading/store";
import { semanticApiKey } from "./config";
import { HOST_COMMITMENT_READER_SYSTEM_PROMPT, hostCommitmentReaderFlag, readHostCommitments, type HostCommitmentReaderResult } from "./host-commitment-reader";
import { compareHostCommitmentDecisions, decisionOfLexicalPromises, type HostCommitmentVerdict } from "./host-commitment-verdict";

// ---------------------------------------------------------------------------
// EV SAHİBİNİN SÖZÜ — GÖLGE OKUMA TURU (aşama 0; kurucu 11-18 akşam: "kelime bazlı değil … anlamı model güçlerine bırak ama arkada çok hızlı
// kontroller sağlansın, doğru anlandığına dair anlama şekli ve nedeni tutulsun; LLM'lerin gücünü test ederek avantaja geçiyorsak kullan").
//
// Ev sahibinin giden mesajını MODEL okur (`host-commitment-reader.ts`), kod doğrular (`host-commitment-verdict.ts`), sonuç bugünkü sözcük
// ağının kararıyla kıyaslanıp KAYDEDİLİR (`SemanticReading`, katman `host_commitment`). 🚨 HİÇBİR DAVRANIŞ DEĞİŞMEZ: görev / kart / söz
// akışı (`guest-commitments-auto.ts`) bu turdan habersizdir; tur yalnız zamanlanmış işte koşar (ev sahibinin "Gönder"i model çağrısını
// beklemez). Anahtar `AI_HOST_COMMITMENT_READER_ENABLED` VARSAYILAN KAPALI; kapalıyken ya da model anahtarı yokken SORGUSUZ çıkar.
//
// Açlık yok: adaylar "henüz okunmamış" süzgeciyle SORGUDA seçilir, eskiden yeniye. Kalıcı hata (bozuk cevap, çok uzun mesaj) satır yazar
// ve bir daha seçilmez; GEÇİCİ sağlayıcı arızasında (ağ / 5xx / hız sınırı) satır yazılmaz ve tur DURUR — aynı mesaj sonraki turda yeniden
// denenir (48 saatlik pencere dolunca düşer). Günlük sınırı dolan işletmenin mesajı model çağrılmadan `budget` satırı alır (sözcük ağının
// kararı yine yazılır) — sınır yüzünden kuyruğun başı tıkanmaz.
// ---------------------------------------------------------------------------

/** Okunacak mesajın en çok ne kadar eski olabileceği (söz turuyla aynı pencere). */
export const SHADOW_LOOKBACK_HOURS = 48;
/** Tur başına en çok okuma (model çağrısı) — zamanlanmış turu uzatmasın. */
export const SHADOW_MAX_PER_PASS = 8;
/** İşletme başına günde en çok model okuması (maliyet tavanı; UTC günü). */
export const SHADOW_DAILY_CAP_PER_ORG = 200;
/**
 * Turun süre tavanı: zamanlanmış iş bu turu beklerken öteki aşamalar gecikmesin (sağlayıcı yavaşsa okuma başına saniyeler sürebilir).
 * Tavan dolunca yeni okuma BAŞLATILMAZ; kalan adaylar sonraki tura kalır.
 */
export const SHADOW_PASS_BUDGET_MS = 30_000;

const LAYER = "host_commitment" as const;

/** İstem kimliği (SHA-256 ilk 12) — kayıt hangi istemle okunduğunu söyler. */
export function hostCommitmentPromptId(): string {
  return createHash("sha256").update(HOST_COMMITMENT_READER_SYSTEM_PROMPT).digest("hex").slice(0, 12);
}

/**
 * Kayda giren ayrıntı (kapalı biçim). Alıntı METNİ yok — yalnız modelin gördüğü metindeki konumu; modelin kısa nedeni (≤ 240) var.
 * Saf: aynı hükme aynı çıktı.
 */
export function hostCommitmentDetail(verdict: HostCommitmentVerdict): { ungrounded: number; statements: unknown[] } {
  return {
    ungrounded: verdict.ungrounded,
    statements: verdict.statements.map((s) => ({
      reading: s.reading,
      topic: s.topic,
      day: s.day,
      time: s.time,
      span: s.span,
      grounded: s.grounded,
      inQuotedSpan: s.inQuotedSpan,
      timeGrounded: s.timeGrounded,
      raw: s.raw,
      decision: s.decision,
      held: s.held,
      why: s.why,
    })),
  };
}

export interface ShadowPassResult {
  /** Model çağrılıp satırı yazılan mesaj (başarılı ya da kalıcı hatalı). */
  read: number;
  /** Günlük sınır yüzünden model çağrılmadan satırı yazılan mesaj. */
  budget: number;
  /** Tur geçici sağlayıcı arızasıyla durdu mu (kalan adaylar sonraki tura). */
  stoppedOnTransient: boolean;
}

interface Candidate {
  id: string;
  body: string;
  conversationId: string;
  organizationId: string;
  guestIdentifier: string | null;
}

type Reader = (input: { message: string; names?: readonly (string | null | undefined)[] }) => Promise<HostCommitmentReaderResult>;

/**
 * Gölge okuma turu. Asla fırlatmaz (hata raporlanır, tur biter). `reader` ve `elapsedMs` yalnız testler içindir (varsayılan: gerçek
 * okuyucu, gerçek geçen süre).
 */
export async function sweepHostCommitmentShadow(
  now: Date = new Date(),
  deps: { reader?: Reader; elapsedMs?: () => number } = {},
): Promise<ShadowPassResult> {
  const out: ShadowPassResult = { read: 0, budget: 0, stoppedOnTransient: false };
  if (!hostCommitmentReaderFlag() || !semanticApiKey()) return out;
  const reader = deps.reader ?? readHostCommitments;
  const startedAt = Date.now();
  const elapsedMs = deps.elapsedMs ?? (() => Date.now() - startedAt);
  try {
    const since = new Date(now.getTime() - SHADOW_LOOKBACK_HOURS * 3_600_000);
    // "Henüz okunmamış" süzgeci SORGUDA (sınırlı okuma + bellekte süzme, okunmuşların arkasındaki mesajı kalıcı aç bırakırdı). Yalnız ev
    // sahibinin kendi yazdığı giden mesajlar (otomasyon / yapay zekâ satırı söz değildir); demo işletmesi hariç.
    const candidates = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT m."id", m."body", m."conversationId", p."organizationId", c."guestIdentifier"
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      JOIN "Property" p ON p."id" = c."propertyId"
      WHERE m."direction" = 'outbound'
        AND m."authorType" = 'host'
        AND m."createdAt" >= ${since}
        AND m."createdAt" <= ${now}
        AND p."organizationId" <> ${DEMO_ORG_ID}
        AND NOT EXISTS (SELECT 1 FROM "SemanticReading" r WHERE r."messageId" = m."id" AND r."layer" = ${LAYER})
      ORDER BY m."createdAt" ASC, m."id" ASC
      LIMIT ${SHADOW_MAX_PER_PASS}
    `);
    if (candidates.length === 0) return out;

    // Günlük sınır: işletme başına bugün (UTC) MODEL ÇAĞRILAN okuma sayısı. `budget` satırları sayılmaz (model çağrılmadı).
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const orgIds = [...new Set(candidates.map((c) => c.organizationId))];
    const usedRows = await prisma.semanticReading.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds }, layer: LAYER, createdAt: { gte: dayStart }, NOT: { outcome: "budget" } },
      _count: { _all: true },
    });
    const used = new Map(usedRows.map((r) => [r.organizationId, r._count._all]));
    const promptId = hostCommitmentPromptId();

    for (const c of candidates) {
      const lexical = decisionOfLexicalPromises(detectHostPromises(c.body));
      const base = { organizationId: c.organizationId, conversationId: c.conversationId, messageId: c.id, layer: LAYER, lexicalDecision: lexical, promptId };
      if ((used.get(c.organizationId) ?? 0) >= SHADOW_DAILY_CAP_PER_ORG) {
        if (await write({ ...base, outcome: "budget" })) out.budget++;
        continue;
      }
      // Süre tavanı: yeni model çağrısı başlatılmaz (günlük sınır satırları çağrı yapmadığı için yukarıda yazılmaya devam eder).
      if (elapsedMs() > SHADOW_PASS_BUDGET_MS) break;
      const res = await reader({ message: c.body, names: [c.guestIdentifier] });
      if (!res.ok && res.transient) {
        // Sağlayıcı geçici olarak cevap vermiyor: satır YAZILMAZ (yazılsaydı mesaj bir daha okunmazdı), tur durur.
        out.stoppedOnTransient = true;
        break;
      }
      used.set(c.organizationId, (used.get(c.organizationId) ?? 0) + 1);
      const written = res.ok
        ? await write({
            ...base,
            outcome: "ok",
            modelDecision: res.verdict.decision,
            agreement: compareHostCommitmentDecisions(lexical, res.verdict.decision),
            detail: hostCommitmentDetail(res.verdict),
            model: res.model,
            latencyMs: res.ms,
          })
        : await write({ ...base, outcome: semanticOutcomeOf(res.error), model: res.model, latencyMs: res.ms });
      if (written) out.read++;
    }
  } catch (err) {
    await reportError("host-commitment-shadow", err).catch(() => {});
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
