import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Tema kontrast pini (erişilebilirlik taraması 10-22): ikincil metin (`--muted-foreground`) açık temada sayfa zemininde 4,48:1, gri çipte
// (`--muted`) 4,28:1 idi — WCAG AA'nın normal metin eşiği 4,5:1'in altında; axe taraması 20 sayfanın neredeyse hepsinde bunu yakaladı.
// Token'ı yeniden açan bir renk değişikliği burada kırmızı olur. Oranlar WCAG 2.x bağıl parlaklık formülüyle `globals.css`ten hesaplanır.
// ---------------------------------------------------------------------------

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} bloğu bulunamadı`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n  }", start));
}

function token(src: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%;`).exec(src);
  expect(m, `--${name} bulunamadı`).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(hslToRgb(fg));
  const b = luminance(hslToRgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("tema kontrastı — ikincil metin AA (4,5:1)", () => {
  for (const [label, selector] of [
    ["açık tema", ":root"],
    ["karanlık tema", "html.dark"],
  ] as const) {
    it(`${label}: --muted-foreground zemin / kart / gri çip üzerinde ≥ 4,5`, () => {
      const src = block(selector);
      const fg = token(src, "muted-foreground");
      for (const surface of ["background", "card", "muted"]) {
        expect(contrast(fg, token(src, surface)), `${label} ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("ölçer doğru: eski açık tema değeri (215 16% 47%) gri çipte eşiğin altında kalır", () => {
    const muted = token(block(":root"), "muted");
    expect(contrast([215, 16, 47], muted)).toBeLessThan(4.5);
    // Siyah / beyaz uçları formülün kendisini sınar.
    expect(contrast([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 5);
  });
});
