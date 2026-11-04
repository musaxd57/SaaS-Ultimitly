import "server-only";
import { paddleRequest } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// PADDLE İŞLEM DURUMU — tek okuma noktası (ödeme niyeti süpürgesi + "ödeme başarısız" olayının kilit kararı). `checkout-intent.ts`'ten
// birebir taşındı (Codex 11-04 P1: başarısızlık olayı da aynı okumayı kullanır; döngüsel içe aktarma olmasın diye ayrı yaprak modül).
// ---------------------------------------------------------------------------

/** Ödenmiş sayılan durumlar. */
export const PADDLE_PAID_STATES: ReadonlySet<string> = new Set(["paid", "completed"]);
/** Paddle'ın işlemi bulamadığı durum (ör. sandbox işlemi canlı anahtarla soruldu) — kalıcı; işlem kapalı sayılır (Opus 10-21 B2). */
export const PADDLE_TXN_NOT_FOUND = "not_found";

/** `paddleRequest` hata metni: "Paddle HTTP 404 (entity_not_found) env=… resource=…". */
function isPaddleNotFound(err: unknown): boolean {
  return err instanceof Error && /^Paddle HTTP 404 \(|\(entity_not_found\)/.test(err.message);
}

/** Paddle'da işlemin durumu ("ready" · "paid" · …); bulunamadıysa `not_found`; okunamazsa null (karar verilmez). */
export async function paddleTransactionStatus(transactionId: string): Promise<string | null> {
  try {
    const body = (await paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`)) as { data?: { status?: unknown } } | null;
    return typeof body?.data?.status === "string" ? body.data.status : null;
  } catch (err) {
    return isPaddleNotFound(err) ? PADDLE_TXN_NOT_FOUND : null;
  }
}
