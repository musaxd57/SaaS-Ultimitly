import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { timeConflictHolds } from "@/lib/ai/time-conflict-gate";
import { autoReplyGateFailure } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { buildReplyPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";

// ---------------------------------------------------------------------------
// SAAT KAYNAĞI ÇELİŞKİSİ KAPISI — P4-b KODDA (09-25). Kurucu kararı: mülk ayarı ile bilgi tabanı giriş/çıkış saatinde
// çelişiyorsa cevap İNSANA gider. Eskiden bu yalnız istemin "güveni 0.75 altında tut" talimatına bağlıydı; canlı Ayarlar
// testinde (09-25) model çelişkili mülkte 0.80 verdi. Kapı artık kendisi tutar.
// ---------------------------------------------------------------------------

const CHECKIN_CONFLICT = [{ field: "checkInTime" as const, propertyValue: "13:00", kbValues: ["14:00"] }];
const CHECKOUT_CONFLICT = [{ field: "checkOutTime" as const, propertyValue: "11:00", kbValues: ["12:00"] }];

describe("timeConflictHolds — saf kural", () => {
  it("çelişki yoksa HİÇBİR ŞEY tutulmaz (çelişkisiz mülkte davranış aynı)", () => {
    expect(timeConflictHolds([], { intent: "checkin", reply: "Giriş 13:00'te.", guestTexts: ["Giriş saati kaçta?"] })).toBe(false);
    expect(timeConflictHolds(undefined, { intent: "checkin", reply: "Giriş 13:00'te.", guestTexts: ["Giriş saati kaçta?"] })).toBe(false);
  });

  it("çelişkili alanın niyet etiketi → tutulur (giriş: checkin / early_checkin)", () => {
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "checkin", reply: "Merhaba.", guestTexts: ["Merhaba"] })).toBe(true);
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "early_checkin", reply: "Merhaba.", guestTexts: ["Merhaba"] })).toBe(true);
    expect(timeConflictHolds(CHECKOUT_CONFLICT, { intent: "late_checkout", reply: "Merhaba.", guestTexts: ["Merhaba"] })).toBe(true);
  });

  it("niyet etiketi başka olsa da misafir çelişkili alanı soruyorsa tutulur (TR + EN; etiket modelin, konu kodun)", () => {
    for (const q of ["Giriş saati kaçta?", "What time can we check in?", "Kaçta girebiliriz, giriş için bilgi alabilir miyim?"]) {
      expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "general", reply: "Bilgi verelim.", guestTexts: [q] }), q).toBe(true);
    }
    expect(timeConflictHolds(CHECKOUT_CONFLICT, { intent: "general", reply: "Bilgi verelim.", guestTexts: ["Çıkış saati kaçta?"] })).toBe(true);
  });

  it("misafir alanı adlandırmasa da CEVAP adlandırıyorsa tutulur (cevabın kendi konusu)", () => {
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "general", reply: "Girişiniz ev sahibinizin kararıdır.", guestTexts: ["Ne zaman gelebiliriz?"] })).toBe(true);
    // KONTROL: aynı soru, cevap alanı adlandırmıyor ve saat söylemiyor → gider.
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "general", reply: "Ev sahibiniz size yazacak.", guestTexts: ["Ne zaman gelebiliriz?"] })).toBe(false);
  });

  it("cevap çelişen saatlerden birini söylüyorsa konu adı geçmese de tutulur", () => {
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "general", reply: "Kapı 14:00'ten sonra açılır.", guestTexts: ["Ne zaman gelebiliriz?"] })).toBe(true);
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "general", reply: "You can come after 1 pm.", guestTexts: ["When?"] })).toBe(true);
  });

  it("canlıda görülen vaka: çelişkili mülkte erken giriş isteği + 'kayıtlarım tutarsız' ertelemesi → tutulur", () => {
    const reply =
      "Merhaba, normalde check-in saatlerimle ilgili kayıtlarım tutarsız görünüyor, o yüzden net bir saat söyleyemiyorum. " +
      "Yarın saat 11:00 civarında giriş yapma isteğiniz ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.";
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "early_checkin", reply, guestTexts: ["Yarın saat 11'de giriş yapabilir miyiz?"] })).toBe(true);
  });

  it("AŞIRI UYGULAMA YOK: çelişkili alana değmeyen soru gider (Wi-Fi, otopark)", () => {
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "wifi", reply: "Ağ adı Lale-5G, şifre kartta.", guestTexts: ["Wifi şifresi nedir?"] })).toBe(false);
    expect(timeConflictHolds(CHECKIN_CONFLICT, { intent: "parking", reply: "Otopark binanın arkasında.", guestTexts: ["Otopark var mı?"] })).toBe(false);
  });

  it("AŞIRI UYGULAMA YOK: yalnız ÇIKIŞ çelişkiliyse giriş konulu konuşma tutulmaz (alan alan)", () => {
    expect(
      timeConflictHolds(CHECKOUT_CONFLICT, {
        intent: "early_checkin",
        reply: "Erken giriş ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
        guestTexts: ["10:00'da erken giriş yapabilir miyiz?"],
      }),
    ).toBe(false);
  });
});

// Kapıdan geçmesi gereken sade bir bilgi cevabı: tek fark çelişki listesi.
const passing = {
  intent: "checkin",
  riskLevel: "low",
  confidence: 0.9,
  source: "openai",
  riskType: null,
  reply: "Giriş saatiniz 13:00'tür.",
  usedSources: ["property:checkInTime"],
};

describe("kanal kapısı — çelişki kararı modele bırakılmaz", () => {
  it("KONTROL: çelişki yoksa aynı cevap kapıdan geçer", () => {
    expect(autoReplyGateFailure({ ...passing, timeConflicts: [] }, "Giriş saati kaçta?")).toBeNull();
    expect(autoReplyGateFailure(passing, "Giriş saati kaçta?")).toBeNull();
  });

  it("🚨 çelişkili alanda güveni 0.9 olan cevap TUTULUR; gerekçe kb_time_conflict", () => {
    expect(autoReplyGateFailure({ ...passing, timeConflicts: CHECKIN_CONFLICT }, "Giriş saati kaçta?")).toBe("kb_time_conflict");
  });

  it("çelişkili alan yalnız ÖNCEKİ cevapsız misafir mesajında geçse de tutulur (cevap hepsine birden gider)", () => {
    const wifi = { ...passing, intent: "wifi", reply: "Ağ adı Lale-5G, şifre kartta.", usedSources: [] };
    expect(
      autoReplyGateFailure({ ...wifi, timeConflicts: CHECKIN_CONFLICT }, "Bir de wifi şifresi?", { pendingGuestMessages: ["Giriş saati kaçta?"] }),
    ).toBe("kb_time_conflict");
    // KONTROL: önceki mesaj yoksa aynı Wi-Fi cevabı geçer.
    expect(autoReplyGateFailure({ ...wifi, timeConflicts: CHECKIN_CONFLICT }, "Bir de wifi şifresi?")).toBeNull();
  });

  it("çelişki çıkışta, soru Wi-Fi → yine geçer (aşırı uygulama yok)", () => {
    const wifi = { ...passing, intent: "wifi", reply: "Ağ adı Lale-5G, şifre kartta.", usedSources: [] };
    expect(autoReplyGateFailure({ ...wifi, timeConflicts: CHECKOUT_CONFLICT }, "Wifi şifresi nedir?")).toBeNull();
  });
});

describe("QR kapısı — kanalla aynı yüklem", () => {
  it("🚨 çelişkili alanda QR cevabı devredilir (kb_time_conflict); çelişkisiz aynı cevap gider", () => {
    const withConflict = evaluateEscalation({ ...passing, timeConflicts: CHECKIN_CONFLICT }, "Giriş saati kaçta?");
    expect(withConflict).toEqual({ escalate: true, reason: "kb_time_conflict" });
    expect(evaluateEscalation({ ...passing, timeConflicts: [] }, "Giriş saati kaçta?").escalate).toBe(false);
  });
});

const property = { name: "Lale", checkInTime: "13:00", checkOutTime: "11:00", address: null, city: null };
const conflictingKb = [{ category: "checkin", title: "Karşılama", content: "Giriş saati 14:00'tür. Anahtar kutusu kapının yanında." }];
const consistentKb = [{ category: "checkin", title: "Karşılama", content: "Giriş saati 13:00'tür. Anahtar kutusu kapının yanında." }];

describe("istem → sonuç → kapı bağlantısı (yüklem var, argüman yok sınıfı)", () => {
  it("buildReplyPrompt çelişkiyi döndürür; uyumlu bilgi tabanında boş", () => {
    const base = { property, reservation: null, guestMessage: "Giriş saati kaçta?", tone: "warm" as const, language: "tr" };
    expect(buildReplyPrompt({ ...base, knowledgeBase: conflictingKb }).timeConflicts).toEqual([
      { field: "checkInTime", propertyValue: "13:00", kbValues: ["14:00"] },
    ]);
    expect(buildReplyPrompt({ ...base, knowledgeBase: consistentKb }).timeConflicts).toEqual([]);
  });

  describe("suggestReply sonucu çelişkiyi taşır ve gerçek kapı onu okur", () => {
    beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    const modelSays = (reply: string, intent: string, confidence: number) =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ intent, confidence, reply, riskLevel: "low" }) } }],
        }),
        { status: 200 },
      );

    it("🚨 çelişkili bilgi tabanı + modelin 0.8 güveni → kapı TUTAR; uyumlu bilgi tabanında aynı cevap geçer", async () => {
      const input = { property, reservation: null, guestMessage: "Giriş saati kaçta?", tone: "warm" as const, language: "tr" };
      vi.stubGlobal("fetch", vi.fn(async () => modelSays("Giriş saatiniz 13:00'tür.", "checkin", 0.8)));
      const conflicted = await suggestReply({ ...input, knowledgeBase: conflictingKb });
      expect(conflicted.timeConflicts).toEqual([{ field: "checkInTime", propertyValue: "13:00", kbValues: ["14:00"] }]);
      expect(autoReplyGateFailure(conflicted, input.guestMessage)).toBe("kb_time_conflict");
      expect(evaluateEscalation({ ...conflicted }, input.guestMessage)).toEqual({ escalate: true, reason: "kb_time_conflict" });

      vi.stubGlobal("fetch", vi.fn(async () => modelSays("Giriş saatiniz 13:00'tür.", "checkin", 0.8)));
      const clean = await suggestReply({ ...input, knowledgeBase: consistentKb });
      expect(clean.timeConflicts).toEqual([]);
      expect(autoReplyGateFailure(clean, input.guestMessage)).toBeNull();
    });
  });
});
