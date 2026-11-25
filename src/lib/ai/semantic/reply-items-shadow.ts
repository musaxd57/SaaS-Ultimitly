import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { ANON_NAME } from "@/lib/anon-sentinels";
import { runShadowPass, type ShadowLayerSpec, type ShadowPassResult } from "@/lib/semantic-reading/shadow-pass";
import { semanticApiKey } from "./config";
import { REPLY_ITEMS_MAX, REPLY_ITEMS_READER_SYSTEM_PROMPT, readReplyItems, replyItemsReaderFlag, type ReplyItemsReaderResult } from "./reply-items-reader";
import { compareReplyCoverage, coverageOfConversationRule, type ReplyItemRef, type ReplyItemsVerdict } from "./reply-items-verdict";

// ---------------------------------------------------------------------------
// "BU CEVAP HANGİ İSTEĞE?" — GÖLGE OKUMA TURU (aşama Y1; kurucu 11-18 akşam, H-1; tasarım `docs/TASARIM-2026-11-18-yazdim-cozdum-ayrimi.md`).
//
// Ev sahibinin giden mesajı + konuşmanın o an AÇIK isteklerinin kısa listesi (kimlik + tür) modele okutulur; sonuç bugünkü kuralla ("ev
// sahibi yazdıysa bütün açık istekler yanıtlandı") kıyaslanıp KAYDEDİLİR (`SemanticReading`, katman `reply_items`). 🚨 HİÇBİR DAVRANIŞ
// DEĞİŞMEZ: öğelerin durumu, "Yanıtladınız" görünümü ve Dikkat paneli bu turdan habersizdir. Anahtar `AI_REPLY_ITEMS_READER_ENABLED`
// VARSAYILAN KAPALI; kapalıyken ya da model anahtarı yokken SORGUSUZ çıkar. Tur kuralları ortak koşucuda (`shadow-pass.ts`).
//
// Aday: ev sahibinin kendi yazdığı, son 48 saatteki giden mesaj — yalnız o konuşmada mesajdan ÖNCE açılmış ve hâlâ açık (ya da ev sahibine
// bırakılmış) en az bir istek varsa. Açık isteği olmayan mesaj aday DEĞİLDİR (okunacak bir şey yok; satır yazılmaz).
// ---------------------------------------------------------------------------

export const REPLY_ITEMS_SHADOW_LOOKBACK_HOURS = 48;
export const REPLY_ITEMS_SHADOW_MAX_PER_PASS = 8;
export const REPLY_ITEMS_SHADOW_DAILY_CAP_PER_ORG = 200;
export const REPLY_ITEMS_SHADOW_PASS_BUDGET_MS = 30_000;

const LAYER = "reply_items" as const;
/** Bugün "açık iş" sayılan saklı durumlar (ev sahibi yazınca görünümde "Yanıtladınız"a dönenler). */
const OPEN_STATUSES = ["open", "pending_host"] as const;

export function replyItemsPromptId(): string {
  return createHash("sha256").update(REPLY_ITEMS_READER_SYSTEM_PROMPT).digest("hex").slice(0, 12);
}

/**
 * Kayda giren ayrıntı (kapalı biçim): istek başına tür, ilişki (doğrulama öncesi / sonrası), alıntının KONUMU ve modelin kısa nedeni.
 * Alıntı metni ve öğe kimliği yok (kimlikler çağrıya özgü kısa adlardır; öğenin kendisi türünden ve sırasından okunur). Saf.
 */
export function replyItemsDetail(verdict: ReplyItemsVerdict): { coverage: string; invented: number; ungrounded: number; items: unknown[] } {
  return {
    coverage: verdict.coverage,
    invented: verdict.invented,
    ungrounded: verdict.ungrounded,
    items: verdict.items.map((i) => ({ kind: i.kind, relation: i.relation, raw: i.raw, span: i.span, why: i.why })),
  };
}

interface Candidate {
  id: string;
  body: string;
  createdAt: Date;
  conversationId: string;
  organizationId: string;
  guestIdentifier: string | null;
  /** Konuşmanın rezervasyonundaki misafir adları (yalnız aynı işletmenin rezervasyonu; yoksa null) — ad maskesi için. */
  guestName: string | null;
  guestGivenName: string | null;
}

type Reader = (input: { message: string; items: readonly ReplyItemRef[]; names?: readonly (string | null | undefined)[] }) => Promise<ReplyItemsReaderResult>;

/** Mesaj anında açık olan istekler (en eski önce, en çok `REPLY_ITEMS_MAX`), modele verilecek kısa kimliklerle. */
async function openItemsFor(c: Candidate): Promise<ReplyItemRef[]> {
  const rows = await prisma.conversationItem.findMany({
    where: { organizationId: c.organizationId, conversationId: c.conversationId, status: { in: [...OPEN_STATUSES] }, createdAt: { lte: c.createdAt } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: REPLY_ITEMS_MAX,
    select: { kind: true },
  });
  return rows.map((r, i) => ({ ref: `i${i + 1}`, kind: r.kind }));
}

function layerSpec(reader: Reader): ShadowLayerSpec<Candidate> {
  return {
    layer: LAYER,
    promptId: replyItemsPromptId(),
    // Misafir adı maskesi üç kaynaktan, kiracı kapsamlı (söz turuyla aynı birleştirme — `host-commitment-shadow.ts`, G1 T2-B7).
    // Maskeli konaklamanın mesajı aday değil (K22 — söz turuyla aynı süzgeç ve gerekçe).
    candidates: ({ since, now, limit }) =>
      prisma.$queryRaw<Candidate[]>(Prisma.sql`
        SELECT m."id", m."body", m."createdAt", m."conversationId", p."organizationId", c."guestIdentifier", r."guestName", r."guestGivenName"
        FROM "Message" m
        JOIN "Conversation" c ON c."id" = m."conversationId"
        JOIN "Property" p ON p."id" = c."propertyId"
        LEFT JOIN "Reservation" r ON r."id" = c."reservationId"
          AND EXISTS (SELECT 1 FROM "Property" rp WHERE rp."id" = r."propertyId" AND rp."organizationId" = p."organizationId")
        WHERE m."direction" = 'outbound'
          AND m."authorType" = 'host'
          AND m."createdAt" >= ${since}
          AND m."createdAt" <= ${now}
          AND p."organizationId" <> ${DEMO_ORG_ID}
          AND (c."reservationId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Reservation" er WHERE er."id" = c."reservationId" AND er."guestName" = ${ANON_NAME}))
          AND NOT EXISTS (SELECT 1 FROM "SemanticReading" r WHERE r."messageId" = m."id" AND r."layer" = ${LAYER})
          AND EXISTS (
            SELECT 1 FROM "ConversationItem" i
            WHERE i."conversationId" = m."conversationId"
              AND i."organizationId" = p."organizationId"
              AND i."status" IN (${Prisma.join([...OPEN_STATUSES])})
              AND i."createdAt" <= m."createdAt"
          )
        ORDER BY m."createdAt" ASC, m."id" ASC
        LIMIT ${limit}
      `),
    // Bugünkü kural: ev sahibi yazdıysa konuşmanın bütün açık istekleri "Yanıtladınız".
    currentDecision: () => coverageOfConversationRule(),
    read: async (c) => {
      const items = await openItemsFor(c);
      // Aday seçildikten sonra istekler kapandıysa okunacak bir şey kalmadı: kalıcı sonuç olarak yazılır (aday yeniden seçilmesin).
      if (items.length === 0) return { ok: false, error: "no_input", model: null, ms: 0 };
      const res = await reader({ message: c.body, items, names: [c.guestIdentifier, c.guestName, c.guestGivenName] });
      if (!res.ok) return res;
      return {
        ok: true,
        modelDecision: res.verdict.coverage,
        agreement: compareReplyCoverage(res.verdict.coverage),
        detail: replyItemsDetail(res.verdict),
        model: res.model,
        ms: res.ms,
      };
    },
  };
}

/** Gölge okuma turu. Asla fırlatmaz. `reader` ve `elapsedMs` yalnız testler içindir. */
export async function sweepReplyItemsShadow(now: Date = new Date(), deps: { reader?: Reader; elapsedMs?: () => number } = {}): Promise<ShadowPassResult> {
  if (!replyItemsReaderFlag() || !semanticApiKey()) return { read: 0, budget: 0, stoppedOnTransient: false };
  return runShadowPass(
    layerSpec(deps.reader ?? readReplyItems),
    {
      lookbackHours: REPLY_ITEMS_SHADOW_LOOKBACK_HOURS,
      maxPerPass: REPLY_ITEMS_SHADOW_MAX_PER_PASS,
      dailyCapPerOrg: REPLY_ITEMS_SHADOW_DAILY_CAP_PER_ORG,
      budgetMs: REPLY_ITEMS_SHADOW_PASS_BUDGET_MS,
    },
    now,
    { elapsedMs: deps.elapsedMs, errorContext: "reply-items-shadow" },
  );
}
