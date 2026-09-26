import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyPaddleSignature,
  paddlePriceToPlanCode,
  paddlePriceCatalogConfigured,
  paddleStatusToLocal,
} from "@/lib/payments/paddle";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";

/** Build a valid Paddle-Signature header for a body at time `ts`. */
function sign(body: string, ts: number, secret = SECRET): string {
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("verifyPaddleSignature", () => {
  const now = 1_700_000_000;
  const body = JSON.stringify({ event_id: "evt_1", event_type: "subscription.activated" });

  it("accepts a correctly signed, fresh request", () => {
    const header = sign(body, now);
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: body, secret: SECRET, now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = sign(body, now);
    expect(
      verifyPaddleSignature({ signatureHeader: header, rawBody: body + " ", secret: SECRET, now }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const header = sign(body, now, "test-webhook-hmac-key-wrong");
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: body, secret: SECRET, now })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const header = sign(body, now - 3600); // 1h old
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: body, secret: SECRET, now })).toBe(false);
  });

  it("rejects malformed / missing headers", () => {
    expect(verifyPaddleSignature({ signatureHeader: null, rawBody: body, secret: SECRET, now })).toBe(false);
    expect(verifyPaddleSignature({ signatureHeader: "", rawBody: body, secret: SECRET, now })).toBe(false);
    expect(verifyPaddleSignature({ signatureHeader: "h1=abc", rawBody: body, secret: SECRET, now })).toBe(false);
    expect(verifyPaddleSignature({ signatureHeader: `ts=${now}`, rawBody: body, secret: SECRET, now })).toBe(false);
  });

  it("accepts when one of several h1 values matches (key rotation)", () => {
    const h1 = createHmac("sha256", SECRET).update(`${now}:${body}`, "utf8").digest("hex");
    const header = `ts=${now};h1=deadbeef;h1=${h1}`;
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: body, secret: SECRET, now })).toBe(true);
  });
});

describe("paddlePriceToPlanCode", () => {
  afterEach(() => {
    // vi.stubEnv (not a raw delete): unstub RESTORES any .env-provided value —
    // a raw `delete` would wipe it and leak "unconfigured" into later test files
    // (the exact cross-file flake paddle-portal.test.ts documents).
    vi.unstubAllEnvs();
  });

  it("maps configured price ids to plan codes; unknown → null", () => {
    vi.stubEnv("PADDLE_PRICE_BASLANGIC", "pri_baslangic");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    expect(paddlePriceToPlanCode("pri_baslangic")).toBe("free");
    expect(paddlePriceToPlanCode("pri_pro")).toBe("pro");
    expect(paddlePriceToPlanCode("pri_isletme")).toBe("business");
    expect(paddlePriceToPlanCode("pri_unknown")).toBeNull();
    expect(paddlePriceToPlanCode(null)).toBeNull();
  });

  it("YILLIK fiyat id'leri AYNI plan koduna eşlenir (ayrı kod ÜRETİLMEZ)", () => {
    // 🚨 Plan kodu bir YETKİ seviyesidir, fatura dönemi DEĞİL. `getEntitlement`,
    // `limitsForOrg`, `canAddProperty`, deneme mantığı ve `past_due` grace'i
    // hep bu koda bakıyor → yıllık Pro, aylık Pro ile AYNI ürünü kullanır.
    // Ayrı bir "pro_yillik" kodu bu beş yeri birden bilinmeyen-plan dalına
    // düşürürdü; dönem yalnız Paddle'ın kendi kayıtlarında yaşar ve para akışı
    // ham `priceId`'ye bağlanır.
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro_ay");
    vi.stubEnv("PADDLE_PRICE_PRO_YILLIK", "pri_pro_yil");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC_YILLIK", "pri_bas_yil");
    vi.stubEnv("PADDLE_PRICE_ISLETME_YILLIK", "pri_is_yil");
    expect(paddlePriceToPlanCode("pri_pro_ay")).toBe("pro");
    expect(paddlePriceToPlanCode("pri_pro_yil")).toBe("pro");
    expect(paddlePriceToPlanCode("pri_bas_yil")).toBe("free");
    expect(paddlePriceToPlanCode("pri_is_yil")).toBe("business");
  });

  it("yıllık env'leri YOKKEN davranış BİREBİR eski (katkısal değişiklik)", () => {
    // Bugünkü üretim durumu: yıllık henüz Paddle'da açılmadı. Bu test, eklemenin
    // mevcut hiçbir yolu değiştirmediğini pinler — geri alma yolu env'i silmektir.
    vi.stubEnv("PADDLE_PRICE_BASLANGIC", "pri_baslangic");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    expect(paddlePriceToPlanCode("pri_pro")).toBe("pro");
    expect(paddlePriceToPlanCode("pri_pro_yil")).toBeNull();
    expect(paddlePriceCatalogConfigured()).toBe(true);
  });

  it("YALNIZCA yıllık id'ler set edilmişse katalog yine YAPILANDIRILMIŞ sayılır", () => {
    // Kısmi yapılandırma tuzağı: katalog kapısı (`!derivedPlanCode &&
    // paddlePriceCatalogConfigured()`) "en az bir id var mı" diye soruyor.
    // Yıllık id'ler de sayılmazsa, yalnız yıllık satan bir kurulumda kapı
    // sessizce PASİFLEŞİR ve katalog dışı fiyat yine geçer.
    vi.stubEnv("PADDLE_PRICE_PRO_YILLIK", "pri_pro_yil");
    expect(paddlePriceCatalogConfigured()).toBe(true);
    expect(paddlePriceToPlanCode("pri_pro_yil")).toBe("pro");
  });
});

describe("paddleStatusToLocal", () => {
  it("maps Paddle statuses into the local vocabulary", () => {
    expect(paddleStatusToLocal("active")).toBe("active");
    expect(paddleStatusToLocal("trialing")).toBe("trialing");
    expect(paddleStatusToLocal("past_due")).toBe("past_due");
    expect(paddleStatusToLocal("paused")).toBe("past_due"); // inactive, not in ACTIVE_STATUSES
    expect(paddleStatusToLocal("canceled")).toBe("canceled");
  });
});
