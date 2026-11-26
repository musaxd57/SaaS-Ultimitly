import type { ClaimedActionsDeclaration } from "@/lib/ai/action-claims";
import { withoutCodeBuiltClearedFields } from "@/lib/ai/reply-field-rules";

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
  // GD7 (K-1029-E, kurucu 10-29 gece): hangi alanın kod metninde düşeceği TEK tabloda (`reply-field-rules.ts`) — atılan taslağın METNİ
  // hakkındaki her şey (kaynak / iddia denetimi, doğrulanmış parça metinleri ve "yalnız doğrulanmış parçalar" işareti, "yalnız ev sahibine
  // başvurma" işareti) düşer; mesaja ait hüküm ve güven kalır. Tablo testi (`reply-field-rules.test.ts`) bu fonksiyonu her alanda sınar.
  return {
    ...withoutCodeBuiltClearedFields(result),
    reply: text,
    intent,
    usedSources: [],
    ...(result.claimedActions !== undefined ? { claimedActions: { status: "declared" as const, actions: [] } } : {}),
  };
}
