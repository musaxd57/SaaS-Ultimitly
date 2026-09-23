import { describe, it, expect } from "vitest";
import {
  providerErrorMessage,
  providerErrorMessageFromText,
  providerErrorStatus,
  isChannelSubscriptionInactive,
} from "@/lib/provider-errors";
import { isDefinitiveSendFailure } from "@/lib/messaging";
import { HospitableError } from "@/lib/hospitable";
import { IngestError } from "@/lib/channels/ingest";

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

// ---------------------------------------------------------------------------
// 🚨 SARMALDAN BAĞIMSIZ (09-23 olayı). V0.6 ingest adaptörü `HospitableError`ı
// `IngestError`a sarıyor; bu fonksiyon yalnız `err.name === "HospitableError"`a
// baktığı için elle senkron düğmesi 09-08'den beri 402'de "aboneliğinizi yenileyin"
// yerine JENERİK yedeği gösteriyordu — host ne yapacağını bilemiyordu. Aynı durum,
// hangi sarmalda gelirse gelsin, AYNI cümleyi almalı.
// ---------------------------------------------------------------------------
describe("sarmaldan bağımsız: ingest adaptörünün IngestError'ı da AYNI metni alır", () => {
  it.each([
    [402, "blocked", /aboneliğiniz aktif değil/i],
    [401, "auth_revoked", /yeniden bağlayın/i],
    [403, "auth_revoked", /yeniden bağlayın/i],
    [404, "not_found", /bulunamadı/i],
    [429, "rate_limited", /istek sınırına ulaşıldı/i],
    [503, "outage", /yanıt vermiyor/i],
  ] as const)("IngestError HTTP %i (%s) → HospitableError ile AYNI cümle", (status, kind, beklenen) => {
    const wrapped = new IngestError("hospitable", kind, `hospitable ingest ${kind} (HTTP ${status})`, status);
    const raw = new HospitableError(`Hospitable API hatası (HTTP ${status}): {"message":"x"}`, status);
    const m = providerErrorMessage(wrapped, "yedek");
    expect(m).toMatch(beklenen);
    expect(m, "iki sarmal ayrıştı").toBe(providerErrorMessage(raw, "yedek"));
    expect(m, "ham ayrıntı sızdı").not.toMatch(YASAK);
  });

  it("IngestError 429 Retry-After süresi de metne girer", () => {
    const e = new IngestError("hospitable", "rate_limited", "hospitable ingest rate_limited (HTTP 429)", 429, 300);
    expect(providerErrorMessage(e, "yedek")).toMatch(/5 dakika/);
  });

  it("statüsüz IngestError (ağ) → ulaşılamıyor", () => {
    const e = new IngestError("hospitable", "outage", "hospitable ingest outage");
    expect(providerErrorMessage(e, "yedek")).toMatch(/ulaşılamıyor/i);
  });

  it("statüsüz `unknown` (adaptör HospitableError OLMAYAN bir hatayı sardı) → çağıranın yedeği; Hospitable SUÇLANMAZ", () => {
    // Ör. bizim normalizasyon kodumuzda bir TypeError: sağlayıcıya ulaşıldığı bile kanıtsız.
    const e = new IngestError("hospitable", "unknown", "hospitable ingest unknown error");
    expect(providerErrorMessage(e, "Yedek.")).toBe("Yedek.");
  });

  it("statülü ama tanınmayan kod (418) → ham HospitableError ile AYNI cümle (parite)", () => {
    const wrapped = new IngestError("hospitable", "unknown", "hospitable ingest unknown (HTTP 418)", 418);
    expect(providerErrorMessage(wrapped, "yedek")).toBe(providerErrorMessage(new HospitableError("x", 418), "yedek"));
    expect(providerErrorMessage(wrapped, "yedek")).toMatch(/ulaşılamıyor/i);
  });

  it("no_credential → 'bağlı değil' (ulaşılamıyor DEĞİL: ağa hiç çıkılmadı, sorun bağlantının yokluğu)", () => {
    const e = new IngestError("hospitable", "no_credential", "kimlik bilgisi yok — ağa çıkılmadı");
    const m = providerErrorMessage(e, "yedek");
    expect(m).toMatch(/bağlı değil/i);
    expect(m).not.toMatch(/ulaşılamıyor/i);
  });
});

describe("providerErrorStatus / isChannelSubscriptionInactive — tek kaynak", () => {
  it("iki sarmaldan da durumu okur", () => {
    expect(providerErrorStatus(new HospitableError("x", 402))).toBe(402);
    expect(providerErrorStatus(new IngestError("hospitable", "blocked", "x", 402))).toBe(402);
    expect(providerErrorStatus(new IngestError("hospitable", "outage", "x"))).toBeUndefined();
  });

  it("🚨 ÖRDEK TİPLEMESİ YOK: `status` taşıyan HER hata sağlayıcı hatası DEĞİLDİR", () => {
    // OpenAI SDK hataları da `status` taşır ve 402 = kota. O, "Hospitable aboneliği
    // pasif" DEĞİLDİR; bu yüklem onu tanırsa gerçek bir arıza sessizce susturulur.
    const openAiLike = Object.assign(new Error("insufficient_quota"), { name: "APIError", status: 402 });
    expect(providerErrorStatus(openAiLike)).toBeUndefined();
    expect(isChannelSubscriptionInactive(openAiLike)).toBe(false);
    expect(providerErrorStatus({ status: 402 })).toBeUndefined();
    expect(providerErrorStatus(null)).toBeUndefined();
  });

  it("abonelik pasif: ham 402 ve ingest `blocked` — başka HİÇBİR şey", () => {
    expect(isChannelSubscriptionInactive(new HospitableError("x", 402))).toBe(true);
    expect(isChannelSubscriptionInactive(new IngestError("hospitable", "blocked", "x", 402))).toBe(true);
    expect(isChannelSubscriptionInactive(new HospitableError("x", 401))).toBe(false);
    expect(isChannelSubscriptionInactive(new IngestError("hospitable", "auth_revoked", "x", 401))).toBe(false);
    expect(isChannelSubscriptionInactive(new IngestError("hospitable", "unknown", "x"))).toBe(false);
    expect(isChannelSubscriptionInactive(new Error("boom"))).toBe(false);
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
