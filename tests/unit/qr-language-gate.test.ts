import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { confidentLanguage, languageEvidence } from "@/lib/ai/language-signal";

// ---------------------------------------------------------------------------
// QR DİL KAPISI — Sabah Kararları 56 (kurucu onayı 10-02 akşam: "QR'a dil kontrolü eklenmesi mantıklı. Kısa mesaj, dil değişimi,
// özel ad ve karışık dil vakalarını sınasın; basit kelime kontrolüyle meşru cevapları engellemesin.").
//
// Ölçülen vaka (QR ölçeri, bugünkü 5.1): "Y a-t-il un fer à repasser ?" → gövdesi TÜRKÇE cevap misafire GİTTİ. Kodun dil tespiti bu
// kısa soruda emin DEĞİL (`null`) → kanalın yüklemi tek başına bu vakayı yakalamaz; QR'da modelin bildirdiği misafir dili (önce
// anlama katmanı) YEDEK girdi olur — yalnız en az iki sözcükte. Karışık dilde cevabın dili misafirin mesajında iz taşıyorsa meşrudur.
// ---------------------------------------------------------------------------

const TR_REPLY = "Evet, dairede ütü ve ütü masası bulunuyor, koridordaki dolaptadır.";
const passing = {
  intent: "amenities",
  riskLevel: "none",
  confidence: 0.92,
  source: "openai",
  riskType: null,
  reply: "The towels are in the bathroom cabinet.",
  usedSources: ["kb:amenities"],
};
const qr = (message: string, reply: string, guestLanguageHint?: string | null) =>
  evaluateEscalation({ ...passing, reply }, message, null, [], guestLanguageHint === undefined ? {} : { guestLanguageHint });
const PASS = { escalate: false, reason: null };
const HELD = { escalate: true, reason: "reply_language_mismatch" };

describe("QR dil kapısı — kısa mesaj (tek sözcükte hüküm yok)", () => {
  it.each([
    ["Wifi?", "fr"],
    ["Merci !", "fr"],
    ["Danke", "de"],
    ["Gracias", "es"],
    ["ok", "en"],
  ])("%j + Türkçe cevap (model ipucu %s) → gider: tek sözcükte dil hükmü verilmez", (msg, hint) => {
    expect(qr(msg, TR_REPLY, hint)).toEqual(PASS);
  });

  it.each(["Спасибо", "شكرا"])("%j (yazı sistemi kesin) + Türkçe cevap → tutulur", (msg) => {
    expect(qr(msg, TR_REPLY)).toEqual(HELD);
  });
});

describe("QR dil kapısı — ölçülen vaka: kodca belirsiz kısa soru + modelin bildirdiği dil", () => {
  const FR = "Y a-t-il un fer à repasser ?";
  it("kodun tespiti bu soruda emin değil (kanal yüklemi tek başına yakalamazdı)", () => {
    expect(confidentLanguage(FR)).toBeNull();
  });
  it("🚨 model 'fr' diyor + cevap Türkçe → tutulur (misafire GİTMEZ)", () => {
    expect(qr(FR, TR_REPLY, "fr")).toEqual(HELD);
  });
  it("KONTROL: aynı soruya Fransızca cevap → gider", () => {
    expect(qr(FR, "Oui, le fer et la table à repasser se trouvent dans le placard du couloir.", "fr")).toEqual(PASS);
  });
  it("model ipucu yoksa ya da desteklenmeyen dilse (other) hüküm yok → gider (belirsizlik engel değil)", () => {
    expect(qr(FR, TR_REPLY)).toEqual(PASS);
    expect(qr(FR, TR_REPLY, "other")).toEqual(PASS);
  });
  it("kod EMİNKEN model ipucu kullanılmaz: Türkçe soru + Türkçe cevap, ipucu 'en' → gider", () => {
    expect(qr("Merhaba, otopark var mı?", "Merhaba, binanın arkasında ücretsiz otopark var.", "en")).toEqual(PASS);
  });
});

describe("QR dil kapısı — dil değişimi (güncel mesaj karar verir)", () => {
  const EN = "Thanks! What time is checkout tomorrow?";
  it("İngilizce soru + Almanca cevap → tutulur", () => {
    expect(qr(EN, "Der Check-out ist morgen um 11:00 Uhr.")).toEqual(HELD);
  });
  it("İngilizce soru + İngilizce cevap → gider", () => {
    expect(qr(EN, "Check-out is at 11:00 tomorrow.")).toEqual(PASS);
  });
  it("Almanca soru + İngilizce cevap → tutulur; Almanca cevap → gider", () => {
    expect(qr("Wo finde ich die Handtücher?", "The towels are in the bathroom cabinet.")).toEqual(HELD);
    expect(qr("Wo finde ich die Handtücher?", "Die Handtücher sind im Badezimmerschrank.")).toEqual(PASS);
  });
});

describe("QR dil kapısı — özel adlar (Türkçe yer / işletme adı taşıyan doğru dilde cevap)", () => {
  it.each([
    ["Where is the nearest pharmacy?", "The nearest pharmacy is Lavanta Eczanesi on Liman Caddesi, about 200 m from the building."],
    ["How do we get to the palace?", "Take the tram to Kabataş and walk to Dolmabahçe Sarayı, it takes about ten minutes."],
    ["Bonjour, quelle est l'adresse exacte de l'appartement ?", "Bonjour, l'adresse est : Caferağa Mah. Moda Cad. No 12, Kadıköy."],
  ])("%j → gider", (msg, reply) => {
    expect(qr(msg, reply)).toEqual(PASS);
  });
});

describe("QR dil kapısı — karışık dil (cevabın dili mesajda iz taşıyorsa meşru)", () => {
  it("'Hi! Wifi şifresi ne acaba?' → İngilizce cevap da Türkçe cevap da gider", () => {
    expect(languageEvidence("Hi! Wifi şifresi ne acaba?").has("en")).toBe(true);
    expect(qr("Hi! Wifi şifresi ne acaba?", "The Wi-Fi network is Lale-5G and the password is Lale2025.")).toEqual(PASS);
    expect(qr("Hi! Wifi şifresi ne acaba?", "Wi-Fi ağ adı Lale-5G, şifre Lale2025.")).toEqual(PASS);
  });
  it("'Can we park? Danke!' → Almanca cevap da gider", () => {
    expect(qr("Can we park? Danke!", "Ja, hinter dem Gebäude gibt es kostenlose Parkplätze.")).toEqual(PASS);
  });
  it("İKİZ: iz taşımayan dil yine tutulur — 'Merhaba, otopark var mı?' + İngilizce cevap", () => {
    expect(qr("Merhaba, otopark var mı?", "Hello, there is free parking behind the building.")).toEqual(HELD);
  });
});

describe("QR dil kapısı — sıra: güvenlik gerekçesi dil gerekçesini gölgelemez", () => {
  it("şikâyet + yanlış dil → gerekçe şikâyet tarafı, dil değil", () => {
    const v = evaluateEscalation(
      { ...passing, reply: TR_REPLY, riskLevel: "high", riskType: "complaint" },
      "The AC is broken and the room is filthy, I want a refund",
      null,
      [],
      {},
    );
    expect(v.escalate).toBe(true);
    expect(v.reason).not.toBe("reply_language_mismatch");
  });
  it("düşük güven + yanlış dil → low_confidence", () => {
    expect(evaluateEscalation({ ...passing, reply: TR_REPLY, confidence: 0.5 }, "Where are the towels please?", null, [], {}).reason).toBe(
      "low_confidence",
    );
  });
});
