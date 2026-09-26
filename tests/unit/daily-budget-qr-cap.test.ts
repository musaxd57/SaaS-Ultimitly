import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/billing/plan-limits", () => ({
  limitsForOrg: async () => ({ aiCallsPerDay: 150 }),
}));

import { consumeDailyAiBudgetForQr, dailyBudgetMessage } from "@/lib/ai/daily-budget";

// ---------------------------------------------------------------------------
// §E — QR BÜTÇE VERDICT'İ HANGİ TAVANI BİLDİRİYOR? (denetim turu 09-12)
//
// QR iki kovadan geçer: ① QR'ın kendi payı (org tavanının %30'u) ② org'un ORTAK
// tavanı. `cap` alanı HER İKİ RET'te de ① paydan dönüyordu — yani ORTAK tavan
// dolduğunda bile "planınız günde 45" deniyordu, oysa dolan kova 150'lik olandı.
//
// ⚠️ DÜRÜSTLÜK — BU BUGÜN CANLI BİR KUSUR DEĞİL: QR rotası `dailyBudgetMessage`i
// HİÇ ÇAĞIRMIYOR (`chat/[token]/route.ts:573` yalnız `ok`/`retryAfter` okur;
// misafire deterministik devir metni gider). Yani yanlış sayı hiçbir ekrana
// BASILMIYOR. Düzeltilen şey LATENT bir tuzak: bu verdict'i `dailyBudgetMessage`e
// veren ilk çağıran (yapılacak en doğal şey) host'a YANLIŞ plan rakamı gösterirdi.
//
// 🚨 Ajan raporu bunu "müşteriye gösterilen tavan uyuşmuyor" diye yazmıştı —
// KODDA DOĞRULANDI ve YANLIŞ çıktı; iddia burada dürüstleştirildi.
// ---------------------------------------------------------------------------

beforeEach(() => rateLimit.mockReset());
afterEach(() => vi.restoreAllMocks());

const ORG = "org-1";
const QR_SHARE = 45; // 150 × %30

describe("§E — QR bütçe verdict'i DOLAN kovanın tavanını bildirir", () => {
  it("🚨 ORTAK tavan dolduğunda ORG tavanı bildirilir (eskiden QR payı diyordu)", async () => {
    rateLimit
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 }) // ① QR payı geçti
      .mockResolvedValueOnce({ ok: false, retryAfter: 3600 }); // ② ortak tavan doldu
    const v = await consumeDailyAiBudgetForQr(ORG);
    expect(v.ok).toBe(false);
    expect(v.cap).toBe(150);
    // Metin artık gerçeği söylüyor.
    expect(dailyBudgetMessage(v)).toContain("150");
  });

  it("QR'ın KENDİ payı dolduğunda PAY bildirilir (davranış aynen korunur)", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false, retryAfter: 60 });
    const v = await consumeDailyAiBudgetForQr(ORG);
    expect(v.ok).toBe(false);
    expect(v.cap).toBe(QR_SHARE);
    // 🚨 Erken dönüş: ortak sayaca DOKUNULMAZ (taşan QR inbox'ın hakkını yemez).
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it("başarı yolunda da DOLMAYA EN YAKIN olan değil, org tavanı doğru kalır", async () => {
    rateLimit
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 })
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 });
    const v = await consumeDailyAiBudgetForQr(ORG);
    expect(v.ok).toBe(true);
    // Başarıda `cap` hiçbir mesaja girmiyor; yine de PAY bildirilir — QR'ın
    // kendi bütçesi odur ve "ne kadar hakkım kaldı" sorusunun doğru cevabı budur.
    expect(v.cap).toBe(QR_SHARE);
    expect(rateLimit).toHaveBeenCalledTimes(2);
  });

  it("🚨 SIRA KORUNUR: önce QR payı, sonra ortak tavan", async () => {
    rateLimit
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 })
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 });
    await consumeDailyAiBudgetForQr(ORG);
    expect(rateLimit.mock.calls[0][0]).toBe(`ai-daily-qr:${ORG}`);
    expect(rateLimit.mock.calls[0][1]).toBe(QR_SHARE);
    expect(rateLimit.mock.calls[1][0]).toBe(`ai-daily:${ORG}`);
    expect(rateLimit.mock.calls[1][1]).toBe(150);
  });
});
