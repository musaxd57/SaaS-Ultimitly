import { describe, it, expect } from "vitest";
import {
  detectAvailabilityRequest,
  detectAvailabilityClaim,
  hasAvailabilityDeferral,
  vetoAvailability,
  AVAILABILITY_VETO_REASONS,
} from "@/lib/ai/availability-claims";
import { passesAutoReplySafetyGate } from "@/lib/automation";
import { REPLY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  REQUESTS_POS,
  REQUESTS_NEG,
  CALENDAR_CLAIMS,
  GRANT_CLAIMS,
  DEFERRALS,
  NEUTRAL_REPLIES,
  PROMPT_CANONICAL_DEFERRALS,
} from "../helpers/availability-battery";

// ---------------------------------------------------------------------------
// MÜSAİTLİK VETOSU (kurucu kararı 09-24): model takvimi görmüyor → doğrulanmamış müsaitlik iddiası
// ya da izin OTOMATİK GÖNDERİLMEZ; müsaitliğe bağlı istek ancak kararı erteleyen cevapla gider.
// ---------------------------------------------------------------------------

describe("istek tespiti (misafir mesajı)", () => {
  it("yedi dilde müsaitliğe bağlı istekler tanınır — tür dâhil", () => {
    const wrong = REQUESTS_POS.filter((r) => detectAvailabilityRequest(r.text) !== r.kind).map(
      (r) => `${r.text} → ${detectAvailabilityRequest(r.text)} (beklenen ${r.kind})`,
    );
    expect(wrong).toEqual([]);
  });

  it("benzer görünen sıradan sorular istek SAYILMAZ (giriş/çıkış SAATİ, otopark, uzatma kablosu, kod)", () => {
    expect(REQUESTS_NEG.filter((t) => detectAvailabilityRequest(t) !== null)).toEqual([]);
  });

  it("genel 'müsait mi' sorusu yalnız TARİH sözcüğüyle istektir", () => {
    expect(detectAvailabilityRequest("Daire müsait mi?")).toBeNull();
    expect(detectAvailabilityRequest("Daire 12 Kasım'da müsait mi?")).toBe("availability");
  });
});

describe("iddia tespiti (cevap)", () => {
  it("takvim DURUMU iddiaları → calendar", () => {
    expect(CALENDAR_CLAIMS.filter((t) => detectAvailabilityClaim(t) !== "calendar")).toEqual([]);
  });

  it("konaklama değişikliğine İZİN → grant", () => {
    expect(GRANT_CLAIMS.filter((t) => detectAvailabilityClaim(t) === null)).toEqual([]);
  });

  it("🚨 tarafsız cevaplar ve ERTELEMELER iddia değildir (saat bilgisi, 'Wi-Fi available', 'olup olmadığı', 'whether')", () => {
    expect([...NEUTRAL_REPLIES, ...DEFERRALS].filter((t) => detectAvailabilityClaim(t) !== null)).toEqual([]);
  });

  it("ertelemeyle birlikte olsa da takvim iddiası iddiadır", () => {
    expect(detectAvailabilityClaim("O gece boş görünüyor ama ev sahibiniz teyit etsin.")).toBe("calendar");
    expect(detectAvailabilityClaim("The night is free, but your host will need to confirm.")).toBe("calendar");
  });

  it("olumsuz takvim cümlesi de iddiadır ('boş değil' = dolu); soru ise değildir", () => {
    expect(detectAvailabilityClaim("Maalesef o gece boş değil.")).toBe("calendar");
    expect(detectAvailabilityClaim("O gece boş mu, ev sahibinize soralım.")).toBeNull();
  });
});

describe("erteleme tespiti", () => {
  it("istemin standart cümleleri ve türevleri (TR/EN/DE/FR/ES/RU/AR) erteleme sayılır", () => {
    expect(DEFERRALS.filter((t) => !hasAvailabilityDeferral(t))).toEqual([]);
  });

  it("izin ya da tarafsız bilgi erteleme DEĞİLDİR", () => {
    expect([...GRANT_CLAIMS, "Giriş saatimiz 15:00'tir.", "Check-in is from 3 pm."].filter((t) => hasAvailabilityDeferral(t))).toEqual([]);
  });

  it("🚨 istemdeki standart cümleler GERÇEKTEN istemde (bataryanın kopyası bayatlamasın)", () => {
    // İstem satır sonlarıyla kırılı yazılı → boşluk normalize edilerek aranır (metin aynı kalır).
    const prompt = REPLY_SYSTEM_PROMPT.replace(/\s+/g, " ");
    for (const s of [
      "Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
      "Whether an earlier arrival is possible is the host's call; your request has been recorded and is visible to your host.",
    ]) {
      expect(prompt).toContain(s);
    }
    expect(PROMPT_CANONICAL_DEFERRALS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("veto matrisi", () => {
  const ASK = "Bir gece daha kalabilir miyiz?";
  it("istek + iddia/izin → availability_claim; istek + ertelemesiz cevap → availability_unconfirmed; istek + erteleme → temiz", () => {
    expect(vetoAvailability("Evet, bir gece daha kalabilirsiniz.", [ASK])).toBe("availability_claim");
    expect(vetoAvailability("Olur, bekliyoruz!", [ASK])).toBe("availability_unconfirmed");
    expect(vetoAvailability("Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.", [ASK])).toBeNull();
  });

  it("istek yokken tarafsız cevap temiz; iddia ise yine durur (model kendiliğinden takvimden söz edemez)", () => {
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi şifresi ne?"])).toBeNull();
    expect(vetoAvailability("Wi-Fi şifresi Lale2024. Bu arada hafta sonu daire boş.", ["Wifi şifresi ne?"])).toBe("availability_claim");
  });

  it("öndeki cevapsız istek sondaki zararsız sorunun ARKASINA saklanamaz", () => {
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi şifresi ne?", "Erken giriş yapabilir miyiz?"])).toBe("availability_unconfirmed");
  });

  it("devir cevabı İSTEK bacağından muaf, İDDİA bacağından DEĞİL", () => {
    expect(vetoAvailability("Mesajınızı ev sahibimize ilettim.", [ASK], { handoff: true })).toBeNull();
    expect(vetoAvailability("Ev sahibimize ilettim; o gece boş görünüyor.", [ASK], { handoff: true })).toBe("availability_claim");
  });

  it("boş/eksik cevap hüküm üretmez (kapı başka dallarla karar verir)", () => {
    expect(vetoAvailability("", [ASK])).toBeNull();
    expect(vetoAvailability(undefined, [ASK])).toBeNull();
  });

  it("gerekçe kümesi kapalı ve iki üyeli", () => {
    expect([...AVAILABILITY_VETO_REASONS]).toEqual(["availability_claim", "availability_unconfirmed"]);
  });
});

describe("gönderim kapısı (kanal) — bağlantı DAVRANIŞSAL", () => {
  const OK = { intent: "general", riskLevel: "none", confidence: 0.92, source: "openai" };
  it("🚨 ölçülen açık kapandı: 'o gece boş; bir gece daha kalabilirsiniz' otomatik GÖNDERİLMEZ", () => {
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Evet, 14 Ekim gecesi daire boş; bir gece daha kalabilirsiniz." }, "Bir gece daha kalabilir miyiz?")).toBe(false);
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Yes, next weekend is available." }, "Is the apartment available next weekend?")).toBe(false);
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Unfortunately we're fully booked that night." }, "Can we stay one more night?")).toBe(false);
  });

  it("KONTROL: kararı erteleyen cevap ve sıradan soru-cevap GİDER (aşırı engelleme yok)", () => {
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir." }, "Bir gece daha kalabilir miyiz?")).toBe(true);
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Giriş saatimiz 15:00'tir." }, "Saat kaçta giriş yapabiliriz?")).toBe(true);
  });

  it("cevapsız bekleyen mesajdaki istek de sayılır", () => {
    expect(
      passesAutoReplySafetyGate({ ...OK, reply: "Wi-Fi şifresi Lale2024." }, "Wifi şifresi ne?", { pendingGuestMessages: ["Erken giriş yapabilir miyiz?"] }),
    ).toBe(false);
  });

  it("devir akışı korunur: human_request cevabı istek bacağından muaf", () => {
    const handoff = { intent: "human_request", riskLevel: "low", confidence: 0.9, source: "openai", riskType: "human_request" };
    expect(passesAutoReplySafetyGate({ ...handoff, reply: "Mesajınızı ev sahibimize ilettim." }, "Ev sahibiyle konuşmak istiyorum, bir gece daha kalabilir miyiz?")).toBe(true);
    expect(passesAutoReplySafetyGate({ ...handoff, reply: "Ev sahibimize ilettim; o gece boş." }, "Ev sahibiyle konuşmak istiyorum, bir gece daha kalabilir miyiz?")).toBe(false);
  });
});

describe("dayanıklılık", () => {
  it("görünmez karakter / büyük harf / homoglif iddiayı gizleyemez", () => {
    expect(detectAvailabilityClaim("ERKEN GİRİŞ YAPABİLİRSİNİZ")).toBe("grant");
    expect(detectAvailabilityClaim(`Early check${String.fromCharCode(0x200b)}-in is possible.`)).toBe("grant");
    expect(detectAvailabilityClaim("Yes, the аpartment is available next weekend.")).toBe("calendar"); // Kiril а
  });

  it("uzun düşmanca girdi sınırlı sürede biter (geri izleme patlaması yok)", () => {
    const evil = `${"gece ".repeat(1500)}boş`;
    const t0 = performance.now();
    detectAvailabilityClaim(evil);
    detectAvailabilityRequest(`${"bir gece ".repeat(800)}`);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
