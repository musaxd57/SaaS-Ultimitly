import type { ClaimedActionsDeclaration } from "@/lib/ai/action-claims";

/**
 * Modelin taslağını KODDAN kurulan doğrulanmış metinle değiştirir (erken giriş onayı / politika, doğrulanmış müsaitlik / uzatma; kanal + QR
 * TEK kural). Kaynak sayımı ve iddia desteği modelin ATILAN taslağına aitti → ölçülmedi (A2: NULL, 0 değil); eylem beyanı istenmişse
 * boş (kod metni makbuzsuz eylem iddia etmez — MÇ §4), istenmemişse alan eklenmez (kapı ve kanıt bugünküyle birebir).
 */
export function codeBuiltResult<T extends { reply: string; intent: string; usedSources?: string[]; claimedActions?: ClaimedActionsDeclaration }>(
  result: T,
  text: string,
  intent: string,
): T {
  return {
    ...result,
    reply: text,
    intent,
    usedSources: [],
    claimAudit: undefined,
    sourceAudit: undefined,
    ...(result.claimedActions !== undefined ? { claimedActions: { status: "declared" as const, actions: [] } } : {}),
  };
}
