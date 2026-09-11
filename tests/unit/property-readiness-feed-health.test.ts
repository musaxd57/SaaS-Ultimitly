import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// MÜLK KARTI ROZETİ — BOZUK BESLEME "HAZIR" DİYORDU
// (kurucu, 2026-09-11: "bozuk besleme yeşil 'hazır' → düzelt").
//
// 🚨 ÖLÇÜLEN KÖK NEDEN: ölçüt satırın VARLIĞIYDI —
//     done: Boolean(p.hospitableId) || p._count.calendarSources > 0
// Sorgu `lastStatus` / `lastSyncedAt` alanlarını ÇEKMİYORDU bile. Kalıcı olarak
// bozuk bir besleme (`lastStatus:"error"`) "5/5 hazır" YEŞİLİNİ üretiyor ve
// `title` ipucu "kanal bağlantısı tamam" diyordu.
//
// Ayırt edilen durum sayısı: liste rozeti 4'ün **0**'ını ayırıyordu. (Mülk
// DETAY sayfası 4'ün 2'sini ayırıyor — `calendar-sources.tsx` hata/başarı —
// yani veri ZATEN vardı, liste onu okumuyordu.)
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const PAGE = "src/app/(app)/properties/page.tsx";

describe("mülk kartı — besleme sağlığı", () => {
  it("🚨 sorgu besleme SAĞLIĞINI çeker (eskiden yalnız satır SAYIYORDU)", () => {
    const s = read(PAGE);
    expect(s).toMatch(/calendarSources:\s*\{\s*select:\s*\{[^}]*lastStatus/);
    expect(s).toMatch(/calendarSources:\s*\{\s*select:\s*\{[^}]*lastSyncedAt/);
  });

  it("🚨 BOZUK besleme 'tamam' SAYILMAZ — kanal maddesi sağlığa bağlı", () => {
    const s = read(PAGE);
    // Eski ölçüt: yalnız varlık. Geri gelirse KIRMIZI.
    expect(s).not.toMatch(
      /done:\s*Boolean\(p\.hospitableId\)\s*\|\|\s*p\._count\.calendarSources\s*>\s*0\s*\}/,
    );
    expect(s).toMatch(/done:\s*hasChannel\s*&&\s*broken\s*===\s*0/);
  });

  it("🚨 ÜÇÜNCÜ HÂL görünür: bozuk besleme 'hazır' DEMEZ", () => {
    const s = read(PAGE);
    expect(s).toContain("Takvim beslemesi hatalı");
    // Rozet üç dallı (bozuk / hepsi tamam / eksik) — iki dal yetmiyordu.
    expect(s).toMatch(/ready\.broken\s*>\s*0[\s\S]{0,120}bg-destructive/);
  });

  it("'hiç senkron olmadı' AYRI bir hâl (bağlantı var, veri akmamış)", () => {
    const s = read(PAGE);
    expect(s).toMatch(/never\s*=\s*p\.calendarSources\.filter/);
    expect(s).toContain("henüz ilk kez senkronlanmadı");
    // Bozukken bu satır çizilmez — iki mesaj üst üste binmesin.
    expect(s).toMatch(/ready\.never\s*>\s*0\s*&&\s*ready\.broken\s*===\s*0/);
  });

  it("anti-vakum: 'error' işareti ürünün GERÇEKTEN yazdığı değer", () => {
    // Yazan yer: iCal senkronu. Bu satır olmadan rozet hiç tetiklenmeyen bir
    // sabiti arıyor olabilirdi.
    expect(read("src/lib/import/sync.ts")).toMatch(/lastStatus:\s*"error"/);
  });
});
