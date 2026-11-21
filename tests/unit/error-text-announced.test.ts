import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Sonradan beliren hata yazısı DUYURULUR (FB tur 2, 11-20 gece). Müşteri bileşenlerinde 38 yerde hata `{error ? <p className="…
// text-destructive">{error}</p> : null}` diye basılıyor, `role="alert"` taşımıyordu: kaydetme düştüğünde ekran okuyucu kullanan ev sahibi
// (ve sohbet kodunu yanlış giren misafir) HİÇBİR ŞEY duymuyordu — düğmeye bastı, sayfa sessiz. `FormError` ve `Field` bunu zaten yapıyor;
// bu pin elle basılan satırların da yapmasını ister.
//
// Kapsam: KOŞULLA beliren (`x ? <p …>` / `x && <p …>` / `x ? (` + alt satır) ve kırmızı yazı sınıfı taşıyan `p` / `span`.
// Kapsam dışı (izinli): sayfa açılışında zaten duran DURUM yazıları — her kartta / satırda tekrarlandığı için duyuru yağmuru olurdu.
// Operatör paneli (`components/admin`) kapsam dışı. Kaynak taraması tek yönlüdür; davranış pini `tests/ui/guest-chat.test.tsx`
// (sohbet kodu) ve `tests/ui/form-field-a11y.test.tsx`.

const ROOT = "src/components";
const INLINE = /(?:\?|&&)\s*<(?:p|span) (?![^>\n]*role=)[^>\n]*className="[^"\n]*text-destructive/;
const NEXT_LINE = /^\s*<(?:p|span) (?![^>\n]*role=)[^>\n]*className="[^"\n]*text-destructive/;

/** Açılışta duran durum yazıları (hata olayı değil): dosya + satır parçası. */
const STATE_TEXT: { file: string; snippet: string }[] = [
  { file: "src/components/tasks/task-board.tsx", snippet: "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" }, // eski "Yapılamıyor" kaydı, kart başına
  { file: "src/components/properties/calendar-file-import.tsx", snippet: '<span className="text-destructive">{r.error}</span>' }, // önizleme satırı başına
  { file: "src/components/inbox/decision-panel.tsx", snippet: '<p className="text-xs text-destructive">' }, // "gönderim doğrulanamadı" kart durumu
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "admin") walk(p, out);
    } else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("koşulla beliren hata yazısı duyurulur (role=alert)", () => {
  const files = walk(ROOT);

  it("anti-vakum: tarama dosya okudu; kalıplar eski ve yeni biçimi doğru ayırıyor", () => {
    expect(files.length).toBeGreaterThan(80);
    expect(INLINE.test('{error ? <p className="text-xs text-destructive">{error}</p> : null}')).toBe(true);
    expect(INLINE.test('{error && <span className="text-xs text-destructive">{error}</span>}')).toBe(true);
    expect(INLINE.test('{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}')).toBe(false);
    expect(INLINE.test('{error ? <p id="e" role="alert" className="text-xs text-destructive">{error}</p> : null}')).toBe(false);
    expect(NEXT_LINE.test('            <p className="mt-1 text-xs text-destructive">{noteError}</p>')).toBe(true);
    for (const s of STATE_TEXT) expect(readFileSync(s.file, "utf8"), s.file).toContain(s.snippet);
  });

  it("duyurusuz hata satırı yok (izinli: açılışta duran durum yazıları)", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const conditionalAbove = /(?:\?|&&)\s*\($/.test(lines[i - 1] ?? "");
        if (!(INLINE.test(line) || (conditionalAbove && NEXT_LINE.test(line)))) return;
        if (STATE_TEXT.some((s) => s.file === file && line.includes(s.snippet))) return;
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 130)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
