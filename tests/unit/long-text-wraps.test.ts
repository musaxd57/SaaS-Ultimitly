import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// UZUN BAĞLANTI KARTI TAŞIRMAZ (görsel inceleme 10-22, 320 px Chromium'da ölçüldü): satır sonlarını koruyan (`whitespace-pre-wrap`) metin —
// bilgi tabanı kalemi, şablon gövdesi, yapay zekâ öneri kutusu, otomatik mesaj önizlemesi — boşluksuz uzun dizgiyi (Google Haritalar bağlantısı,
// 160+ karakter) BÖLMÜYORDU: bilgi tabanı kartında bağlantı "…google.com/maps/plac"ta kesiliyor, geri kalanı görünmüyordu (scrollWidth 1289,
// kutu 237). `break-words` (overflow-wrap: break-word) yalnız sığmayan sözcüğü böler; normal metin aynı kalır. Mesaj baloncukları zaten böyleydi.
// jsdom düzen hesaplamaz → sınıf sözleşmesi kaynak taramasıyla pinlenir (aynı gerekçe: `tailwind-class-validity.test.ts`).
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

const PRESERVES_LINES = /\bwhitespace-pre-(wrap|line)\b/;
const BREAKS_LONG_WORDS = /\bbreak-(words|all)\b|\[overflow-wrap:|\[word-break:/;

describe("satır sonunu koruyan metin uzun sözcüğü böler", () => {
  const sites = walk(SRC).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ where: `${relative(process.cwd(), file)}:${i + 1}`, line }))
      .filter(({ line }) => PRESERVES_LINES.test(line)),
  );

  it("tarama boş değil (anti-vakum: bugün 28 yer)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(25);
  });

  it("her `whitespace-pre-wrap` / `-pre-line` aynı sınıf dizisinde sözcük bölme taşır", () => {
    const missing = sites.filter(({ line }) => !BREAKS_LONG_WORDS.test(line)).map(({ where }) => where);
    expect(missing).toEqual([]);
  });
});
