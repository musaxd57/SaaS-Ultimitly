import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// "Ödeme alındı, abonelik bekleniyor" (Codex 11-17) — saf parçalar: (1) engel metninin seçimi (ödemenin yaşı), (2) Paddle işlem yanıtından
// yalnız türü doğru alanların alınması (biçimsiz alan boş sayılır — karar uydurma veriyle verilmez).
// ---------------------------------------------------------------------------

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/payments/paddle", () => ({ paddleRequest: request }));

import {
  CHECKOUT_PAID_AWAITING_MESSAGE,
  CHECKOUT_PENDING_MESSAGE,
  CHECKOUT_PENDING_MS,
  checkoutBlockMessage,
} from "@/lib/billing/checkout-pending-shared";
import { PADDLE_TXN_NOT_FOUND, paddleTransactionStatus, readPaddleTransaction } from "@/lib/billing/paddle-transaction-status";

describe("engel metni — ödemenin yaşına göre", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("kilit süresi dolmadan 'işleniyor'; dolduğu andan itibaren 'alındı, henüz tanımlanmadı'", () => {
    expect(checkoutBlockMessage(ago(0), now)).toBe(CHECKOUT_PENDING_MESSAGE);
    expect(checkoutBlockMessage(ago(CHECKOUT_PENDING_MS - 1), now)).toBe(CHECKOUT_PENDING_MESSAGE);
    expect(checkoutBlockMessage(ago(CHECKOUT_PENDING_MS), now)).toBe(CHECKOUT_PAID_AWAITING_MESSAGE);
    expect(checkoutBlockMessage(ago(3 * 24 * 60 * 60_000), now)).toBe(CHECKOUT_PAID_AWAITING_MESSAGE);
  });

  it("uzun bekleme metni yeniden ödeme YAPILMAMASINI söyler ve 'birkaç dakika' sözü vermez", () => {
    expect(CHECKOUT_PAID_AWAITING_MESSAGE).toMatch(/yeniden ödeme yapmayın/);
    expect(CHECKOUT_PAID_AWAITING_MESSAGE).not.toMatch(/birkaç dakika/);
  });
});

describe("Paddle işlem olguları — tek okuma noktası", () => {
  // Gövde süslü: ok işlevi sahte işlevin KENDİSİNİ döndürürse test çatısı onu temizlik sanıp test sonunda çağırır (son taklit reddediyorsa
  // test o hatayla düşer).
  beforeEach(() => {
    request.mockReset();
  });

  it("tam yanıt: durum, abonelik, onay kimliği, köken", async () => {
    request.mockResolvedValue({ data: { status: "completed", subscription_id: "sub_1", custom_data: { consentId: "c123" }, origin: "web" } });
    expect(await readPaddleTransaction("txn_1")).toEqual({ status: "completed", subscriptionId: "sub_1", consentId: "c123", origin: "web" });
    expect(request).toHaveBeenCalledWith("/transactions/txn_1");
  });

  it.each([
    ["alanlar yok", { data: { status: "paid" } }, { status: "paid", subscriptionId: null, consentId: null, origin: null }],
    ["abonelik boş metin / null", { data: { status: "paid", subscription_id: "" } }, { status: "paid", subscriptionId: null, consentId: null, origin: null }],
    ["türü yanlış alanlar", { data: { status: 5, subscription_id: 7, custom_data: "x", origin: {} } }, { status: null, subscriptionId: null, consentId: null, origin: null }],
    ["onay kimliği metin değil", { data: { status: "paid", custom_data: { consentId: 9 } } }, { status: "paid", subscriptionId: null, consentId: null, origin: null }],
    ["aşırı uzun onay kimliği", { data: { status: "paid", custom_data: { consentId: "c".repeat(65) } } }, { status: "paid", subscriptionId: null, consentId: null, origin: null }],
  ])("%s → yalnız türü doğru alan alınır", async (_label, body, expected) => {
    request.mockResolvedValue(body);
    expect(await readPaddleTransaction("txn_1")).toEqual(expected);
  });

  it("gövde yok / veri nesne değil → null (karar verilmez); 404 → bulunamadı; öteki hata → null", async () => {
    request.mockResolvedValue(null);
    expect(await readPaddleTransaction("txn_1")).toBeNull();
    request.mockResolvedValue({ data: "x" });
    expect(await readPaddleTransaction("txn_1")).toBeNull();
    request.mockRejectedValue(new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=transactions"));
    expect(await readPaddleTransaction("txn_1")).toBe(PADDLE_TXN_NOT_FOUND);
    request.mockRejectedValue(new Error("Paddle HTTP 500 (internal) env=sandbox resource=transactions"));
    expect(await readPaddleTransaction("txn_1")).toBeNull();
  });

  it("durum okuması aynı kaynaktan: durum metni · bulunamadı · okunamadı", async () => {
    request.mockResolvedValue({ data: { status: "ready" } });
    expect(await paddleTransactionStatus("txn_1")).toBe("ready");
    request.mockRejectedValue(new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=transactions"));
    expect(await paddleTransactionStatus("txn_1")).toBe(PADDLE_TXN_NOT_FOUND);
    request.mockRejectedValue(new Error("ağ"));
    expect(await paddleTransactionStatus("txn_1")).toBeNull();
    request.mockResolvedValue({ data: {} });
    expect(await paddleTransactionStatus("txn_1")).toBeNull();
  });
});
