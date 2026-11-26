/* ---------------------------------------------------------------------------
 * ARKA PLAN GÖMME BÜTÇESİ — İŞLETME KOVASI + ORTAK KOVA (EMB tur 2 D1; kurucu 11-19 akşam madde 2: "işletme başına arka plan bütçesi …
 * bütçeyi uygulama kopyaları birlikte görsün"). Tasarım `docs/TASARIM-2026-11-19-anlamsal-arama-butcesi.md` §3.1, §3.4.
 *
 * NEDEN: ısıtma bütçesi süreç belleğindeydi ve bütün kiracılarda ORTAKTI (`semantic-retrieval.ts` `takeWarmBudget`, 2.000 metin / saat /
 * süreç). Ölçüldü (EMB-2, G2): tek işletme 13 düzenleme turunda herkesin saatlik payını bitiriyor; her kopya ve her yeniden başlatma sıfırdan
 * sayıyordu.
 *
 * SÖZLEŞME:
 *  · Anahtar `KB_EMBED_ORG_BUDGET_ENABLED` YALNIZ "1". Kapalıyken bu modül çağrılmaz (bugünkü süreç içi sayaç birebir).
 *  · İki kova, sıra önemli ("kendi kovası önce" — `daily-budget.ts` QR payı deseni): işletme kovası `kb-embed-org:<orgId>`, sonra ortak arka
 *    plan kovası `kb-embed-bg`; ikisi de `RateLimitCounter` satırı, saatlik, DB saatiyle (`rateLimitTakeIfFits`). Kopyalar aynı satırı görür,
 *    yeniden başlatma sıfırlamaz. Migration YOK.
 *  · İşletme kovası taşarsa ortak kovaya DOKUNULMAZ. Ortak kova taşarsa işletme kovasındaki alım da geri alınır (aynı işlem): iş hepsi-ya-hiç.
 *  · YALNIZ arka plan ısıtması buradan geçer. Sıcak yol (misafir sorgusunun gömmesi) hiçbir kovayı okumaz / yazmaz (pin).
 *  · Fail-soft: DB'ye ulaşılamazsa `null` döner; çağıran bugünkü süreç içi sayaca düşer (ısıtma isteğe bağlı bir iyileştirmedir).
 *  · Değerler kurucu sorusudur (E-1, E-2): koda gömülmez, ortam değişkeniyle okunur; varsayılanlar tasarımın önerisi.
 * ------------------------------------------------------------------------- */

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { rateLimitTakeIfFits } from "@/lib/rate-limit";

/** İşletme kovası (saatlik parça metni) — öneri E-1. */
export const KB_EMBED_ORG_PER_HOUR_DEFAULT = 600;
/** Ortak arka plan kovası (saatlik parça metni, BÜTÜN kopyalar için) — öneri E-2. */
export const KB_EMBED_BG_PER_HOUR_DEFAULT = 2_000;
export const KB_EMBED_BUCKET_WINDOW_MS = 3_600_000;
export const KB_EMBED_BG_KEY = "kb-embed-bg";
export const kbEmbedOrgKey = (organizationId: string): string => `kb-embed-org:${organizationId}`;

/** Anahtar yalnız tam "1" ile açılır. */
export function orgEmbedBudgetEnabled(): boolean {
  return process.env.KB_EMBED_ORG_BUDGET_ENABLED === "1";
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const v = raw?.trim();
  if (!v || !/^\d{1,7}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= 1 ? n : fallback;
}

export function embedOrgPerHour(): number {
  return positiveIntEnv(process.env.KB_EMBED_ORG_PER_HOUR, KB_EMBED_ORG_PER_HOUR_DEFAULT);
}

export function embedBgPerHour(): number {
  return positiveIntEnv(process.env.KB_EMBED_BG_PER_HOUR, KB_EMBED_BG_PER_HOUR_DEFAULT);
}

/**
 * `granted: false` → `retryAfterMs` reddeden kovanın penceresinin bitişine kalan süre; `null` = yeniden denemenin anlamı yok (kalemler
 * silinmiş, sahibi bulunamadı).
 */
export type EmbedBudgetVerdict = { granted: true } | { granted: false; bucket: "org" | "bg" | "owner"; retryAfterMs: number | null };

class BgRefused extends Error {
  constructor(readonly retryAfterMs: number) {
    super("kb-embed-bg refused");
  }
}

/** Kalem kimliklerinden işletme (sıcak yolun soğuk dalı işletmeyi bilmez; kalemler tek dairenin kümesidir). Bulunamazsa `null`. */
async function ownerOf(kbItemIds: readonly string[]): Promise<string | null> {
  if (kbItemIds.length === 0) return null;
  const row = await prisma.knowledgeBaseItem.findFirst({
    where: { id: { in: [...new Set(kbItemIds)].slice(0, 100) } },
    select: { property: { select: { organizationId: true } } },
  });
  return row?.property.organizationId ?? null;
}

/**
 * `n` parça metnini arka plan bütçesinden alır. `organizationId` verilmezse kalemlerden bulunur. DB'ye ulaşılamazsa `null` (çağıran süreç
 * içi sayaca düşer). Fırlatmaz.
 */
export async function takeEmbedBudget(input: {
  n: number;
  organizationId?: string | null;
  kbItemIds: readonly string[];
}): Promise<EmbedBudgetVerdict | null> {
  try {
    const organizationId = input.organizationId ?? (await ownerOf(input.kbItemIds));
    if (!organizationId) return { granted: false, bucket: "owner", retryAfterMs: null };
    const orgCap = embedOrgPerHour();
    const bgCap = embedBgPerHour();
    return await prisma.$transaction(async (tx) => {
      const org = await rateLimitTakeIfFits(kbEmbedOrgKey(organizationId), input.n, orgCap, KB_EMBED_BUCKET_WINDOW_MS, tx);
      if (!org.granted) return { granted: false, bucket: "org", retryAfterMs: org.retryAfterMs } as const;
      const bg = await rateLimitTakeIfFits(KB_EMBED_BG_KEY, input.n, bgCap, KB_EMBED_BUCKET_WINDOW_MS, tx);
      // Ortak kova taşarsa işletme kovasındaki alım da geri alınmalı: işlem geri sarılır (hepsi-ya-hiç).
      if (!bg.granted) throw new BgRefused(bg.retryAfterMs);
      return { granted: true } as const;
    });
  } catch (err) {
    if (err instanceof BgRefused) return { granted: false, bucket: "bg", retryAfterMs: err.retryAfterMs };
    void reportError("kb-embed-budget", err);
    return null;
  }
}
