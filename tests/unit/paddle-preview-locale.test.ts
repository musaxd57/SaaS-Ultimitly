import { describe, it, expect, afterEach, vi } from "vitest";

import { previewSubscriptionUpdate } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// ÖDEME ÖNİZLEMESİ LOCALE'İ.
//
// Plan değişikliği onay kutusundaki tutar iki kaynaktan gelebilir:
//   • Paddle yanıt verdiyse  → previewSubscriptionUpdate'in biçimlendirdiği metin
//   • Paddle yanıt vermediyse → istemcinin formatMinor(..., locale) fallback'i
//
// Fallback deployment locale'ini kullanıyordu, sunucu tarafı ise "tr-TR"e SABİTTİ.
// Yani aynı diyalogda aynı tutar iki farklı biçimde çıkabiliyordu ve .eu'da
// Türkçe biçimlendirme görünüyordu. Para birimi zaten Paddle'ın kendi
// yanıtından geliyor (o DOĞRU davranış, dokunulmadı) — burada düzeltilen yalnız
// BİÇİM: gruplama ve sembol yeri.
// ---------------------------------------------------------------------------

const OK_RESPONSE = {
  data: {
    currency_code: "EUR",
    immediate_transaction: { details: { totals: { grand_total: "3900", currency_code: "EUR" } } },
    recurring_transaction_details: { totals: { grand_total: "7900", currency_code: "EUR" } },
  },
};

function mockPaddleOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(OK_RESPONSE), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("previewSubscriptionUpdate — tutarı deployment locale'iyle biçimlendirir", () => {
  it("APP_LOCALE=de-DE ise Alman biçimi kullanılır (tr-TR'ye SABİTLENMEZ)", async () => {
    vi.stubEnv("PADDLE_API_KEY", "pdl_test_key");
    vi.stubEnv("APP_LOCALE", "de-DE");
    mockPaddleOk();

    const preview = await previewSubscriptionUpdate("sub_1", "pri_1", "prorated_immediately");

    expect(preview).not.toBeNull();
    // de-DE: sembol SONDA ("39,00 €"). tr-TR olsaydı başta olurdu ("€39,00").
    expect(preview!.immediateTotal).toMatch(/€\s*$/);
    expect(preview!.recurringTotal).toMatch(/€\s*$/);
    // Sayı aynı kalır — biçim değişti, tutar DEĞİL.
    expect(preview!.immediateTotal!.replace(/[^\d]/g, "")).toBe("3900");
  });

  it(".com REGRESYONU: APP_LOCALE verilmezse çıktı bugünkü tr-TR biçiminin AYNISI", async () => {
    vi.stubEnv("PADDLE_API_KEY", "pdl_test_key");
    mockPaddleOk();

    const preview = await previewSubscriptionUpdate("sub_1", "pri_1", "prorated_immediately");

    expect(preview).not.toBeNull();
    // tr-TR: sembol BAŞTA.
    expect(preview!.immediateTotal).toBe(
      new Intl.NumberFormat("tr-TR", { style: "currency", currency: "EUR" }).format(39),
    );
  });

  it("Paddle para birimi bildirmezse de locale yine deployment'tan gelir", async () => {
    vi.stubEnv("PADDLE_API_KEY", "pdl_test_key");
    vi.stubEnv("APP_LOCALE", "de-DE");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { immediate_transaction: { details: { totals: { grand_total: "123456" } } } },
            }),
            { status: 200 },
          ),
      ),
    );

    const preview = await previewSubscriptionUpdate("sub_1", "pri_1", "prorated_immediately");

    expect(preview).not.toBeNull();
    // Para birimi yok → çıplak sayı, ama yine de de-DE gruplamasıyla (1.234,56).
    expect(preview!.immediateTotal).toBe((1234.56).toLocaleString("de-DE"));
  });
});
