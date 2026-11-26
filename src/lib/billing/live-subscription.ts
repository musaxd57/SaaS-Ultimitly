/**
 * "Canlı Paddle aboneliği" — TEK KURAL (ödeme P2, 11-11): sağlayıcı Paddle + abonelik kimliği var + iptal edilmemiş. Onay rotası (yeni ödeme
 * ekranı açılmaz) ve ödeme niyeti (yer boşalınca yeniden bakış) aynı kuralı kullanır; iki yerde ayrı yazılırsa biri kayar.
 */
export function isLivePaddleSubscription(
  row: { provider: string | null; providerRef: string | null; status: string } | null | undefined,
): boolean {
  return row?.provider === "paddle" && Boolean(row.providerRef) && row.status !== "canceled";
}
