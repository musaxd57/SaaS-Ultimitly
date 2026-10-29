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
  // GD7 (gece döngüsü 10-29): "yalnız ev sahibine başvurma talimatı" işareti (`host-contact-filler.ts`) modelin atılan taslağına aitti —
  // kodla kurulan onaylı metne taşınırsa kapı onu gereksiz tutar.
  const { hostContactOnly: _draftHostContact, ...rest } = result as T & { hostContactOnly?: true };
  return {
    ...(rest as T),
    reply: text,
    intent,
    usedSources: [],
    claimAudit: undefined,
    sourceAudit: undefined,
    ...(result.claimedActions !== undefined ? { claimedActions: { status: "declared" as const, actions: [] } } : {}),
  };
}
