import "server-only";

import { prisma } from "@/lib/db";
import { checkInstruction } from "./service";

// ---------------------------------------------------------------------------
// MÜLK TALİMATI → CEVAP İSTEMİ (F2; kurucu 10-15: "böyle yapsın" notu HEM bilgi tabanına HEM mülke özgü talimata). Anahtar
// `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED` VARSAYILAN KAPALI — açmak misafire giden cevabı değiştirir → kurucu kararı + ilk denemeler.
// Kapalıyken istem bayt bayt aynı (yükleyici boş liste döner, blok basılmaz).
//
// Kurallar (Opus 10-15 iki ajan): talimat İSTEMDİR → kapılar istem anında YENİDEN koşar (`checkInstruction`; kayıttan sonra kural
// değişse de eski satır isteme kapısız girmez) · toplam tavan `PROMPT_INSTRUCTIONS_MAX_CHARS` (istem bütçesi) · sıra yazılış sırası ·
// yalnız `active`. Talimat BİLGİ KAYNAĞI DEĞİLDİR (üslup rehberiyle aynı kural: iddia desteği dayanak saymaz).
// ---------------------------------------------------------------------------

export const PROMPT_INSTRUCTIONS_MAX_CHARS = 1_500;

export function propertyInstructionsPromptEnabled(): boolean {
  return process.env.PROPERTY_INSTRUCTIONS_PROMPT_ENABLED === "1";
}

/** Saf: kapıdan geçen talimatlar, toplam tavana kadar (tavanı aşan talimat BÖLÜNMEZ, atlanır). */
export function selectPromptInstructions(rows: readonly { content: string }[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const r of rows) {
    const c = checkInstruction(r.content);
    if (!c.ok) continue;
    if (total + c.content.length > PROMPT_INSTRUCTIONS_MAX_CHARS) continue;
    out.push(c.content);
    total += c.content.length;
  }
  return out;
}

/** Cevap istemi için mülk talimatları. Anahtar kapalı / okuma hatası → boş (cevap talimatsız üretilir — bugünkü davranış). */
export async function loadPromptInstructions(organizationId: string, propertyId: string | null | undefined): Promise<string[]> {
  if (!propertyInstructionsPromptEnabled() || !propertyId) return [];
  try {
    const rows = await prisma.propertyInstruction.findMany({
      where: { propertyId, organizationId, status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { content: true },
      take: 50,
    });
    return selectPromptInstructions(rows);
  } catch {
    return [];
  }
}
