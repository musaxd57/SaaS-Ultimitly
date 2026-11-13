import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// UX DENETİMİ 11-13 — METİN DEĞİŞTİRMEYEN İKİNCİ GÖRSEL DİLİM (İE-2; kayıt `docs/INCELEME-2026-11-13-ux-denetimi.md` §4 #13–#15, D048).
//
// Hiçbir yazı değişmedi. Bu dosya bir KAYNAK TARAMASIDIR (jsdom yerleşim hesaplamaz); amacı aşağıdaki sınıfların / işaretlerin sessizce geri
// alınmasını engellemektir. Davranış (görünen metin, ekran okuyucu) `tests/ui/ux-visual-slice-2.test.tsx` içinde.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("yıkıcı düğme komşusundan ayrıldı (C010, C048) — onay pencereleri zaten vardı", () => {
  it("konuşma: Sil düğmesi geri düğmesinden fazladan 16 px uzakta", () => {
    expect(read("src/components/inbox/delete-conversation-button.tsx")).toMatch(/<Button variant="outline" size="sm" onClick=\{remove\} disabled=\{busy\} className="ml-4">/);
  });
  it("daire: Mülkü sil, Geri'den fazladan 16 px uzakta; onay metni aynı", () => {
    const src = read("src/app/(app)/properties/[id]/page.tsx");
    expect(src).toContain('className="ml-4 border border-destructive/40 bg-transparent text-destructive shadow-none hover:bg-destructive/10"');
    expect(src).toContain('label="Mülkü sil"');
  });
});

describe("menüde kaydırma gölgesi (C058)", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf(".scroll-fade-y {"), css.indexOf("}", css.indexOf(".scroll-fade-y {")));

  it("menünün kaydırılan alanı gölge sınıfını taşır", () => {
    expect(read("src/components/shell/app-shell.tsx")).toContain('className="scroll-fade-y mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"');
  });
  it("gölge saf CSS: iki `local` örtü + iki `scroll` gölge, renkler tema belirteçlerinden (açık / koyu)", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block.match(/no-repeat local/g)).toHaveLength(2);
    expect(block.match(/no-repeat scroll/g)).toHaveLength(2);
    expect(block).toContain("hsl(var(--card))");
    expect(block).toContain("hsl(var(--foreground) / 0.14)");
    // Yerleşime dokunmaz: kenar boşluğu / dolgu / yükseklik yok (menünün yükseklik bütçesi `app-shell.tsx` `mt-4` yorumunda).
    expect(block).not.toMatch(/\b(?:margin|padding|height|min-height)\s*:/);
  });
});

describe("takvim: masaüstünde hareketsiz ay boş kalmaz (D048)", () => {
  const src = read("src/app/(app)/calendar/page.tsx");
  it("telefondaki boş durumun AYNI başlığı masaüstü ızgarasının üstünde de var (yeni yazı yok)", () => {
    expect(src.split("Bu ayda giriş veya çıkış yok").length - 1).toBe(2);
    expect(src).toContain('{agendaDays.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">Bu ayda giriş veya çıkış yok</p> : null}');
  });
});

describe("tıklanabilir kartlarda görsel ok (C002, C019, B035) — yalnız görsel, ekran okuyucudan gizli", () => {
  for (const [file, what] of [
    ["src/components/stat-card.tsx", "pano kutucukları (yalnız bağlantılı olanlar)"],
    ["src/app/(app)/properties/page.tsx", "daire kartları"],
    ["src/app/(app)/guest-chats/page.tsx", "QR sohbet listesi"],
  ] as const) {
    it(what, () => {
      const src = read(file);
      expect(src).toMatch(/import \{[^}]*\bChevronRight\b[^}]*\} from "lucide-react";/);
      expect(src).toMatch(/<ChevronRight className="[^"]*shrink-0[^"]*" aria-hidden="true" \/>/);
    });
  }
  it("kutucukta ok yalnız bağlantı varken", () => {
    expect(read("src/components/stat-card.tsx")).toContain('{href ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}');
  });
  it("ok eklenince ad yine sarılır (önceden de sarılıyordu); boşluksuz uzun ad da kırılır, ok ilk satırda durur", () => {
    const src = read("src/app/(app)/properties/page.tsx");
    expect(src).toContain('<h3 className="mt-3 flex items-start gap-1 font-semibold">');
    expect(src).toContain('<span className="min-w-0 break-words">{p.name}</span>');
  });
});
