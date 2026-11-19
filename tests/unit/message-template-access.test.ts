import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// MESAJ ŞABLONU TABLOSUNA ERİŞİM — KAPALI LİSTE (kurucu 11-19 akşam madde 1; tasarım `docs/TASARIM-2026-11-19-sablon-listesi-ve-sinir.md`).
//
// YAZICI: tabloya şablon EKLEYEN her yol işletme başına sınır kapısından geçer (`lib/template-cap.ts`). Kurucu: "Kopyalama / içe aktarma uçları
// da aynı kapıdan geçer" — bugün öyle bir uç yok; ileride biri `messageTemplate.create` yazarsa bu test kırmızı olur: kapıyı kullan ya da
// gerekçeyi listeye yaz (liste EŞİTLİĞİ — eklemek de çıkarmak da bilinçli karar). Tarama yorumsuz kod üzerinde; davranışın kendisi
// `tests/integration/template-cap*.test.ts`te.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Yorumlar kod sayılmasın (`api-route-scoping.test.ts` ile aynı kaba ayıklama). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");
}

const sources = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  code: stripComments(readFileSync(file, "utf8")),
}));

function filesMatching(re: RegExp): string[] {
  return sources.filter((s) => re.test(s.code)).map((s) => s.rel).sort();
}

const ALLOWED_CREATORS: Record<string, string> = {
  "lib/template-cap.ts": "tek kapı: işletme başına danışma kilidi altında say + yaz (`createTemplateWithinCap`)",
  "lib/demo-tenant/apply-core.ts": "demo sıfırlaması (sistem işi): önce demo işletmesinin bütün şablonlarını siler, sabit küçük veri kümesini yazar",
};

describe("mesaj şablonu tablosu — yazıcılar", () => {
  const creators = filesMatching(/\.messageTemplate\s*\.\s*(?:create|createMany|upsert)\s*\(/);

  it("anti-vakum: tarama kaynak dosyalarını ve bilinen yazıcıyı gerçekten buluyor", () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(creators).toContain("lib/template-cap.ts");
  });

  it("şablon EKLEYEN her yol kapalı listede (yeni kopyalama / içe aktarma ucu sınır kapısını atlayamaz)", () => {
    expect(creators).toEqual(Object.keys(ALLOWED_CREATORS).sort());
  });

  it("şablon ekleme rotası tabloya doğrudan yazmaz, kapıyı çağırır", () => {
    const route = sources.find((s) => s.rel === "app/api/templates/route.ts")!;
    expect(route.code).toMatch(/createTemplateWithinCap\(/);
    expect(route.code).not.toMatch(/messageTemplate\s*\.\s*create/);
  });
});
