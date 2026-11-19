import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { detectHostPromises } from "@/lib/ai-suggestions/core";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { runShadowPass, type ShadowLayerSpec, type ShadowPassResult } from "@/lib/semantic-reading/shadow-pass";
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
// Tur kuralları (açlık yok · kalıcı hata satır yazar · geçici arızada satır yazmadan dur · süre ve günlük sınır) ortak koşucudadır:
// `semantic-reading/shadow-pass.ts`. Bu dosya yalnız katmanı tanımlar: adaylar, sözcük ağının kararı, modelin okuması.
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

export type { ShadowPassResult };

interface Candidate {
  id: string;
  body: string;
  conversationId: string;
  organizationId: string;
  guestIdentifier: string | null;
}

type Reader = (input: { message: string; names?: readonly (string | null | undefined)[] }) => Promise<HostCommitmentReaderResult>;

function layerSpec(reader: Reader): ShadowLayerSpec<Candidate> {
  // Sözcük ağının kararı aday başına bir kez hesaplanır (kayıt + kıyas aynı değeri okur).
  const lexicalOf = (c: Candidate) => decisionOfLexicalPromises(detectHostPromises(c.body));
  return {
    layer: LAYER,
    promptId: hostCommitmentPromptId(),
    // "Henüz okunmamış" süzgeci SORGUDA (sınırlı okuma + bellekte süzme, okunmuşların arkasındaki mesajı kalıcı aç bırakırdı). Yalnız ev
    // sahibinin kendi yazdığı giden mesajlar (otomasyon / yapay zekâ satırı söz değildir); demo işletmesi hariç.
    candidates: ({ since, now, limit }) =>
      prisma.$queryRaw<Candidate[]>(Prisma.sql`
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
        LIMIT ${limit}
      `),
    currentDecision: lexicalOf,
    read: async (c) => {
      const res = await reader({ message: c.body, names: [c.guestIdentifier] });
      if (!res.ok) return res;
      return {
        ok: true,
        modelDecision: res.verdict.decision,
        agreement: compareHostCommitmentDecisions(lexicalOf(c), res.verdict.decision),
        detail: hostCommitmentDetail(res.verdict),
        model: res.model,
        ms: res.ms,
      };
    },
  };
}

/**
 * Gölge okuma turu. Asla fırlatmaz (hata raporlanır, tur biter). `reader` ve `elapsedMs` yalnız testler içindir (varsayılan: gerçek
 * okuyucu, gerçek geçen süre).
 */
export async function sweepHostCommitmentShadow(
  now: Date = new Date(),
  deps: { reader?: Reader; elapsedMs?: () => number } = {},
): Promise<ShadowPassResult> {
  if (!hostCommitmentReaderFlag() || !semanticApiKey()) return { read: 0, budget: 0, stoppedOnTransient: false };
  return runShadowPass(
    layerSpec(deps.reader ?? readHostCommitments),
    { lookbackHours: SHADOW_LOOKBACK_HOURS, maxPerPass: SHADOW_MAX_PER_PASS, dailyCapPerOrg: SHADOW_DAILY_CAP_PER_ORG, budgetMs: SHADOW_PASS_BUDGET_MS },
    now,
    { elapsedMs: deps.elapsedMs, errorContext: "host-commitment-shadow" },
  );
}
