import { describe, it, expect } from "vitest";
import { conditionAt, endsWithTime, fieldTimeHits, __resetFieldTimeHitsCache } from "@/lib/ai/retrieval/time-fields";

// ---------------------------------------------------------------------------
// SAAT OKUYUCUSU — KARESEL İŞ YOK (A3 09-27). Okuyucu her cevapta (istemin çelişki bloğu) ve her bilgi tabanı yazımında (dizin)
// eşzamanlı koşar; olay döngüsü TÜM kiracılara ortaktır. Ölçülen: tek tuhaf / kötü niyetli kalem 1,6–2,5 sn kilitliyordu (uzun
// harf dizisinde koşul kalıbı, uzun boşlukta aralık / parantez kalıbı, binlerce tireli parçada büyüyen parçanın yeniden
// belirteçlenmesi, binlerce saatte saat başına cümlecik taraması). Düzeltmeler ÇIKTIYI DEĞİŞTİRMEZ: eski ↔ yeni 21.109 girdide
// (batarya + kör bataryalar + dev seti + 20.000 rastgele birleşim + saldırgan) fark 0 (09-27). Buradaki pinler: (1) üst süre —
// eski sürenin çok altında, makine farkına geniş pay; (2) yeniden yazılan yardımcıların ESKİ tanımla birebir aynılığı.
// ---------------------------------------------------------------------------

function ms(f: () => unknown): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

describe("üst süre (eski: 0,26–2,5 sn)", () => {
  const cases: [string, string, string, number][] = [
    ["uzun harf dizisi (koşul kalıbı; eski ~1,7 sn)", "Giriş", `Giriş 15:00 ${"a".repeat(23_980)}`, 300],
    ["iki saat arası 24k boşluk (aralık kalıbı; eski ~290 ms)", "Giriş", `Giriş 15:00${" ".repeat(23_980)}x 16:00`, 100],
    ["iki alan + 24k boşluk (parantez bölücü; eski ~260 ms)", "Saatler", `Giriş 15:00 çıkış 11:00${" ".repeat(23_970)}x`, 100],
    ["4.000 kısa tireli parça + saat (eski ~2,5 sn)", "Saatler", `${"x y – ".repeat(4_000)} 15:00`, 800],
    ["tek alan + 4.000 saat (eski ~0,85 sn)", "Giriş", `Giriş ${"10:00 ".repeat(4_000)}`, 400],
    // Claude kod incelemesi 10-21 (ölçüldü): saatsiz "11'i … geçe" / "12'ye … kala" kalıbının boşluk boşluğu karesel geri izliyordu
    // (16.000 boşlukta 6,4 sn; okuyucu 12,9 sn).
    ["\"11'i\" + 16k boşluk (saatsiz geçe kalıbı; eski ~6,4 sn)", "Giriş", `Giriş 11'i${" ".repeat(16_000)}x`, 200],
    ["\"12'ye\" + 16k boşluk (saatsiz kala kalıbı)", "Giriş", `Giriş 12'ye${" ".repeat(16_000)}x`, 200],
  ];
  for (const [label, title, text, bound] of cases) {
    it(label, () => {
      fieldTimeHits(title, text, "general"); // ısınma
      // Sonuç önbelleği (09-28) ikinci okumayı hesaplamaz → ölçüm önbelleksiz yapılır, yoksa pin boş kalır.
      __resetFieldTimeHitsCache();
      expect(ms(() => fieldTimeHits(title, text, "general"))).toBeLessThan(bound);
    });
  }
});

describe("yeniden yazılan yardımcılar ESKİ tanımla birebir", () => {
  // Tohumlu üreteç — saat, am/pm, boşluk, noktalama, harf, emoji karışık dizeler.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ALPHA = ["1", "5", "0", "2", ":", ".", " ", "  ", "\t", "a", "m", "p", "A", "M", "P", "x", "ş", "!", ")", "(", "'", "–", "😀", "\n", "_", "unless", "if you", "in case", "Unless", "15:00", "3 pm", "11 a.m"];
  const gen = (n: number) => Array.from({ length: n }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join("");

  it("endsWithTime ≡ /(?:\\d{1,2}[:.]\\d{2}|\\d{1,2}\\s*(?:am|pm))\\W*$/i (30.000 rastgele + elle seçilmiş uç)", () => {
    const REF = /(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm))\W*$/i;
    const edge = ["15:00", "15:00.", "15:00 )", "3pm", "3 PM!!", "3    pm", "pm", " pm", "115:00", "15:0", "5.30 ", "am", "x 3am_", "3am😀", "", "1:00 –", "12.00\n"];
    for (const s of [...edge, ...Array.from({ length: 30_000 }, () => gen(1 + Math.floor(rnd() * 12)))]) {
      expect(endsWithTime(s), JSON.stringify(s)).toBe(REF.test(s));
    }
  });

  it("conditionAt(c)(start) ≡ /\\b(?:if you|in case|unless)\\b/i.test(c.slice(0, start)) — Türkçe koşul fiiliyle bitmeyen cümlecikte (20.000)", () => {
    const REF = (c: string, start: number) => /\b(?:if you|in case|unless)\b/i.test(c.slice(0, start));
    for (let n = 0; n < 20_000; n++) {
      const c = `${gen(1 + Math.floor(rnd() * 10))} .`; // " ." ile biter → Türkçe koşul fiili dalı kapalı, yalnız ön bakış sınanır
      const at = conditionAt(c);
      for (let start = 0; start <= c.length; start++) expect(at(start), `${JSON.stringify(c)} @${start}`).toBe(REF(c, start));
    }
  });

  it("Türkçe koşul fiiliyle BİTEN cümlecik her saat için koşul içi (eski `endsWithCondition` dalı)", () => {
    const at = conditionAt("Daire hazırsa");
    expect([0, 3, 13].map(at)).toEqual([true, true, true]);
    expect(conditionAt("Daire 13:00'te hazır.")(6)).toBe(false);
  });
});
