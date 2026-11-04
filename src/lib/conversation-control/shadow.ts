import "server-only";

import { logEvent } from "@/lib/event-log";
import { activeBlocksOf } from "./blocks";
import { autoSendDecision, shadowMismatch, type ActiveBlock, type AutoSendFacts } from "./decision";

// ---------------------------------------------------------------------------
// KONUŞMA KONTROLÜ — G0 GÖLGE KIYASI (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §11). Anahtar
// `CONVERSATION_CONTROL_SHADOW_ENABLED` VARSAYILAN KAPALI (kapalıyken veritabanına hiç dokunmaz). Açıkken bugünkü karar noktalarında
// (kanal oto-yanıtının gönderimden hemen önceki anı · kuyruğun gönderim anı vetosu) yeni modelin kararı hesaplanır ve bugünküyle kıyaslanır;
// ayrışma YALNIZ sayılır. Bugünkü karar uygulanır — misafire giden hiçbir şey değişmez. Asla fırlatmaz.
// ---------------------------------------------------------------------------

export function conversationControlShadowEnabled(): boolean {
  return process.env.CONVERSATION_CONTROL_SHADOW_ENABLED === "1";
}

export interface ShadowCompareInput {
  organizationId: string;
  conversationId: string;
  /** Kıyas noktası (sayım anahtarı). */
  point: "inline" | "queue";
  /** Bugünkü kararın sonucu: gönderilecek mi. */
  oldAllowed: boolean;
  /** Bugünkü kontrollerden türetilen, modeller arasında ORTAK olgular (engel ve kontrol dışında her şey). */
  facts: Omit<AutoSendFacts, "blocks" | "controlMode">;
  /**
   * Konuşma bugün `problem` ve bu durum G0'dan ÖNCE yazıldı (engel kaydı olamaz) → kıyasta `legacy_problem` engeli sayılır; sahte "yeni model
   * gönderirdi" sayımı olmasın (tasarım §11.6 b).
   */
  legacyProblem: boolean;
}

export async function shadowCompareAutoSend(input: ShadowCompareInput): Promise<void> {
  if (!conversationControlShadowEnabled()) return;
  try {
    const blocks = await activeBlocksOf(input.conversationId);
    if (blocks === null) return; // okunamadı → bu tur kıyas yok
    const all: ActiveBlock[] =
      input.legacyProblem && !blocks.some((b) => b.scope === "conversation")
        ? [...blocks, { kind: "legacy_problem", scope: "conversation", itemId: null }]
        : blocks;
    // G0: kontrol alanı yok (G2 Devral) → her zaman `auto`.
    const next = autoSendDecision({ ...input.facts, blocks: all, controlMode: "auto" });
    const mismatch = shadowMismatch(input.oldAllowed, next);
    if (!mismatch) return;
    // Olay günlüğünün kapalı anahtar kümesi (`event-log.ts` DATA_KEYS, değer `[A-Za-z0-9_.:-]`): nokta · yön · BİRİNCİL sebep (sabit sıranın
    // ilki) · birincil engel türü. Sayım için yeter; metin / kimlik yok.
    await logEvent(
      "conversation_control.shadow_mismatch",
      { context: input.point, status: mismatch.direction, reason: mismatch.reasons[0] ?? "none", resource: mismatch.blockKinds[0] ?? "none" },
      { organizationId: input.organizationId },
    );
  } catch {
    // gölge ölçümü ürünü düşüremez
  }
}
