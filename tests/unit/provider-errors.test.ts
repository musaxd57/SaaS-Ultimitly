import { describe, it, expect } from "vitest";
import { providerErrorMessage, providerErrorMessageFromText } from "@/lib/provider-errors";
import { isDefinitiveSendFailure } from "@/lib/messaging";
import { HospitableError } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// HAM SAĞLAYICI HATASI MÜŞTERİYE GİTMEZ (denetim, 08-06)
//
// 🚨 KAPATILAN SIZINTI: altı Hospitable rotası + elle yanıt yolu `err.message`'ı
// DOĞRUDAN müşteriye döndürüyordu ve o metin şöyle kuruluyor (`hospitable.ts`):
//     `Hospitable API hatası (HTTP ${status}): ${body.slice(0, 200)}`
// Host'un Gelen Kutusu'nda görülebilen gerçek metin:
//     «Mesaj gönderilemedi: Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}»
// Ham İngilizce sağlayıcı JSON'u + HTTP kodu. Lale bugün 402 → CANLIDA görülebilir.
// ---------------------------------------------------------------------------

const YASAK = /HTTP \d{3}|Subscription not active|\{|\}|env=|resource=/;

describe("sağlayıcı hatası → müşteri metni", () => {
  it.each([
    [402, /aboneliğiniz aktif değil/i],
    [401, /yeniden bağlayın/i],
    [403, /yeniden bağlayın/i],
    [404, /bulunamadı/i],
    [429, /istek sınırına ulaşıldı/i],
    [500, /yanıt vermiyor/i],
    [503, /yanıt vermiyor/i],
  ])("HTTP %i → duruma özel Türkçe cümle", (status, beklenen) => {
    const err = new HospitableError(`Hospitable API hatası (HTTP ${status}): {"message":"Subscription not active"}`, status);
    const m = providerErrorMessage(err, "yedek");
    expect(m).toMatch(beklenen);
    expect(m, "ham sağlayıcı ayrıntısı sızdı").not.toMatch(YASAK);
  });

  it("statüsüz HospitableError (ağa çıkılamadı) → ulaşılamıyor metni", () => {
    const m = providerErrorMessage(new HospitableError("Hospitable'a ulaşılamadı: fetch failed"), "yedek");
    expect(m).toMatch(/ulaşılamıyor/i);
    expect(m).not.toContain("fetch failed");
  });

  it("TANIMADIĞIMIZ hata → çağıranın yedeği (err.message'a ASLA düşmez)", () => {
    // Prisma/Node/OpenAI hataları iç tablo adı, dosya yolu, model adı taşır.
    const err = new Error("PrismaClientKnownRequestError: Invalid `prisma.user.findMany()` invocation");
    expect(providerErrorMessage(err, "Yedek cümle.")).toBe("Yedek cümle.");
  });

  it("Error OLMAYAN girdi → yedek", () => {
    expect(providerErrorMessage("düz string", "Yedek.")).toBe("Yedek.");
    expect(providerErrorMessage(null, "Yedek.")).toBe("Yedek.");
  });

  it("429'da Retry-After varsa süre METNE girer", () => {
    const err = new HospitableError("Hospitable API hatası (HTTP 429)", 429, 300);
    expect(providerErrorMessage(err, "yedek")).toMatch(/5 dakika/);
  });
});

describe("metin girdili çeviri (SendOutcome.error yolu)", () => {
  it("ham metinden durumu okur ve Türkçeleştirir", () => {
    const ham = 'Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}';
    const m = providerErrorMessageFromText(ham, "yedek");
    expect(m).toMatch(/aboneliğiniz aktif değil/i);
    expect(m).not.toMatch(YASAK);
  });

  it("durum çıkarılamazsa yedek kullanılır", () => {
    expect(providerErrorMessageFromText("network error", "Yedek.")).toBe("Yedek.");
    expect(providerErrorMessageFromText(null, "Yedek.")).toBe("Yedek.");
  });

  it("🚨 İÇ METİN DEĞİŞMEDİ — isDefinitiveSendFailure hâlâ ayrıştırabiliyor", () => {
    // `messaging.ts` claim'i geri alıp almamaya bu string'i /HTTP (4\d\d)/ ile
    // okuyarak karar veriyor. Çeviri YALNIZ gösterim içindir; üreten yere
    // dokunulmadı. Bu test o sözleşmeyi pinler — biri "ham metni de
    // Türkçeleştirelim" derse claim mantığı SESSİZCE bozulurdu.
    expect(isDefinitiveSendFailure('Hospitable API hatası (HTTP 422): {"e":1}')).toBe(true);
    expect(isDefinitiveSendFailure("Hospitable API hatası (HTTP 500)")).toBe(false);
    expect(isDefinitiveSendFailure("Hospitable API hatası (HTTP 408)")).toBe(false);
  });
});
