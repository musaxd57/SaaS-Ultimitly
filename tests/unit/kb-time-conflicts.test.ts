import { describe, it, expect } from "vitest";
import { aiReadableForConflicts, kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { findTimeConflicts } from "@/lib/ai/prompts";
import { buildDemoDataset } from "@/lib/demo-tenant/dataset";

// ---------------------------------------------------------------------------
// "UYUŞMAYAN SAATLER" host raporu (P4-b ikinci yarısı). Kural `time-fields.ts`ten (tek kaynak);
// host raporu yalnız cümleciğin KENDİ adlandırdığı saatleri sayar (başlık ödüncü değil), misafir
// yolu temkinli tarafta kalır — bu fark bilinçli ve pinli.
// ---------------------------------------------------------------------------

const PROP = { checkInTime: "15:00", checkOutTime: "11:00" };
let n = 0;
const kb = (category: string, title: string, content: string) => ({ id: `k${++n}`, category, title, content });

describe("kbTimeConflicts — KB ↔ mülk ayarı", () => {
  it("çıkış kalemi 12:00, mülk ayarı 11:00 → tek satır; otomatik mesaj notu; sade metin", () => {
    const rows = kbTimeConflicts(PROP, [kb("checkout", "Çıkış", "Çıkış saati 12:00'dir; anahtarı masaya bırakın.")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "checkout", kind: "property", propertyValue: "11:00" });
    expect(rows[0].text).toBe("Çıkış saati: mülk ayarlarında 11:00, “Çıkış” bilgisinde 12:00 yazıyor. Doğru olan hangisiyse diğerini düzeltin.");
    expect(rows[0].sides[0]).toMatchObject({ values: ["12:00"], sentAutomatically: true, sentence: "Çıkış saati 12:00'dir" });
  });

  it("mülkle UYUMLU bilgi tabanı → satır YOK (iki saat bir arada, geç çıkış, erken giriş, aralık)", () => {
    expect(
      kbTimeConflicts(PROP, [
        kb("checkin", "Giriş", "Giriş 15:00, çıkış 11:00."),
        kb("checkout", "Çıkış", "Çıkış 11:00. Geç çıkış 13:00'e kadar ücretlidir."),
        kb("checkin", "Erken giriş", "Erken giriş 12:00'den itibaren mümkündür."),
        kb("checkin", "Giriş", "Giriş 15:00'ten itibaren, en geç 22:00'ye kadar yapılabilir."),
      ]),
    ).toEqual([]);
  });

  it("🚨 bilinçli fark: başlıktan ödünç saat host'a raporlanmaz ama misafir yolu temkinli davranır", () => {
    const item = kb("checkout", "Çıkış", "Saat 12:00'ye kadar daireyi boşaltın.");
    expect(kbTimeConflicts(PROP, [item])).toEqual([]);
    expect(findTimeConflicts({ name: "X", ...PROP }, [item])).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });

  it("mülk ayarıyla karşılaştırılan alan kalemler arasında TEKRAR raporlanmaz (tek satır)", () => {
    const rows = kbTimeConflicts(PROP, [kb("checkout", "Çıkış", "Çıkış 11:00'dir."), kb("rules", "Kurallar", "Çıkış saati 12:00'dir.")]);
    expect(rows.map((r) => `${r.kind}:${r.field}`)).toEqual(["property:checkout"]);
    expect(rows[0].sides.map((s) => s.title)).toEqual(["Kurallar"]);
  });

  it("kategori önemsiz: 'Ev kuralları' içindeki çıkış saati de raporlanır (otomatik mesaj DEĞİL)", () => {
    const rows = kbTimeConflicts(PROP, [kb("rules", "Ev kuralları", "Sigara içilmez. Çıkış saati 12:00'dir.")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sides[0].sentAutomatically).toBe(false);
  });
});

describe("kbTimeConflicts — KB ↔ KB", () => {
  it("sessiz saat 23:00 ↔ 22:00 → iki taraflı satır", () => {
    const rows = kbTimeConflicts(PROP, [
      kb("rules", "Ev kuralları", "Sessiz saatler 23:00'te başlar."),
      kb("rules", "Gürültü", "Sessiz saatler 22:00'de başlar."),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "quiet_hours", kind: "items" });
    expect(rows[0].sides.map((s) => s.title)).toEqual(["Ev kuralları", "Gürültü"]);
    expect(rows[0].text).toBe("Sessiz saatler: “Ev kuralları” bilgisinde 23:00, “Gürültü” bilgisinde 22:00 yazıyor. Misafire yanlış saat söylenebilir; birini düzeltin.");
  });

  it("inceltme çelişki DEĞİL ('22:00-08:00' ↔ '22:00'); farklı alanlar karşılaştırılmaz (havuz ↔ kahvaltı)", () => {
    expect(
      kbTimeConflicts(PROP, [
        kb("rules", "Sessiz saatler", "Sessiz saatler 22:00-08:00 arasıdır."),
        kb("rules", "Gürültü", "Sessiz saatler 22:00'de başlar."),
        kb("general", "Havuz", "Havuz 09:00-20:00 arası açıktır."),
        kb("general", "Kahvaltı", "Kahvaltı 08:00'de servis edilir."),
      ]),
    ).toEqual([]);
  });

  it("mülk ayarı SS:DD değilse giriş/çıkış kalemler ARASINDA karşılaştırılır", () => {
    const rows = kbTimeConflicts({ checkInTime: "öğleden sonra", checkOutTime: "11:00" }, [
      kb("checkin", "Giriş", "Giriş 14:00'ten itibaren."),
      kb("general", "Bilgiler", "Giriş saati 16:00'dır."),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "checkin", kind: "items" });
  });
});

describe("kapsam = AI'ın okuduğu kalemler", () => {
  it("pasif, taslak ve halefi kümede olan kalem RAPORA GİRMEZ; legacy/approved girer", () => {
    const base = { category: "checkout", title: "Çıkış", content: "Çıkış 12:00'dir.", updatedAt: new Date(0) };
    const all = [
      { ...base, id: "a", isActive: true, reviewState: "approved", supersededById: null },
      { ...base, id: "b", isActive: false, reviewState: "approved", supersededById: null },
      { ...base, id: "c", isActive: true, reviewState: "draft", supersededById: null },
      { ...base, id: "d", isActive: true, reviewState: "legacy", supersededById: "a" },
      { ...base, id: "e", isActive: true, reviewState: "legacy", supersededById: null },
    ];
    expect(aiReadableForConflicts(all).map((i) => i.id)).toEqual(["a", "e"]);
  });
});

describe("demo hesabı temiz", () => {
  it("🚨 demo veri kümesinin hiçbir mülkünde uyuşmayan saat yok (inceleme ekibi sahte uyarı görmez)", () => {
    const ds = buildDemoDataset({ now: new Date("2026-10-01T09:30:00Z") });
    for (const p of ds.properties) {
      const items = ds.kbItems.filter((k) => k.propertyId === p.id);
      expect(kbTimeConflicts(p, items), p.name).toEqual([]);
      expect(findTimeConflicts({ name: p.name, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime }, items), p.name).toEqual([]);
    }
  });
});
