import "server-only";
import { prisma } from "@/lib/db";
import { NEEDS_REVIEW_PREFIX } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// ÖDEME İNCELEMESİ (yalnız operatör; kurucu 10-16 ödeme S1/S2 "hatayı GÖRÜNÜR kaydet", Opus F5). İncelemeye düşen ödeme olayı
// (`WebhookEvent` `status:"error"`, `error:"needs_review: <kod>"`) yalnız veritabanında duruyordu — alarm e-postası bir kez gelir, sonra
// görünmez. Bu okuma Operasyon Teşhisi'nde listeler: olay kimliği, tür, kod, zaman ve kodun GERÇEK eylemi. Ham yük (müşteri adı / e-posta /
// tutar) TAŞINMAZ. Paddle'dan yeniden gönderim aynı veriyi getirir; yalnız "bağlanamadı" (eylemden sonra) yeniden işlemede işe yarar.
// ---------------------------------------------------------------------------

export type PaymentReviewCode = "invalid_amount" | "missing_currency" | "unlinked" | "org_deleted" | "other";

/** Kodun operatör eylemi (Türkçe, operatöre). */
export const PAYMENT_REVIEW_ACTION: Record<PaymentReviewCode, string> = {
  invalid_amount: "Tutar okunamadı, fatura yazılmadı: Paddle panelinde işlemi kontrol edip faturayı elle kaydedin.",
  missing_currency: "Para birimi yok, fatura yazılmadı: Paddle panelinde işlemi kontrol edip faturayı elle kaydedin.",
  unlinked:
    "Ödeme hiçbir işletmeye bağlanamadı: müşteriyi bulup aboneliği bağlayın (bağladıktan sonra Paddle'dan olayı yeniden gönderin) ya da iadeyi değerlendirin.",
  org_deleted: "Hesap silinmiş: Paddle'da aboneliği iptal edin, son ödemeyi iade için değerlendirin.",
  other: "Bilinmeyen inceleme kodu: olayı Paddle panelinde kontrol edin.",
};

export interface PaymentReviewRow {
  providerEventId: string | null;
  eventType: string | null;
  code: PaymentReviewCode;
  createdAt: Date;
}

function codeOf(error: string | null): PaymentReviewCode {
  const raw = (error ?? "").slice(NEEDS_REVIEW_PREFIX.length).trim();
  return raw === "invalid_amount" || raw === "missing_currency" || raw === "unlinked" || raw === "org_deleted" ? raw : "other";
}

export async function paymentReviewSummary(limit = 20): Promise<{ total: number; rows: PaymentReviewRow[] }> {
  const where = { provider: "paddle", status: "error", error: { startsWith: NEEDS_REVIEW_PREFIX } };
  const [total, rows] = await Promise.all([
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { providerEventId: true, eventType: true, error: true, createdAt: true },
    }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({ providerEventId: r.providerEventId, eventType: r.eventType, code: codeOf(r.error), createdAt: r.createdAt })),
  };
}
