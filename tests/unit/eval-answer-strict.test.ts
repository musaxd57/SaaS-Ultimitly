import { describe, it, expect } from "vitest";
import { answerAnchorHits, answerAnchorHitsStrict, replyHasAllAnchorsAffirmed, numericAnchors } from "../eval/rag-lab/answer-metrics";
import { factsHit, factsStrict, factVerdict } from "../eval/reply-scoring";

// ---------------------------------------------------------------------------
// U20 (Codex 10-07): cevap ölçeri doğru sayının BULUNMASINI doğru cevap sayıyordu. Doğru cevap "Havuz 09:00–20:00" iken
// "Havuz 09:00–11:00" (yanlış uç), "Havuz 09:00'da açık değil" (olumsuz) gevşek ölçüde tam isabetti; `factsHit(["11"], "Daire 110")`
// doğruydu. Katı ölçü AYRI sütundur (gevşek ölçü gelişim çizgisi için aynen) — kapı değil, müşteri gönderim politikası değişmez.
// ---------------------------------------------------------------------------

const POOL = [{ needles: ["Havuz 09:00–20:00 arası açıktır."] }];

describe("U20 — katı cevap düzeyi", () => {
  it("anti-vakum: aralıkta iki çapa", () => {
    expect(numericAnchors(POOL[0].needles[0])).toEqual(["09.00", "20.00"]);
  });

  it.each([
    ["yanlış uç", "Havuz 09:00–11:00 arası açık."],
    ["eksik uç", "Havuz sabah 09:00'da açılır."],
    ["olumsuz", "Havuz 09:00–20:00 arası açık değil."],
    ["İngilizce olumsuz", "The pool is not open 09:00–20:00."],
  ])("🚨 %s → gevşek isabet ama katı DEĞİL", (_n, reply) => {
    expect(answerAnchorHits(reply, POOL).hit).toBe(1); // gevşek ölçü (değişmedi)
    expect(answerAnchorHitsStrict(reply, POOL).hit).toBe(0);
  });

  it("KONTROL: iki uç da olumlu cümlede → katı isabet (yazım farkı dahil)", () => {
    expect(answerAnchorHitsStrict("Havuz 09:00 ile 20:00 arasında açık.", POOL).hit).toBe(1);
    expect(answerAnchorHitsStrict("The pool is open from 9 am to 8 pm.", POOL).hit).toBe(1);
    expect(replyHasAllAnchorsAffirmed("Havuz 09:00'da açılır. Kapanış 20:00. Sonra açık değil.", ["09.00", "20.00"])).toBe(true);
  });
});

describe("U20 — factsHit rakam sınırı", () => {
  it("🚨 '11' olgusu 'Daire 110'da DEĞİL; '4590' '45901'de değil", () => {
    expect(factsHit(["11"], "Daire 110'a hoş geldiniz.")).toBe(false); // ⬅️ ESKİDE true
    expect(factsHit(["4590"], "Kod 45901.")).toBe(false);
  });
  it("KONTROL: sınırlı sayı, ekli sayı, harfli olgu eskisi gibi", () => {
    expect(factsHit(["11"], "Çıkış 11'de.")).toBe(true);
    expect(factsHit(["15:00"], "Giriş 15:00'ten itibaren.")).toBe(true);
    expect(factsHit(["Wi-Fi", "4590"], "wi-fi şifresi 4590")).toBe(true);
    expect(factsHit(["11"], "Daire 110, çıkış 11:00.")).toBe(true); // ikinci geçiş sınırlı
    expect(factsHit([], "x")).toBeNull();
  });
});

describe("Y9 (10-14 dış inceleme) — KATI olgu: olumluluk + alan bağı; eksik ile yanlış ayrı", () => {
  const CHECKOUT = { value: "11:00", field: ["çıkış", "check-out", "checkout"] };
  const PARKING_FEE = { value: "150", field: ["otopark", "parking"] };

  it("🚨 'Çıkış 11:00 değildir' → olumsuz (gevşek ölçüde isabetti)", () => {
    expect(factsHit([CHECKOUT], "Çıkış 11:00 değildir.")).toBe(true); // gevşek ölçü değişmedi
    expect(factVerdict(CHECKOUT, "Çıkış 11:00 değildir.")).toBe("negated");
    expect(factVerdict(CHECKOUT, "Check-out is not 11:00, it is 12:00.")).toBe("negated");
    expect(factVerdict("11:00", "Çıkış saati 11:00 değil.")).toBe("negated"); // düz olguda da olumluluk aranır
  });

  it("🚨 alanlar karışmış: 'Çıkış 150 TL, otopark 11:00' → iki olgu da başka alana bağlı", () => {
    const r = "Çıkış 150 TL, otopark 11:00.";
    expect(factsHit([CHECKOUT, PARKING_FEE], r)).toBe(true); // gevşek: ikisi de "geçiyor"
    expect(factVerdict(CHECKOUT, r)).toBe("misattributed");
    expect(factVerdict(PARKING_FEE, r)).toBe("misattributed");
    expect(factsStrict([CHECKOUT, PARKING_FEE], r)).toEqual({ ok: false, missing: 0, wrong: 2 });
  });

  it("🚨 üç sorulu mesajda otopark ücreti CEVAPSIZ → eksik (yanlış değil)", () => {
    const r = "Çıkış 11:00'de. Çöpler yan sokaktaki konteynere. Otopark için ev sahibinize yazabilirsiniz.";
    expect(factsStrict([CHECKOUT, PARKING_FEE], r)).toEqual({ ok: false, missing: 1, wrong: 0 });
  });

  it("KONTROL: doğru, olumlu, alanına bağlı cevap → ok (yazım ve ek farkı dahil)", () => {
    const r = "Çıkış saati 11:00'dir. Otopark ücreti günlük 150 TL.";
    expect(factsStrict([CHECKOUT, PARKING_FEE], r)).toEqual({ ok: true, missing: 0, wrong: 0 });
    expect(factVerdict(CHECKOUT, "Check-out is at 11:00, no extra fee.")).toBe("ok"); // "no" olumsuzlama SAYILMAZ (değerin bitişiği değil)
    expect(factVerdict("15.00", "Giriş 15.00'te başlar.")).toBe("ok"); // nokta ayraçlı saat cümleyi bölmez
    expect(factsStrict([], "x")).toBeNull();
  });
});
