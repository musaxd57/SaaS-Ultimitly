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

// ---------------------------------------------------------------------------
// İADE ≠ İPTAL (Codex / kurucu 11-19: "Para alınmış ve plan hiç bağlanmamışsa yeni ödeme, aynı işlemin tam iadesi Paddle tarafından
// onaylanana veya operatör kanıtla sorunu çözene kadar açılmasın. Bekleyen ya da kısmi iade yeterli olmasın."). Paddle Billing'de iade
// işlemden AYRI bir kayıttır (adjustment): "refund" eylemi, "pending_approval" doğar, "approved" / "rejected" son durumdur, sonradan
// "reversed" olabilir; tam iade `type: "full"` taşır. Abonelik iptali paranın geri verildiğini SÖYLEMEZ.
// ---------------------------------------------------------------------------

/** Onaylı TAM iade var mı. */
export type PaddleRefundState = "full_refund_approved" | "no_full_refund";

/**
 * İşlemin iade kayıtlarını Paddle'dan okur. Yalnız AYNI işleme ait, eylemi "refund", durumu "approved" ve türü "full" olan kayıt tam iade
 * sayılır — bekleyen, reddedilen, geri çevrilen ve kısmi iadeler sayılmaz (kısmi iadelerin toplamı da: tam iadeyi Paddle `full` olarak
 * kaydeder; kısmi parçalarla kapanan durum operatörün kanıtla elle bırakmasına kalır). Okunamazsa null (karar verilmez). Asla fırlatmaz.
 * Yalnız ilk sayfa (50 kayıt) okunur: tam iade daha sonraki bir sayfada kalırsa sonuç "yok" olur — GÜVENLİ yön (engel kalır, operatör
 * elle bırakır); tek işlemde 50'den çok iade kaydı beklenmez.
 */
export async function readTransactionRefund(transactionId: string): Promise<PaddleRefundState | null> {
  try {
    const qs = new URLSearchParams({ transaction_id: transactionId, action: "refund", per_page: "50" });
    const body = (await paddleRequest(`/adjustments?${qs.toString()}`)) as { data?: unknown } | null;
    if (!body || !Array.isArray(body.data)) return null;
    for (const raw of body.data) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as Record<string, unknown>;
      if (a.transaction_id === transactionId && a.action === "refund" && a.status === "approved" && a.type === "full") {
        return "full_refund_approved";
      }
    }
    return "no_full_refund";
  } catch {
    return null;
  }
}
