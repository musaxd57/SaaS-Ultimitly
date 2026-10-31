import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// LANDING DEMO ÇERÇEVESİ — MOBİLDE OKUNAMAZ HÂLE GELİYORDU
// (kurucu, 2026-09-11: "mobil iframe ~4px → düzelt o zaman").
//
// 🚨 ÖLÇÜLDÜ (Chromium, gerçek dosyalar, `.msg` gövde yazısı 12,5px):
//     1280px → ölçek 1.0000 → ekranda 12,50px   (doğru)
//      430px → ölçek 0.3790 →          4,74px
//      390px → ölçek 0.3375 →          4,22px   ← okunamaz
//      360px → ölçek 0.3060 →          3,83px
//
// Kök neden `aspect-ratio`/`max-width` çakışması DEĞİL: `.frame` SABİT 960px
// tasarım genişliğinde ve `rescale()` `Math.min(w/960, 1)` ile yalnız ÜST sınır
// koyuyordu — ALT SINIR YOKTU.
//
// DÜZELTME SONRASI ÖLÇÜM: üç dar genişlikte de ölçek 0.8 → ekranda 10,00px
// (390px'te **2,37×** iyileşme); masaüstü ölçeği 1.0 ve panorama 0 ile BİREBİR
// aynı; sayfada yatay taşma 0.
//
// ⚠️ Bu dosya KAYNAK taramasıdır ve tek yönlüdür: statik `public/*.html` için
// suit'te tarayıcı altyapısı yok. İşi, ölçülen düzeltmenin sessizce geri
// alınmasını engellemek.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const DEMOS = ["public/urun.html", "public/kurulum.html"];

describe("demo çerçevesi — mobil ölçek tabanı", () => {
  it("🚨 ALT SINIRSIZ `Math.min(w/960, 1)` GERİ GELMEZ", () => {
    for (const rel of DEMOS) {
      const s = read(rel);
      expect(s, `${rel}: alt sınırsız ölçek geri gelmiş`).not.toMatch(
        /scale\s*=\s*Math\.min\(\s*w\s*\/\s*960\s*,\s*1\s*\)/,
      );
    }
  });

  it("🚨 okunabilirlik TABANI var ve ikisinde de AYNI", () => {
    const floors = DEMOS.map((rel) => {
      const m = /MIN_SCALE\s*=\s*([\d.]+)/.exec(read(rel));
      expect(m, `${rel}: MIN_SCALE bulunamadı`).toBeTruthy();
      return Number(m![1]);
    });
    expect(floors[0]).toBe(floors[1]);
    // 12,5px × taban ≥ 10px olmalı — ölçülen kabul eşiği.
    expect(12.5 * floors[0]).toBeGreaterThanOrEqual(10);
    // Anti-vakum: taban 1 değil (yani gerçekten bir KIRPMA söz konusu).
    expect(floors[0]).toBeLessThan(1);
  });

  it("🚨 kırpma sahneyi TAŞIRMAZ: kap `overflow:hidden`", () => {
    for (const rel of DEMOS) {
      expect(read(rel), rel).toMatch(/\.stageWrap\{[^}]*overflow:hidden/);
    }
  });

  it("🚨 demo KENDİ odağını takip eder (yatay kaydırma ÇUBUĞU yok — bilinçli)", () => {
    // Otomatik oynayan bir demoda elle yatay kaydırma animasyonu görüş alanının
    // dışına çıkarır; panoramayı demonun kendisi yapar. `moveCursor` tasarım
    // uzayındaki x'i alır ve panoramayı oraya kelepçeler.
    for (const rel of DEMOS) {
      const s = read(rel);
      expect(s, `${rel}: panTo yok`).toContain("function panTo(");
      expect(s, `${rel}: moveCursor panoramayı sürmüyor`).toMatch(/moveCursor\([^)]*\)\s*\{[^}]*panTo\(x\)/);
      // Masaüstünde panorama SIFIR olmalı → kırpma yoksa erken dönüş şart.
      expect(s, `${rel}: kırpma yokken panX sıfırlanmıyor`).toMatch(/scale\s*<=\s*fitScale[^;]*panX\s*=\s*0/);
    }
  });
});
