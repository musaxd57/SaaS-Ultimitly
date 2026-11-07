import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { guestCheckoutRelation, guestCheckoutNote } from "@/lib/guest-checkout-time";

// ---------------------------------------------------------------------------
// DİLİM 7a/7b (C-9) — misafirin YAZDIĞI çıkış saati bir BEYANDIR, onay değil. Cevap modelinin çıkardığı saat
// rezervasyona yazılır (`guestCheckoutTime`) ve üç yerde okunur: istem, pano, erken giriş (yalnız sıkılaştırır).
// "13:00'te çıkabilir miyiz?" gibi bir İSTEK de bu alana düşebilir; resmi çıkıştan SONRAKİ saat onaylanmamış bir geç
// çıkıştır ve hiçbir yüzey onu esas saat gibi sunmaz.
// ---------------------------------------------------------------------------

describe("misafirin çıkış saati ↔ resmi çıkış", () => {
  it("resmi saatten önce / aynı / sonra; tek haneli saat de okunur", () => {
    expect(guestCheckoutRelation("09:00", "11:00")).toBe("earlier");
    expect(guestCheckoutRelation("9:00", "11:00")).toBe("earlier");
    expect(guestCheckoutRelation("11:00", "11:00")).toBe("same");
    expect(guestCheckoutRelation("11:01", "11:00")).toBe("later");
    expect(guestCheckoutRelation("13:00", "11:00")).toBe("later");
  });

  it("misafir saati yoksa / okunamıyorsa ilişki YOK; resmi saat okunamıyorsa 'bilinmiyor' (temkinli okunur)", () => {
    expect(guestCheckoutRelation(null, "11:00")).toBeNull();
    expect(guestCheckoutRelation(undefined, "11:00")).toBeNull();
    expect(guestCheckoutRelation("öğlen", "11:00")).toBeNull();
    expect(guestCheckoutRelation("13:00", null)).toBe("unknown");
    expect(guestCheckoutRelation("13:00", "11.00")).toBe("unknown");
  });
});

describe("pano notu — resmi saat esas, misafirin saati ikincil", () => {
  it("resmi saatten SONRAKİ saat uyarı tonunda; önceki saat nötr; aynı saat not üretmez", () => {
    expect(guestCheckoutNote("13:00", "11:00")).toEqual({
      text: "Misafir 13:00 dedi",
      warn: true,
      hint: "Resmi çıkış saatinden sonra. Geç çıkışı siz onaylamadıysanız resmi saat geçerlidir.",
    });
    expect(guestCheckoutNote("9:00", "11:00")).toEqual({ text: "Misafir 09:00 dedi", warn: false, hint: null });
    expect(guestCheckoutNote("11:00", "11:00")).toBeNull();
    expect(guestCheckoutNote(null, "11:00")).toBeNull();
  });

  it("resmi saat okunamıyorsa misafirin saati uyarı tonunda gösterilir (sonra olabilir)", () => {
    expect(guestCheckoutNote("13:00", "")?.warn).toBe(true);
  });
});

describe("yüzeyler — misafirin saati hiçbir ekranda esas saat yerine geçmez (mekanik pin)", () => {
  // Bu depoda sunucu bileşeni render testi yok; bağlantı kaynak düzeyinde pinlenir (demo-ui-gating ile aynı yol).
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });

  it("pano bugünkü çıkışlarda resmi saati gösterir, misafirin saatini yalnız not olarak", () => {
    const src = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(src).toContain("guestCheckoutNote(r.guestCheckoutTime, r.property.checkOutTime)");
    expect(src).toContain("{r.property.checkOutTime}</span>");
  });

  it("hiçbir ekran/bileşen 'misafirin saati ?? resmi saat' biçiminde esas saat seçmez", () => {
    const offenders = [...files("src/app"), ...files("src/components")].filter((f) =>
      /guestCheckoutTime\s*\?\?/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    // Anti-vakum: tarama gerçekten dosya okuyor (pano bu kümede).
    expect(files("src/app").some((f) => f.endsWith(join("dashboard", "page.tsx")))).toBe(true);
  });

  it("alanı okuyan HER ekran/rota bilinçli listede — yeni yüzey `guestCheckoutNote`tan geçip buraya eklenir (inceleme 09-24)", () => {
    // `??` taraması `||`, üçlü ifade ya da yardımcıyla kaçırılabilirdi. Liste: pano (not biçimi) + öneri rotası (isteme
    // gider; istem satırı `guestCheckoutPromptLine`ta).
    const ALLOWED = [join("app", "(app)", "dashboard", "page.tsx"), join("app", "api", "conversations", "[id]", "ai-suggest", "route.ts")];
    const readers = [...files("src/app"), ...files("src/components")]
      .filter((f) => readFileSync(f, "utf8").includes("guestCheckoutTime"))
      .map((f) => f.replace(/^src[\\/]/, ""));
    expect(readers.sort()).toEqual([...ALLOWED].sort());
  });
});
