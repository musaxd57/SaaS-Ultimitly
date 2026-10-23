import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// ACIK-ISLER 08-08 §14 (10-12 gece): Tailwind'in stok `animate-pulse`'ı hareket istemeyen kullanıcıda da nabız atıyordu; iskeletler
// `lxs-pulse`a taşındı (globals.css'te `prefers-reduced-motion` kaçışlı) ve bugün `animate-pulse` hiçbir bileşende kullanılmıyor.
// Geri gelirse kaçışsız animasyon geri gelir → kırmızı. `animate-spin` BİLİNÇLİ dışarıda: yükleniyor göstergesi işlevsel (WCAG 2.3.3
// "esas" istisnası), durdurmak ilerlemenin görünmesini engeller.
// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

/** `animate-pulse` sınıfı (varyant önekleriyle: `md:`, `hover:`, `!`) — `motion-safe:` zinciri kaçışlıdır, sayılmaz (Haiku 10-12: eski
 *  kalıp önekli yazımı görmüyordu). */
function unguardedPulse(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])((?:[\w-]+:)*)!?animate-pulse(?![\w-])/g)]
    .filter((m) => !m[1].split(":").includes("motion-safe"))
    .map((m) => m[0]);
}

describe("hareket azaltma — kaçışsız Tailwind nabzı geri gelmez", () => {
  const files = walk("src").map((p) => ({ p, text: readFileSync(p, "utf8") }));

  it("🚨 hiçbir bileşen `animate-pulse` sınıfı kullanmıyor (iskelet = kaçışlı `lxs-pulse`)", () => {
    const users = files
      .filter(({ p }) => !p.endsWith("globals.css")) // açıklama yorumu sınıfı ANAR
      .filter(({ text }) => unguardedPulse(text).length > 0)
      .map(({ p }) => p);
    expect(users).toEqual([]);
  });

  it("tarayıcı önekli yazımı yakalar, `motion-safe:` kaçışını saymaz", () => {
    expect(unguardedPulse('<div className="h-4 animate-pulse" />')).toEqual(["animate-pulse"]);
    expect(unguardedPulse("cn('md:animate-pulse', x)")).toEqual(["md:animate-pulse"]);
    expect(unguardedPulse('className="hover:!animate-pulse"')).toEqual(["hover:!animate-pulse"]);
    expect(unguardedPulse('className="motion-safe:animate-pulse"')).toEqual([]);
    expect(unguardedPulse('className="lxs-pulse animate-pulsex"')).toEqual([]);
  });

  it("anti-vakumluk: tarayıcı sınıfları gerçekten görüyor (`animate-spin` bulunur) ve kaçışlı nabız tanımlı", () => {
    expect(files.filter(({ text }) => text.includes("animate-spin")).length).toBeGreaterThan(5);
    const css = files.find(({ p }) => p.endsWith("globals.css"))!.text;
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lxs-pulse \{ animation: none;/);
  });
});
