import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Soluk yazı pini (FB gezisi 11-20 akşam, gerçek uygulamada axe ile ölçüldü): metin taşıyan bir öğeye `opacity-40…70` verilince
// yazının karşıtlığı WCAG AA'nın (4,5:1) altına iner — iptal rezervasyon kartı 2,5–4,1:1, "Gönderilenler" sekme sayaçları 2,95:1 çıkmıştı.
// "Etkin değil / ikincil" ayrımı renk belirteciyle (`text-muted-foreground`, `INACTIVE_CARD_CLASS`) yapılır, saydamlıkla değil.
// Durum öneki taşıyan kullanım (`disabled:opacity-50`, `hover:…`, `group-hover:…`, `data-[…]:…`) kapsam DIŞI: etkileşimsiz / geçici durum.
// Kaynak taraması tek yönlüdür (sınıf başka yoldan da solabilir); ölçümün kendisi gezi raporundadır.

const ROOTS = ["src/app", "src/components"];
/** Yalnız süs olan (metin taşımayan) öğeler — dosya + satır parçası birlikte eşleşmeli. */
const DECORATIVE: { file: string; snippet: string }[] = [
  { file: "src/components/inbox/conversation-thread.tsx", snippet: '<ChevronDown className="size-3.5 opacity-60" />' },
  // Yalnız simge taşıyan kapatma düğmeleri (çarpı): metin yok, üstüne gelince tam opak.
  { file: "src/components/billing/trial-banner.tsx", snippet: "rounded-md opacity-70 hover:bg-black/5" },
  { file: "src/components/settings/test-email-button.tsx", snippet: "rounded p-0.5 opacity-70 hover:opacity-100" },
  { file: "src/components/toaster.tsx", snippet: "rounded p-0.5 opacity-70 transition-opacity hover:opacity-100" },
  // Devre dışı sayfalama oku: `aria-hidden`, etkileşimsiz (devre dışı denetim karşıtlık kuralının dışındadır).
  { file: "src/components/pager.tsx", snippet: "devre dışı olan da `text-muted-foreground/40` ile" }, // yorum: eski hâlin anlatımı
  { file: "src/components/pager.tsx", snippet: '<span aria-hidden="true" className={cn(BASE, "border-border/60 bg-muted/40 text-muted-foreground/70")}>' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// Önek yok: sınıfın hemen solunda `:` (durum öneki) ya da sözcük / tire karakteri bulunmaz.
// İkinci biçim: yazı renginin kendisine saydamlık (`text-muted-foreground/70` → "Görev yok" 2,84:1 ölçüldü).
const FADED = /(?<![:\w-])(?:opacity-(?:40|50|60|70)|text-muted-foreground\/(?:30|40|50|60|70))(?![\w-])/;

describe("soluk yazı (opacity ile metin soldurma) yok", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("anti-vakum: tarama gerçekten dosya okudu ve bilinen süs kullanımını görüyor", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const d of DECORATIVE) expect(readFileSync(d.file, "utf8")).toContain(d.snippet);
    expect(FADED.test('className="size-3.5 opacity-60"')).toBe(true);
    expect(FADED.test('className="disabled:opacity-50 hover:opacity-70 group-hover:opacity-60"')).toBe(false);
    expect(FADED.test('className="text-xs text-muted-foreground/70"')).toBe(true);
    expect(FADED.test('className="placeholder:text-muted-foreground/60 text-muted-foreground"')).toBe(false);
  });

  it("metin taşıyan hiçbir öğe opacity-40…70 ile soldurulmaz (izinli: yalnız süs simgeleri)", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!FADED.test(line)) return;
        if (DECORATIVE.some((d) => d.file === file && line.includes(d.snippet))) return;
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
