import { describe, it, expect } from "vitest";
import { confidentLanguage, guestTurnLanguage } from "@/lib/ai/language-signal";
import { splitQuestions } from "@/lib/ai/retrieval/select";

// ---------------------------------------------------------------------------
// DİL TESPİTİ + SORU BÖLÜCÜ MALİYETİ — düşmanca girdide sınırlı (ReDoS denetimi 09-28, ÖLÇÜLDÜ).
//
// Dil tespitinin ayıklayıcısı (`\S+@\S+`, `\S*\d\S*`) uzun tek sözcükte, soru bölücünün bağlaç kalıbı (`\s+(?:ve|…)\s+`)
// uzun boşluk dizisinde karesel koşuyordu (20.000 karakterde 0,4 sn / 0,16 sn; ikisi de her cevapta misafir metnine koşar,
// kanal mesajında uzunluk tavanı yok). Düzeltme sonucu DEĞİŞTİRMEZ (eski/yeni kıyası + aşağıdaki anlam pinleri).
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("dil tespiti + soru bölücü — düşmanca girdide sınırlı süre", () => {
  it.each([
    ["tek uzun sözcük (e-posta / rakam ayıklayıcı)", "a".repeat(20000)],
    ["tek uzun sözcük + sonda @", "a".repeat(20000) + "@"],
  ])("dil: %s → 100 ms altında", (_ad, girdi) => {
    confidentLanguage(girdi.slice(0, 40)); // ısınma
    expect(ms(() => { confidentLanguage(girdi); guestTurnLanguage(girdi); })).toBeLessThan(100);
  });

  it("soru bölücü: uzun boşluk dizisi → 100 ms altında", () => {
    const girdi = "otopark" + " ".repeat(40000) + "x"; // eski kod 20.000'de 0,15 sn, 40.000'de ~0,6 sn (karesel)
    splitQuestions("otopark ve x"); // ısınma
    expect(ms(() => splitQuestions(girdi))).toBeLessThan(100);
  });
});

describe("anlam aynı — ayıklayıcı ve bölücü", () => {
  it("e-posta / rakamlı belirteç / bağlantı dil kanıtı sayılmaz; kalan metin karar verir", () => {
    expect(confidentLanguage("Please send it to guest@example.com, the code is AB12 and the link https://x.io/a — thanks a lot for everything")).toBe("en");
    expect(confidentLanguage("guest@example.com AB12 15:00 https://x.io/a")).toBeNull();
  });

  it("yalnız İÇ konumdaki @ e-posta biçimidir; baştaki / sondaki @ belirteci silmez (eski kalıpla aynı)", () => {
    expect(confidentLanguage("@hello @thanks @please @everyone @guys")).toBe("en");
    expect(confidentLanguage("hello@ thanks@ please@ everyone@ guys@")).toBe("en");
    expect(confidentLanguage("h@llo th@nks ple@se every@ne gu@ys")).toBeNull();
    // İç konumda @ taşıyan belirteç, iki yanında dil sözcüğü olsa da silinir (e-posta biçimi).
    expect(confidentLanguage("thanks@hello please@everyone guys@thanks hello@please everyone@guys")).toBeNull();
  });

  it("ASCII rakam taşıyan belirteç (kod, saat, şifre) dil kanıtı değildir", () => {
    expect(confidentLanguage("hello thanks please everyone guys")).toBe("en");
    expect(confidentLanguage("hello1 thanks2 please3 everyone4 guys5")).toBeNull();
  });

  it("bölücü: bağlaç ve virgül aynı parçaları verir, uzun boşluk da", () => {
    expect(splitQuestions("Otopark var mı ve havlu nerede")).toEqual(splitQuestions("Otopark var mı" + " ".repeat(50) + "ve" + " ".repeat(7) + "havlu nerede"));
    expect(splitQuestions("wifi şifresi, otopark yeri ve havlu")).toHaveLength(3);
  });
});
