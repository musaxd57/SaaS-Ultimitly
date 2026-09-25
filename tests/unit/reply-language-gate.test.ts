import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { autoReplyGateFailure, passesAutoReplySafetyGate } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { buildReplyUserPrompt } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// MİSAFİRİN DİLİNDE CEVAP (09-25, kurucu: "5.1'in zayıf noktasını düzelt"). Ölçüldü (cevap kıyası, 135 senaryo):
// gpt-5.1 İngilizce yazan misafirlerin 7/59'una TÜRKÇE cevap verdi; biri ("Got it. And the wifi password again?")
// kapıdan geçip OTOMATİK gidiyordu. İki katman: (1) istem misafirin dilini KODLA tespit edip açıkça söyler; (2) kanal
// kapısı dili EMİNCE farklı cevabı göndermez (`reply_language_mismatch`) — taslak ev sahibine kalır.
// ---------------------------------------------------------------------------

const EN_GUEST = "Got it. And the wifi password again? Lost my note";
const TR_REPLY = "Wi-Fi ağ adı Lale-5G, şifre Lale2025. Yatak odasında sinyal zayıf olursa aynı şifreyle Lale-2G ağına bağlanabilirsiniz.";
const EN_REPLY = "The Wi-Fi network is Lale-5G and the password is Lale2025. If the signal is weak in the bedroom, you can use Lale-2G with the same password.";

const passing = {
  intent: "wifi",
  riskLevel: "none",
  confidence: 0.92,
  source: "openai",
  riskType: null,
  reply: EN_REPLY,
  usedSources: ["kb:wifi"],
};

describe("kanal kapısı — yanlış dilde cevap otomatik gitmez", () => {
  it("KONTROL: misafirin dilindeki aynı cevap geçer", () => {
    expect(autoReplyGateFailure(passing, EN_GUEST)).toBeNull();
    expect(passesAutoReplySafetyGate(passing, EN_GUEST)).toBe(true);
  });

  it("🚨 İngilizce misafire Türkçe cevap (ölçülen vaka) → reply_language_mismatch", () => {
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, EN_GUEST)).toBe("reply_language_mismatch");
    expect(passesAutoReplySafetyGate({ ...passing, reply: TR_REPLY }, EN_GUEST)).toBe(false);
  });

  it("Türkçe misafire İngilizce cevap da tutulur (yön simetrik)", () => {
    expect(autoReplyGateFailure({ ...passing, reply: EN_REPLY }, "Merhaba, wifi şifresi nedir acaba?")).toBe("reply_language_mismatch");
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, "Merhaba, wifi şifresi nedir acaba?")).toBeNull();
  });

  it("son mesaj belirsizse cevapsız önceki misafir mesajlarının dili esas (cevap hepsine birden gider)", () => {
    const ctx = { pendingGuestMessages: ["Where can we park the car?"] };
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, "ok", ctx)).toBe("reply_language_mismatch");
    expect(autoReplyGateFailure({ ...passing, reply: EN_REPLY }, "ok", ctx)).toBeNull();
  });

  it("🚨 kısmi kayma: misafirin dilindeki cevaba Türkçe devir cümlesi yapıştırılmışsa da tutulur (ölçülen kopya, Almanca)", () => {
    // Ölçülen vaka bir acil durumdu (orada kapı zaten güvenlik gerekçesiyle tutar); aynı kopya risksiz soruda da olabilir.
    const de = "Wie ist das WLAN-Passwort für die Wohnung?";
    const mixed = "Das WLAN heißt Lale-5G und das Passwort ist Lale2025. Mesajınız kaydedildi; ev sahibiniz görebilir.";
    expect(autoReplyGateFailure({ ...passing, reply: mixed }, de)).toBe("reply_language_mismatch");
    // KONTROL: aynı cevap devir cümlesi Almanca → geçer.
    const clean = "Das WLAN heißt Lale-5G und das Passwort ist Lale2025. Ihre Nachricht wurde vermerkt; Ihr Gastgeber kann sie sehen.";
    expect(autoReplyGateFailure({ ...passing, reply: clean }, de)).toBeNull();
    // Güvenlik ÖNCE: acil durumda gerekçe dil değil.
    const emergency = "Mein Sohn hat beim Einstecken des Ladegeräts einen Stromschlag bekommen, er zittert.";
    expect(autoReplyGateFailure({ ...passing, reply: mixed }, emergency)).toBe("blocked");
  });

  it("AŞIRI UYGULAMA YOK: misafirin dili belirsizse ('ok', emoji, özel ad) kontrol yok", () => {
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, "ok 👍")).toBeNull();
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, "Lale2025?")).toBeNull();
  });

  it("AŞIRI UYGULAMA YOK: cevabın dili belirsizse (kısa, kod) kontrol yok", () => {
    expect(autoReplyGateFailure({ ...passing, reply: "Lale2025" }, EN_GUEST)).toBeNull();
  });

  it("🚨 GÜVENLİK ÖNCE: şikâyet/risk yanlış dilde de olsa gerekçesi dil DEĞİL (güvenlik gerekçesi gölgelenmez)", () => {
    expect(
      autoReplyGateFailure({ ...passing, reply: TR_REPLY, riskLevel: "high", riskType: "complaint" }, "The AC is broken and the room is filthy, I want a refund"),
    ).toBe("blocked");
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY, confidence: 0.5 }, EN_GUEST)).toBe("blocked");
  });

  it("🚨 anlama katmanının risk niyeti dil kontrolünden ÖNCE (acil yükseltme gerekçesi kaybolmaz)", () => {
    expect(autoReplyGateFailure({ ...passing, reply: TR_REPLY }, EN_GUEST, { understandingRisk: "complaint_issue" })).toBe("understanding_risk");
  });
});

describe("QR kapısı — dil kontrolü BİLİNÇLİ YOK (bilinen sınır, pinli)", () => {
  // QR'da tutulan cevabın yerine misafire Türkçe devir metni gider ve arayüz yalnız Türkçe (`escalationReply`,
  // `guest-chat.tsx`): Türkçe devir metni, Türkçe ama bilgili bir cevaptan misafir için daha az yararlı. Koruma istem
  // talimatıdır; QR çok dilli olunca kapı eklenir.
  it("İngilizce misafire Türkçe QR cevabı dil yüzünden devredilmez", () => {
    const verdict = evaluateEscalation({ ...passing, reply: TR_REPLY }, EN_GUEST);
    expect(verdict.escalate).toBe(false);
  });
});

const property = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null };
const prompt = (guestMessage: string, history?: { direction: "inbound" | "outbound"; body: string }[]) =>
  buildReplyUserPrompt({ property, reservation: null, knowledgeBase: [], guestMessage, history, tone: "warm", language: "tr" });

describe("istem — misafirin dili kodla tespit edilip açıkça söylenir", () => {
  it("🚨 eminken dil talimatı: İngilizce misafir → 'MİSAFİRİN DİLİ … İngilizce (en)'", () => {
    const p = prompt(EN_GUEST);
    expect(p).toContain("MİSAFİRİN DİLİ (kodla tespit edildi): İngilizce (en)");
    // Hatırlatma misafir mesajından SONRA, GÖREV satırında (model en son okuduğunu daha iyi uygular).
    const end = p.indexOf("<<GUEST_MESSAGE_END>>");
    expect(end).toBeGreaterThan(-1);
    expect(p.indexOf("reply dili: İngilizce (en)")).toBeGreaterThan(end);
  });

  it("Türkçe / Almanca misafir kendi dilini alır", () => {
    expect(prompt("Merhaba, wifi şifresi nedir acaba?")).toContain("MİSAFİRİN DİLİ (kodla tespit edildi): Türkçe (tr)");
    expect(prompt("Wie ist das WLAN-Passwort für die Wohnung?")).toContain("MİSAFİRİN DİLİ (kodla tespit edildi): Almanca (de)");
  });

  it("🚨 Türkçe olmayan misafirde istemdeki Türkçe kalıp cümleler ÇEVRİLİR (ölçülen kopya: Almanca cevaba Türkçe devir)", () => {
    expect(prompt("Mein Sohn hat beim Einstecken einen Stromschlag bekommen.")).toContain("Türkçe KOPYALAMA");
    expect(prompt(EN_GUEST)).toContain("Türkçe KOPYALAMA");
    // Türkçe misafirde bu uyarı anlamsız → yok.
    expect(prompt("Merhaba, wifi şifresi nedir acaba?")).not.toContain("Türkçe KOPYALAMA");
  });

  it("belirsiz mesajda talimat YOK (eski kural: belirsizse İngilizce)", () => {
    expect(prompt("ok 👍")).not.toContain("MİSAFİRİN DİLİ");
    expect(prompt("ok 👍")).not.toContain("reply dili:");
    expect(prompt("ok 👍")).toContain("VARSAYILAN olarak İngilizce (en)");
  });

  it("son mesaj belirsizse son cevaptan sonraki misafir mesajlarından (kapıyla AYNI kural)", () => {
    const p = prompt("ok", [
      { direction: "inbound", body: "Merhaba, otopark var mı?" },
      { direction: "outbound", body: "Evet, binanın arkasında." },
      { direction: "inbound", body: "Where can we park the car?" },
    ]);
    expect(p).toContain("MİSAFİRİN DİLİ (kodla tespit edildi): İngilizce (en)");
    // KONTROL: son cevaptan ÖNCEKİ Türkçe mesaj sayılmaz; yalnız o varsa talimat yok.
    const before = prompt("ok", [
      { direction: "inbound", body: "Merhaba, otopark var mı?" },
      { direction: "outbound", body: "Evet, binanın arkasında." },
    ]);
    expect(before).not.toContain("MİSAFİRİN DİLİ");
  });

  it("🚨 org tercih dili misafirin dilini EZMEZ: '(Sistem tercih dili: tr)' parantezi kalktı", () => {
    expect(prompt(EN_GUEST)).not.toContain("Sistem tercih dili");
  });
});
