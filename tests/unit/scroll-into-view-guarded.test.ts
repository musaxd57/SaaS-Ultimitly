import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// `scrollIntoView` HER ZAMAN KORUMALI ÇAĞRILIR (`?.(`) — KAYNAK PİNİ (10-18).
//
// NEDEN: jsdom'da `Element.prototype.scrollIntoView` YOK. Çağrılar çoğunlukla `requestAnimationFrame` içinde → React hata sınırı
// yakalamaz, test koşusu "unhandled error" ile kırılır ve kırılma ZAMANLAMAYA bağlıdır (kare testin bitiminden sonraya kalırsa
// yerelde yeşil, CI'da kırmızı). Ders iki kez yaşandı: template-manager (09-11, tam suit üç hata) ve kb-manager (CI #1539, 10-18).
// Davranış testleri ilgili ekranlarda (kb-create-request-id-screens, settings-sections); bu pin YENİ bir korumasız çağrının
// gelmesini engeller. Tarayıcılarda yöntem var; korumalı çağrı orada aynı davranır.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(path.join(ROOT, "src"));
const calls = files.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) => (/\.scrollIntoView\b/.test(line) ? [{ where: `${path.relative(ROOT, file).split(path.sep).join("/")}:${i + 1}`, line: line.trim() }] : [])),
);

describe("scrollIntoView korumalı çağrı pini", () => {
  it("src altında korumasız `scrollIntoView(` çağrısı yok", () => {
    const unguarded = calls.filter((c) => /\.scrollIntoView\s*\(/.test(c.line));
    expect(unguarded).toEqual([]);
  });

  it("anti-vakumluk: tarama gerçekten çalışıyor (bilinen korumalı çağrılar bulunuyor)", () => {
    expect(files.length).toBeGreaterThan(100);
    const guarded = calls.filter((c) => /\.scrollIntoView\?\.\(/.test(c.line)).map((c) => c.where.split(":")[0]);
    expect(guarded).toEqual(expect.arrayContaining(["src/components/knowledge/kb-manager.tsx", "src/components/templates/template-manager.tsx"]));
  });
});
