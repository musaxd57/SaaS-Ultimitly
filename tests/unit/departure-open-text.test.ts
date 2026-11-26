import { describe, it, expect } from "vitest";
import { clockLocative, departureOpenDetail, departureOpenHeadline, isClockText } from "@/modules/intelligence/incidents/departure-open";

// Çıkıştan önce açık konu satırının metni (plan madde 7; kurucu örneği "Lale 3 yarın 11:00'de çıkıyor; sıcak su konusu açık").

describe("saate bulunma eki", () => {
  it.each([
    ["11:00", "11:00'de"],
    ["10:00", "10:00'da"],
    ["12:00", "12:00'de"],
    ["09:00", "09:00'da"],
    ["13:00", "13:00'te"],
    ["16:00", "16:00'da"],
    ["00:00", "00:00'da"],
    ["10:30", "10:30'da"],
    ["14:15", "14:15'te"],
    ["11:40", "11:40'ta"],
    ["11:20", "11:20'de"],
    ["11:50", "11:50'de"],
  ])("%s → %s", (t, want) => {
    expect(clockLocative(t)).toBe(want);
  });

  it("geçersiz saat metnine ek takılmaz; başlıkta saat yazılmaz", () => {
    expect(isClockText("11")).toBe(false);
    expect(isClockText("24:00")).toBe(false);
    expect(clockLocative("öğlen")).toBeNull();
    expect(departureOpenHeadline("Lale 3", { day: "tomorrow", time: "öğlen" })).toBe("Lale 3 yarın çıkıyor");
    expect(departureOpenHeadline("Lale 3", { day: "today", time: null })).toBe("Lale 3 bugün çıkıyor");
  });
});

describe("alt satır", () => {
  it("kesin saatli sözün zamanı konu adının yanında yazılır; zamansız sözde parantez yok", () => {
    expect(
      departureOpenDetail({ topics: [{ source: "commitment", kind: "maintenance", topic: "hot_water", when: "yarın 09:00" }], problem: false }),
    ).toBe("sıcak su (söz yarın 09:00) konusu açık");
    expect(departureOpenDetail({ topics: [{ source: "commitment", kind: "maintenance", topic: "hot_water" }], problem: false })).toBe(
      "sıcak su konusu açık",
    );
  });

  it("tek konu tekil, iki konu çoğul; konu adı yapılı etiketten (konusuz söz → tür)", () => {
    expect(departureOpenDetail({ topics: [{ source: "commitment", kind: "maintenance", topic: "hot_water" }], problem: false })).toBe("sıcak su konusu açık");
    expect(
      departureOpenDetail({
        topics: [
          { source: "commitment", kind: "towels", topic: null },
          { source: "held", kind: "payment_invoice" },
        ],
        problem: true,
        hoursWaiting: 4,
      }),
    ).toBe("havlu / çarşaf, ödeme / fatura konuları açık · konuşma Sorunlu olarak işaretli · misafir 4 saattir cevap bekliyor");
  });

  it("aynı etiket bir kez; üçten fazla konu '· N konu daha'", () => {
    expect(
      departureOpenDetail({
        topics: [
          { source: "commitment", kind: "maintenance", topic: "ac" },
          { source: "commitment", kind: "supplies", topic: "ac" },
          { source: "held", kind: "payment_invoice" },
          { source: "held", kind: "cancellation_refund" },
          { source: "held", kind: "human_request" },
        ],
        problem: false,
      }),
    ).toBe("klima, ödeme / fatura, iptal / iade konuları açık · 1 konu daha");
  });
});
