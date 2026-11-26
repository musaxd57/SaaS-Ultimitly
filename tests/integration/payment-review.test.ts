import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { PAYMENT_REVIEW_ACTION, paymentReviewSummary } from "@/lib/billing/payment-review";

// Ödeme incelemesi (kurucu 10-16 ödeme S1/S2 "hatayı görünür kaydet", Opus F5): incelemeye düşen ödeme olayları operatör panelinde
// listelenir — yalnız olay kimliği / tür / kod / zaman ve kodun eylemi; ham yük (müşteri adı / e-posta) taşınmaz.

beforeEach(async () => {
  await resetDb();
});

const payload = JSON.stringify({ data: { customer: { email: "ayse@example.com", name: "Ayse" } } });
const ev = (id: string, status: string, error: string | null, provider = "paddle", createdAt = new Date()) =>
  prisma.webhookEvent.create({ data: { provider, eventType: "transaction.completed", providerEventId: id, payloadJson: payload, status, error, createdAt } });

describe("paymentReviewSummary", () => {
  it("yalnız Paddle `needs_review:` satırları; en yeni önce; kod → eylem; ham yük yok", async () => {
    await ev("evt_a", "error", "needs_review: invalid_amount", "paddle", new Date(Date.now() - 60_000));
    await ev("evt_b", "error", "needs_review: org_deleted");
    await ev("evt_c", "error", "Error: connection reset"); // gerçek hata — inceleme değil
    await ev("evt_d", "processed", null);
    await ev("evt_e", "error", "needs_review: unlinked", "iyzico");
    const r = await paymentReviewSummary();
    expect(r.total).toBe(2);
    expect(r.rows.map((x) => [x.providerEventId, x.code])).toEqual([
      ["evt_b", "org_deleted"],
      ["evt_a", "invalid_amount"],
    ]);
    expect(JSON.stringify(r)).not.toContain("ayse@example.com");
    expect(PAYMENT_REVIEW_ACTION.org_deleted).toMatch(/iptal/);
  });

  it("bilinmeyen kod 'other' olur (liste düşmez); boş tabloda toplam 0", async () => {
    expect((await paymentReviewSummary()).total).toBe(0);
    await ev("evt_x", "error", "needs_review: gelecekteki_kod");
    expect((await paymentReviewSummary()).rows[0].code).toBe("other");
  });
});
