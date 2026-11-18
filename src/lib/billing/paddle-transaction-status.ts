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

/** Paddle'daki işlemin karar için gereken olguları (ödeme defteri uzlaştırması + istemci tamamlama sinyalinin doğrulaması). */
export interface PaddleTransactionFacts {
  /** "ready" · "paid" · "completed" · … */
  status: string | null;
  /** İşlemin oluşturduğu / ait olduğu abonelik; "paid" anında boş olabilir, "completed"de dolar (PADDLE-VARSAYIM). */
  subscriptionId: string | null;
  /** Ödeme ekranı açılırken işleme yazdığımız onay kaydı kimliği (`custom_data.consentId`). */
  consentId: string | null;
  /** İşlemin kökeni: "web" (ödeme ekranı) · "api" (sunucu açtı) · "subscription_recurring" (yenileme) · … */
  origin: string | null;
}

/**
 * Paddle'da işlemin olguları — TEK okuma noktası; bulunamadıysa `not_found`; okunamazsa null (karar verilmez). Yalnız türü doğru alan
 * alınır (biçimsiz yanıt alanı boş sayılır, uydurulmaz).
 */
export async function readPaddleTransaction(transactionId: string): Promise<PaddleTransactionFacts | typeof PADDLE_TXN_NOT_FOUND | null> {
  try {
    const body = (await paddleRequest(`/transactions/${encodeURIComponent(transactionId)}`)) as { data?: unknown } | null;
    const d = body?.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : null;
    if (!d) return null;
    const cd = d.custom_data && typeof d.custom_data === "object" ? (d.custom_data as Record<string, unknown>) : null;
    const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
    const consentId = text(cd?.consentId);
    return {
      status: text(d.status),
      subscriptionId: text(d.subscription_id),
      consentId: consentId && consentId.length <= 64 ? consentId : null,
      origin: text(d.origin),
    };
  } catch (err) {
    return isPaddleNotFound(err) ? PADDLE_TXN_NOT_FOUND : null;
  }
}

/** Paddle'da işlemin durumu ("ready" · "paid" · …); bulunamadıysa `not_found`; okunamazsa null (karar verilmez). */
export async function paddleTransactionStatus(transactionId: string): Promise<string | null> {
  const facts = await readPaddleTransaction(transactionId);
  return facts === null ? null : facts === PADDLE_TXN_NOT_FOUND ? PADDLE_TXN_NOT_FOUND : facts.status;
}
