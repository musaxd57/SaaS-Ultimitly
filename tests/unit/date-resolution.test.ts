import { describe, it, expect } from "vitest";
import { resolveGuestDates, DATE_RESOLUTION_MAX_CHARS } from "@/lib/ai/date-resolution";

// ---------------------------------------------------------------------------
// Pragmatik tarih çözümü (kurucu talimatı 09-07). Sabit an: 2026-10-09 Cuma 12:00 İstanbul. Saat diliminden bağımsız
// değil: "bugün" ORG diliminde (gece yarısı sonrası testi aşağıda).
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-09T09:00:00Z"); // 12:00 İstanbul, Cuma
const r = (text: string, extra: Partial<Parameters<typeof resolveGuestDates>[1]> = {}) =>
  resolveGuestDates(text, { now: NOW, timeZone: TZ, ...extra });

describe("talimat senaryo 8 — belirsiz müsaitlik isteği", () => {
  it("🚨 'Ayın 3'ü ile 4'ü müsait mi?' → BELİRSİZ, iki gün de aysız, tahmin YOK", () => {
    const x = r("Ayın 3'ü ile 4'ü müsait mi?");
    expect(x.status).toBe("ambiguous");
    expect(x.dates).toEqual([]);
    expect(x.reasons).toContain("day_without_month");
    expect(x.assumed).toEqual(["month", "year"]);
    // Seçenekler bugünden sonraki ilk geçerli aylar (Ekim'in 3'ü geçti → Kasım, Aralık).
    expect(x.alternatives).toEqual(["2026-11-03", "2026-11-04", "2026-12-03", "2026-12-04"]);
  });

  it("konuşmada açık bir ay varsa aysız gün o aya oturur (talimat sırası 2)", () => {
    const x = r("Ayın 3'ü ile 4'ü müsait mi?", { conversationDates: ["2026-11-20"] });
    expect(x).toMatchObject({ status: "resolved", dates: ["2026-11-03", "2026-11-04"], basis: "conversation_month", confidence: "medium" });
  });
});

describe("açık tarih", () => {
  it.each([
    ["14 Ekim 2026'da gelebilir miyiz?", "2026-10-14"],
    ["2026-10-14", "2026-10-14"],
    ["14.10.2026 tarihinde", "2026-10-14"],
    ["On October 14, 2026 please", "2026-10-14"],
    ["14th of October 2026", "2026-10-14"],
  ])("tam tarih: %s → %s (yüksek güven, varsayım yok)", (text, key) => {
    expect(r(text)).toMatchObject({ status: "resolved", dates: [key], basis: "explicit_full", confidence: "high", assumed: [] });
  });

  it("gün + ay → yıl VARSAYILIR (en yakın gelecek), güven orta", () => {
    expect(r("14 Ekim'de giriş")).toMatchObject({ dates: ["2026-10-14"], basis: "explicit_day_month", confidence: "medium", assumed: ["year"] });
    expect(r("Oct 20")).toMatchObject({ dates: ["2026-10-20"], assumed: ["year"] });
  });

  it("geçmiş gün + ay → gelecek yıl; çok uzaksa güven DÜŞÜK (misafir geçmişi anıyor olabilir)", () => {
    const x = r("3 Ekim");
    expect(x.dates).toEqual(["2027-10-03"]);
    expect(x.confidence).toBe("low");
    expect(x.reasons).toContain("far_future_assumption");
  });

  it("🚨 '3/4' biçiminde gün/ay sırası belirsiz → iki yorum, karar yok (yalnız iki haneli ikinci parçayla)", () => {
    const x = r("03/04 için yer var mı?");
    expect(x.status).toBe("ambiguous");
    expect(x.reasons).toContain("numeric_order_ambiguous");
    expect(x.alternatives).toEqual(["2027-03-04", "2027-04-03"]);
  });

  it("🚨 noktalı YILSIZ biçim saat de olabilir (14.10 = 14:10) → BELİRSİZ, seçenek 14 Ekim (inceleme 10-09 tur 4)", () => {
    expect(r("14.10'da çıkış")).toMatchObject({ status: "ambiguous", alternatives: ["2026-10-14"], reasons: ["dotted_time_or_date"] });
  });
  it("KONTROL: yıllı noktalı biçim kesin (14.10.2026)", () => {
    expect(r("14.10.2026'da çıkış")).toMatchObject({ status: "resolved", dates: ["2026-10-14"] });
  });

  it("31 Şubat yok → tarih değil", () => {
    expect(r("31 Şubat").status).toBe("none");
  });
});

describe("göreli ifadeler — ORG diliminde", () => {
  it.each([
    ["Bugün erken girebilir miyiz?", "2026-10-09"],
    ["bu gece", "2026-10-09"],
    ["Yarın geç çıkış", "2026-10-10"],
    ["öbür gün", "2026-10-11"],
    ["tomorrow night", "2026-10-10"],
    ["the day after tomorrow", "2026-10-11"],
  ])("%s → %s", (text, key) => {
    expect(r(text)).toMatchObject({ status: "resolved", dates: [key], basis: "relative", confidence: "high" });
  });

  it("🚨 gece yarısından sonra 'bugün' ORG diliminin günüdür (UTC değil)", () => {
    const afterMidnight = new Date("2026-10-09T21:30:00Z"); // 00:30 İstanbul, 10 Ekim
    expect(resolveGuestDates("bugün", { now: afterMidnight, timeZone: TZ }).dates).toEqual(["2026-10-10"]);
  });

  it("hafta günü: (bu) cuma → en yakın (bugün Cuma → bugün), güven orta", () => {
    expect(r("bu cuma")).toMatchObject({ dates: ["2026-10-09"], basis: "weekday", confidence: "medium" });
    expect(r("cumartesi")).toMatchObject({ dates: ["2026-10-10"] });
    expect(r("on Sunday")).toMatchObject({ dates: ["2026-10-11"] });
  });

  it("🚨 'gelecek cuma' / 'next friday' → BELİRSİZ (bu hafta mı sonraki mi)", () => {
    const x = r("next friday");
    expect(x.status).toBe("ambiguous");
    expect(x.reasons).toContain("next_weekday_ambiguous");
    expect(x.alternatives).toEqual(["2026-10-16", "2026-10-23"]);
  });

  it("'pazar' tek başına çarşı da demek → gün SAYILMAZ; 'pazar günü' / 'bu pazar' gün", () => {
    expect(r("pazara gidiyoruz").status).toBe("none");
    expect(r("pazar günü çıkacağız").dates).toEqual(["2026-10-11"]);
  });
});

describe("rezervasyon bağlamı", () => {
  const reservation = { arrival: "2026-10-12", departure: "2026-10-15" };
  it("giriş günü / çıkış günü → rezervasyondan", () => {
    expect(r("giriş günü erken gelebilir miyiz", { reservation })).toMatchObject({ dates: ["2026-10-12"], basis: "reservation" });
    expect(r("check-out day late?", { reservation })).toMatchObject({ dates: ["2026-10-15"] });
  });
  it("🚨 rezervasyon yoksa 'giriş günü' BELİRSİZ (uydurma yok)", () => {
    expect(r("giriş günü erken gelebilir miyiz")).toMatchObject({ status: "ambiguous", reasons: ["reservation_unknown"] });
  });
});

describe("yanlış pozitif yok", () => {
  it.each(["1.5 saat sonra", "2.5 kişi", "3/4 kişiyiz", "saat 14.30'da", "Wi-Fi şifresi nedir?", "11'de orada oluruz", ""])(
    "%s → tarih yok",
    (text) => {
      expect(r(text).status).toBe("none");
    },
  );
});

describe("birden çok tarih", () => {
  it("14 Ekim'den 16 Ekim'e → iki gün, sıralı", () => {
    expect(r("14 Ekim'den 16 Ekim'e kadar müsait mi?").dates).toEqual(["2026-10-14", "2026-10-16"]);
  });
  it("biri belirsizse bütün sonuç belirsiz, kesin olan yine listelenir", () => {
    const x = r("yarın ve ayın 20'si");
    expect(x.status).toBe("ambiguous");
    expect(x.dates).toEqual(["2026-10-10"]);
  });
});

describe("süre — misafir metni (karesel iş yok)", () => {
  it.each([
    ["uzun tek sözcük", "a".repeat(50_000)],
    ["boşluk dizisi", " ".repeat(50_000)],
    ["tekrarlanan rakam + ek", "12'si ".repeat(10_000)],
    ["tekrarlanan 'ayin'", "ayin 3 ile ".repeat(8_000)],
  ])("%s 50.000 karakter < 200 ms; işlenen uzunluk tavanlı", (_n, text) => {
    const t0 = performance.now();
    r(text);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(DATE_RESOLUTION_MAX_CHARS).toBeLessThanOrEqual(8_000);
  });
});

// ---------------------------------------------------------------------------
// İnceleme 10-09 (Haiku, 15 bulgu) — kabul edilenlerin kırmızı-önce vakaları.
// ---------------------------------------------------------------------------
describe("inceleme 10-09 — aralıklar iki ucu da korur (#6)", () => {
  it.each([
    ["15-17 Ekim arası müsait mi?", ["2026-10-15", "2026-10-17"]],
    ["15th-17th October", ["2026-10-15", "2026-10-17"]],
    ["October 15th-17th", ["2026-10-15", "2026-10-17"]],
    ["14 ve 16 Ekim", ["2026-10-14", "2026-10-16"]],
  ])("%s → %j", (text, dates) => {
    expect(r(text)).toMatchObject({ status: "resolved", dates });
  });
  it("ayın 3'ünden 5'ine kadar → iki gün de (aysız → belirsiz)", () => {
    const x = r("ayın 3'ünden 5'ine kadar");
    expect(x.status).toBe("ambiguous");
    expect(x.alternatives).toEqual(expect.arrayContaining(["2026-11-03", "2026-11-05"]));
  });
});

describe("inceleme 10-09 — 'gelecek hafta' kalıpları belirsiz (#7)", () => {
  it.each(["gelecek hafta cuma", "önümüzdeki hafta cuma", "next week friday", "bir sonraki cuma"])("%s", (text) => {
    expect(r(text)).toMatchObject({ status: "ambiguous", dates: [] });
  });
  it("KONTROL: 'önümüzdeki cuma' en yakın cuma (bugün Cuma → bugün)", () => {
    expect(r("önümüzdeki cuma").dates).toEqual(["2026-10-09"]);
  });
});

describe("inceleme 10-09 — hafta günü açık tarihle çelişirse belirsiz (#8)", () => {
  it("15 Ekim 2026 Perşembe; '15 Ekim Cuma' → belirsiz", () => {
    expect(r("15 Ekim Cuma")).toMatchObject({ status: "ambiguous", reasons: expect.arrayContaining(["weekday_mismatch"]) });
  });
  it("KONTROL: tutarlı '16 Ekim Cuma' → tek gün", () => {
    expect(r("16 Ekim Cuma")).toMatchObject({ status: "resolved", dates: ["2026-10-16"] });
  });
});

describe("inceleme 10-09 — yanlış pozitifler (#9, #10)", () => {
  it.each([
    "saat 10.12'de geleceğiz",
    "saat 9.10 gibi",
    "1.10 TL fark var",
    "10/10 hizmet",
    "cuma namazı için cami var mı?",
    "Salı pazarı nerede kuruluyor?",
    "Is it on the 1st floor?",
    "girişte otopark var mı?",
    "Can we pay on arrival?",
  ])("%s → tarih yok", (text) => {
    expect(r(text).status).toBe("none");
  });
});

describe("inceleme 10-09 — eksik kalıplar (#11, #12)", () => {
  it("15'inde gelebilir miyiz → aysız gün, belirsiz", () => {
    expect(r("15'inde gelebilir miyiz")).toMatchObject({ status: "ambiguous", reasons: ["day_without_month"] });
  });
  it("Ekim'in 15'i → 15 Ekim", () => {
    expect(r("Ekim'in 15'i")).toMatchObject({ status: "resolved", dates: ["2026-10-15"] });
  });
  it.each(["bu hafta sonu", "this weekend", "hafta sonu müsait mi"])("%s → Cumartesi + Pazar", (text) => {
    expect(r(text)).toMatchObject({ status: "resolved", dates: ["2026-10-10", "2026-10-11"] });
  });
  it("next weekend → belirsiz", () => {
    expect(r("next weekend").status).toBe("ambiguous");
  });
  it("virgülden sonra boşluksuz yıl: Oct 14,2027", () => {
    expect(r("Oct 14,2027")).toMatchObject({ dates: ["2027-10-14"], confidence: "high", assumed: [] });
  });
});

describe("inceleme 10-09 — geçmiş, öncelik, konuşma ayı (#13, #14, #15)", () => {
  it("geçmiş tam tarih çözülür ama past_date gerekçesi taşır", () => {
    expect(r("14.10.2025")).toMatchObject({ status: "resolved", dates: ["2025-10-14"], reasons: ["past_date"] });
  });
  it("🚨 göreli ile açık tarih farklıysa belirsiz: 'yarın, 15 Ekim'", () => {
    expect(r("yarın, 15 Ekim")).toMatchObject({ status: "ambiguous", reasons: expect.arrayContaining(["conflicting_dates"]) });
  });
  it("KONTROL: tutarlıysa tek gün: 'yarın, 10 Ekim'", () => {
    expect(r("yarın, 10 Ekim")).toMatchObject({ status: "resolved", dates: ["2026-10-10"] });
  });
  it("konuşma ayı = en SON anılan (sıra), en büyük değil", () => {
    expect(r("ayın 3'ü", { conversationDates: ["2026-12-01", "2026-11-05"] }).dates).toEqual(["2026-11-03"]);
  });
  it("konuşma ayı geçmişte kalıyorsa past_date", () => {
    expect(r("ayın 3'ü", { conversationDates: ["2026-02-20"] }).reasons).toContain("past_date");
  });
  it("29 Şubat → bir sonraki artık yıl", () => {
    expect(r("29 Şubat").dates).toEqual(["2028-02-29"]);
  });
  it("tavan GERÇEKTEN uygulanır: 4.000 karakterden sonraki tarih okunmaz", () => {
    expect(r(`${"a ".repeat(2_100)} 15 Ekim`).status).toBe("none");
  });
});

describe("inceleme 10-09 tur 4", () => {
  it("🚨 '9.10'da gelirim' kesin tarih DEĞİL", () => {
    expect(r("9.10'da gelirim").status).not.toBe("resolved");
  });
  it.each(["1.10 indirim var mı", "2.50 fark", "10.12 ücret"])("%s → para bağlamı, tarih yok", (text) => {
    expect(r(text).status).toBe("none");
  });
  it.each(["the 2nd car", "the 3rd key", "the 1st parking spot"])("%s → tarih yok", (text) => {
    expect(r(text).status).toBe("none");
  });
  it("🚨 'yarın cuma' (yarın Cumartesi) → belirsiz", () => {
    expect(r("yarın cuma")).toMatchObject({ status: "ambiguous", reasons: expect.arrayContaining(["weekday_mismatch"]) });
  });
  it("🚨 'cuma yarın' de belirsiz (sözcük sırası çelişkiyi gizlemez)", () => {
    expect(r("cuma yarın")).toMatchObject({ status: "ambiguous", reasons: expect.arrayContaining(["weekday_mismatch"]) });
  });
  it("KONTROL: tutarlı 'yarın cumartesi' → tek gün", () => {
    expect(r("yarın cumartesi")).toMatchObject({ status: "resolved", dates: ["2026-10-10"] });
  });
});
