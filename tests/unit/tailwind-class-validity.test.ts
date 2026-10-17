import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// TAILWIND SINIFI YAZMAK, O SINIFIN ÜRETİLDİĞİ ANLAMINA GELMEZ (08-07 (2)).
//
// 🚨 ÖLÇÜLDÜ — iki sessiz kusur canlıda duruyordu:
//  · `bg-success/12` ve `bg-destructive/12`: Tailwind'in opaklık ölçeğinde **12
//    YOK** (üretilenler: 2,4,5,10,15,20,30,40,50,60,70,80,85,90,95). Sınıf hiç
//    CSS üretmiyordu → "Cevaplandı"/"Sorunlu"/"Acil"/"İptal" rozetleri ve
//    vurgulanması gereken istatistik kutuları ZEMİNSİZ (şeffaf) çiziliyordu.
//    Üstelik `StatCard` sayı sıfır değilken tonu `destructive`'e çeviriyor —
//    yani zemin tam da vurgu istendiği anda kayboluyordu.
//  · `size-4.5` / `size-5.5`: varsayılan ölçekte yok → sidebar ikonları ve iki
//    landing ikonu lucide'ın varsayılanı olan 24px'te kalıyordu (yanlarındaki
//    öğeler `size-4`/`size-5`). Config'e eklendi; sınıflar artık çalışıyor.
//
// Bu sınıf hatası TypeScript'in, lint'in ve testlerin HEPSİNDEN geçer — tek
// belirtisi "biraz tuhaf görünüyor"dur. Bu yüzden kaynak taramasıyla pinlendi.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
  });
}
const FILES = walk(SRC).map((p) => [p, readFileSync(p, "utf8")] as const);

/** Tailwind 3.4'ün ÜRETTİĞİ opaklık kademeleri (üretilmiş CSS'ten ölçüldü). */
const VALID_OPACITY = new Set([
  0, 2, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
]);

describe("Tailwind sınıfları gerçekten CSS üretiyor mu", () => {
  it("hiçbir renk sınıfı ÖLÇEK DIŞI bir opaklık kullanmıyor", () => {
    const bad: string[] = [];
    for (const [file, src] of FILES) {
      // `bg-x/NN`, `text-x/NN`, `border-x/NN` … — yalnız SAYISAL değiştirici.
      for (const m of src.matchAll(/\b(?:bg|text|border|ring|fill|stroke|from|to|via)-[a-z-]+\/(\d{1,3})\b/g)) {
        const pct = Number(m[1]);
        if (!VALID_OPACITY.has(pct)) bad.push(`${file.replace(process.cwd(), "")}: ${m[0]}`);
      }
    }
    expect(bad, `ölçek dışı opaklık (CSS ÜRETİLMEZ):\n${bad.join("\n")}`).toEqual([]);
  });

  it("`size-*` ara değerleri ya VARSAYILAN ölçekte ya config'de TANIMLI", () => {
    // ⚠️ Tailwind'in varsayılan boşluk ölçeği yarım adımları YALNIZ 4'e kadar
    // taşır (0.5 · 1.5 · 2.5 · 3.5). `size-3.5` bu yüzden zaten çalışıyor;
    // `size-4.5` ve `size-5.5` ise ÇALIŞMIYORDU ve config'e eklendi.
    // Test bu ayrımı bilmeli, yoksa çalışan bir sınıfı hata sanar (ilk
    // yazımda tam bunu yaptı ve kendi kendini yakaladı).
    const TAILWIND_DEFAULT_HALF_STEPS = new Set(["0.5", "1.5", "2.5", "3.5"]);
    const cfg = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    const used = new Set<string>();
    for (const [, src] of FILES) {
      for (const m of src.matchAll(/\bsize-(\d+\.\d+)\b/g)) used.add(m[1]);
    }
    const missing = [...used].filter(
      (v) => !TAILWIND_DEFAULT_HALF_STEPS.has(v) && !cfg.includes(`"${v}":`),
    );
    expect(
      missing,
      `bu size-* değerleri HİÇ CSS ÜRETMEZ — tailwind.config'e ekle: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
