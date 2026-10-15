import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { checkInstruction } from "./instruction-gate";

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

/**
 * İki anahtar BİRLİKTE (Opus 10-15 F8): talimatlar yalnız "Geçmişten öğren" açıkken yönetilebilir (listelenir / kaldırılır); o kapalıyken
 * isteme giren talimat, ekranda görünmeyen ve kaldırılamayan bir yönlendirme olurdu.
 */
export function propertyInstructionsPromptEnabled(): boolean {
  return process.env.PROPERTY_INSTRUCTIONS_PROMPT_ENABLED === "1" && process.env.HISTORY_LEARN_ENABLED === "1";
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

/**
 * Cevap istemi için mülk talimatları. Anahtar kapalı / okuma hatası → boş (cevap talimatsız üretilir — bugünkü davranış).
 * `dryRun` (yalnız karşılaştırma kuru koşusu — hiçbir şey gönderilmez): talimat anahtarı KAPALIYKEN de yükler; operatör talimatın
 * etkisini anahtarı açmadan (ve müşteriye seçenek göstermeden) dener (Opus 10-15 HL4 F14). "Geçmişten öğren" kapalıysa yine boş.
 * Satır seçimi (F4): hazır seçenek ve operatörün yazdığı serbest metin her zaman; müşterinin serbest metni yalnız müşteri serbest metin
 * anahtarı açıkken (kapanınca ekranda görünmeyen / kaldırılamayan yönlendirme kalmasın).
 */
export async function loadPromptInstructions(
  organizationId: string,
  propertyId: string | null | undefined,
  opts: { dryRun?: boolean } = {},
): Promise<string[]> {
  if (!propertyId) return [];
  if (!propertyInstructionsPromptEnabled() && !(opts.dryRun && process.env.HISTORY_LEARN_ENABLED === "1")) return [];
  const customerFreeText = process.env.HISTORY_LEARN_CUSTOMER_INSTRUCTIONS_ENABLED === "1";
  try {
    const rows = await prisma.propertyInstruction.findMany({
      where: {
        propertyId,
        organizationId,
        status: "active",
        ...(customerFreeText ? {} : { OR: [{ presetKey: { not: null } }, { byOperator: true }] }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { content: true },
      take: 50,
    });
    return selectPromptInstructions(rows);
  } catch (err) {
    void reportError("history-learn loadPromptInstructions", err).catch(() => {});
    return [];
  }
}
