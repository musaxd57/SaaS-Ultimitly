import { describe, it, expect } from "vitest";
import { BILLING_TEXT, billingReason, lapsedLabel } from "@/lib/billing/billing-ui-text";

// ---------------------------------------------------------------------------
// ÖDEME EKRANI METİNLERİ (kurucu K3, 10-17). Envanterdeki kusurlar (C1 / A5 / A7 / S2): `badRequest` gövdesi `{ error: "Doğrulama hatası",
// fields: { error } }` — yalnız `data.error` okunduğunda müşteri her retde "Doğrulama hatası" görüyordu; 429 ve "abonelik bulunamadı"
// tek genel metne düşüyordu. `billingReason` sunucunun SEBEBİNİ seçer.
// ---------------------------------------------------------------------------

describe("billingReason", () => {
  it("🚨 C1: badRequest gövdesinde sebep `fields.error` altında — 'Doğrulama hatası' GÖSTERİLMEZ", () => {
    const body = { error: "Doğrulama hatası", fields: { error: "Zaten bu plandasınız." } };
    expect(billingReason(body, BILLING_TEXT.changeFailed)).toBe("Zaten bu plandasınız."); // ⬅️ ESKİDE "Doğrulama hatası"
  });

  it("onay kaydı alanları: `_`, `planCode`, `priceId` (eski fiyat kimliği → sade metin)", () => {
    expect(billingReason({ error: "Doğrulama hatası", fields: { _: "Bu işletmenin zaten aktif bir aboneliği var." } }, "x")).toBe(
      "Bu işletmenin zaten aktif bir aboneliği var.",
    );
    expect(billingReason({ error: "Doğrulama hatası", fields: { planCode: "Plan gerekli" } }, "x")).toBe("Plan gerekli");
    expect(billingReason({ error: "Doğrulama hatası", fields: { priceId: "Fiyat gerekli" } }, "x")).toBe(BILLING_TEXT.priceStale);
  });

  it("alan yoksa sunucu metni (429, 409, 503, takip numaralı 500); genel başlık tek başına sebep sayılmaz", () => {
    expect(billingReason({ error: "Çok fazla istek gönderildi. Lütfen kısa bir süre bekleyip tekrar deneyin." }, "x")).toMatch(/Çok fazla istek/);
    expect(billingReason({ error: "Doğrulama hatası" }, "yedek")).toBe("yedek");
    expect(billingReason({ error: "Doğrulama hatası", fields: {} }, "yedek")).toBe("yedek");
  });

  it("boş / bozuk gövde → çağıranın yedek metni (tür dışı alanlar yok sayılır)", () => {
    expect(billingReason(null, "yedek")).toBe("yedek");
    expect(billingReason(undefined, "yedek")).toBe("yedek");
    expect(billingReason({ error: 42, fields: { error: { x: 1 } as unknown as string } }, "yedek")).toBe("yedek");
    expect(billingReason({ error: "  ", fields: { error: " " } }, "yedek")).toBe("yedek");
  });
});

describe("lapsedLabel (sınırlı mod bandıyla aynı dil)", () => {
  it.each([
    ["past_due", "son ödemeniz alınamadı"],
    ["paused", "aboneliğiniz duraklatıldı"],
    ["canceled", "aboneliğiniz iptal edildi"],
    ["trialing", "aboneliğiniz aktif değil"],
    [null, "aboneliğiniz aktif değil"],
  ])("%s → %s", (status, label) => {
    expect(lapsedLabel(status)).toBe(label);
  });
});

describe("metin kuralları (müşteriye giden metin sade — CLAUDE.md)", () => {
  it("teknik terim / sağlayıcı kodu / 'sen' dili yok; para işinde planın değişmediği söylenir", () => {
    for (const text of Object.values(BILLING_TEXT)) {
      expect(text).not.toMatch(/HTTP|env=|Merchant|önizleme|token|webhook|Paddle\.js|\bsen\b/i);
    }
    expect(BILLING_TEXT.changeFailed).toContain("planınız değişmedi");
  });
});
