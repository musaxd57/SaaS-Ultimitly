import { describe, it, expect } from "vitest";
import { countGuestAsks, withoutTrailingAskPunct } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// SORU SAYACI — MİSAFİR METNİNDE KARESEL İŞ YOK (09-28 ReDoS denetimi, ölçüldü). `countGuestAsks` her cevap isteminde misafirin
// mesajının her satırından sondaki noktalamayı `/[.,!;:…]+$/u` ile siliyordu: çapasız kalıp, satır sonu OLMAYAN uzun noktalama
// dizisinde her konumdan yeniden deneyip karesel iş yapıyordu — "…" × 32.000 + harf 0,7 sn, 128.000'de 11,5 sn (olay döngüsü tüm
// kiracılara ortak). Kanal mesajı 8.000 kod noktasında durur (K10-t) ama o sınırın içinde de ~35–75 ms / cevap. Yeni yardımcı sondan
// geriye doğrusal ve eski kalıpla BİREBİR (aşağıda rastgele + uç girdilerle kıyaslı).
// ---------------------------------------------------------------------------

function ms(f: () => unknown): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

describe("süre (eski: 32k'da 0,7 sn)", () => {
  it("🚨 satır sonu olmayan uzun noktalama dizisi", () => {
    countGuestAsks("Merhaba…\nKlima çalışmıyor."); // ısınma
    for (const unit of ["…", ".", ",;", "!:"]) {
      const text = `${unit.repeat(32_000 / unit.length)}x`;
      expect(ms(() => countGuestAsks(text)), unit).toBeLessThan(50);
    }
  });
});

describe("eski kalıpla birebir", () => {
  const REF = (l: string) => l.replace(/[.,!;:…]+$/u, "");
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ALPHA = [".", ",", "!", ";", ":", "…", "?", " ", "a", "ş", "😀", "\n", "‥", "。", "..", "x", "1"];
  const gen = (n: number) => Array.from({ length: n }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join("");

  it("30.000 rastgele + uç girdi", () => {
    const edge = ["", ".", "…", "a.", "a…!", "a .", "a.b", "😀.", "a?.", "Teşekkürler!!!", "Merhaba,", "a\n.", ".a."];
    for (const s of [...edge, ...Array.from({ length: 30_000 }, () => gen(1 + Math.floor(rnd() * 10)))]) {
      expect(withoutTrailingAskPunct(s), JSON.stringify(s)).toBe(REF(s));
    }
  });

  it("KONTROL — davranış: nezaket satırı sondaki noktalamayla da istek sayılmaz", () => {
    expect(countGuestAsks("Merhaba…\nKlima çalışmıyor.\nTeşekkürler!!!")).toBe(1);
    expect(countGuestAsks("Wi-Fi şifresi nedir?\nOtopark var mı?")).toBe(2);
  });
});
