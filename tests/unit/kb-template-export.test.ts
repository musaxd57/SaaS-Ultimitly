import { describe, it, expect } from "vitest";
import { kbTemplateText } from "@/lib/kb-import/template";
import { renderKbExport } from "@/lib/kb-export";
import { planDocumentImport, splitDocument } from "@/lib/kb-import/document";

// ---------------------------------------------------------------------------
// BİLGİ TABANI ŞABLONU + DIŞA AKTARMA (kurucu 10-28, §7-A (2) ve (3)). İkisi de içe aktarıcının (`planDocumentImport`) okuduğu biçimde:
// boş şablon HİÇ taslak üretmez; doldurulan satır başlığının konusuna düşer; dışa aktarılan dosya yeniden yüklenince aynı içerik + konu.
// ---------------------------------------------------------------------------
const plan = (text: string) => planDocumentImport([{ page: 1, text }]);

describe("şablon", () => {
  it("🚨 boş şablon hiç taslak üretmez (boşluklar yer tutucu → atlanır); açıklama paragrafı yok", () => {
    for (const lang of ["tr", "en"] as const) {
      const p = plan(kbTemplateText(lang));
      expect([lang, p.drafts]).toEqual([lang, []]);
      expect(p.skipped.every((s) => s.reason === "placeholder" || s.reason === "property_field")).toBe(true);
    }
  });

  it("🚨 doldurulan satır doğru konuya düşer; erişim satırı Giriş Talimatı'na; boş kalan satır atlanır", () => {
    const filled = kbTemplateText("tr")
      .replace("Ağ adı: ____", "Ağ adı: LaleNet")
      .replace("Wi-Fi şifresi: ____", "Wi-Fi şifresi: abc12345")
      .replace("Anahtar / kapı kodu nasıl alınır: ____", "Anahtar / kapı kodu nasıl alınır: Anahtar kutusu kapının solunda, kod size mesajla gelir.")
      .replace("Otopark var mı, nerede, ücretli mi: ____", "Otopark var mı, nerede, ücretli mi: Ücretsiz, 12 numaralı yer.")
      .replace("Evcil hayvan: ____", "Evcil hayvan: Kabul edilmez.");
    const byCat = Object.fromEntries(plan(filled).drafts.map((d) => [d.category, d.content]));
    expect(byCat.wifi).toBe("Ağ adı: LaleNet\n\nWi-Fi şifresi: abc12345");
    expect(byCat.checkin).toContain("Anahtar kutusu kapının solunda");
    expect(byCat.parking).toBe("Otopark var mı, nerede, ücretli mi: Ücretsiz, 12 numaralı yer.");
    expect(byCat.rules).toBe("Evcil hayvan: Kabul edilmez.");
    expect(Object.keys(byCat).sort()).toEqual(["checkin", "parking", "rules", "wifi"]);
  });

  it("İngilizce şablon da doldurulunca konusuna düşer", () => {
    const filled = kbTemplateText("en").replace("Wi-Fi password: ____", "Wi-Fi password: abc12345").replace("Where does the trash go: ____", "Where does the trash go: Bins at the entrance.");
    const cats = plan(filled).drafts.map((d) => d.category).sort();
    expect(cats).toEqual(["trash", "wifi"]);
  });
});

describe("dışa aktarma", () => {
  const items = [
    { category: "wifi", title: "Wi-Fi", content: "Ağ: LaleNet\nŞifre: abc12345" },
    { category: "parking", title: "Otopark", content: "Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır." },
    { category: "rules", title: "Sigara ve evcil hayvan kuralları hakkında bilmeniz gerekenler", content: "Dairede sigara içilmez." },
  ];

  it("biçim: daire başlığı, kalem başlığı (uzun başlık → kategori adı), içerik AYNEN; boş daire yazılmaz", () => {
    const text = renderKbExport([{ name: "Lale 1", items }, { name: "Lale 2", items: [] }]);
    expect(text).toBe(
      "# Lale 1\n\n## Wi-Fi\n\nAğ: LaleNet\nŞifre: abc12345\n\n## Otopark\n\nOtopark ücretsizdir; 12 numaralı yer size ayrılmıştır.\n\n## Ev Kuralları\n\nDairede sigara içilmez.\n",
    );
    expect(renderKbExport([])).toBe("");
  });

  it("🚨 dışa aktarılan dosya yeniden yüklenince: daire başlığı taslak OLMAZ, içerik aynı, konu aynı", () => {
    const p = plan(renderKbExport([{ name: "Lale 1", items }]));
    expect(p.drafts.map((d) => [d.category, d.content])).toEqual([
      ["wifi", "Ağ: LaleNet\nŞifre: abc12345"],
      ["parking", "Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır."],
      ["rules", "Dairede sigara içilmez."],
    ]);
    // Daire başlığı ("# Lale 1") bir ÜST başlık olarak kalır (Genel taslağa düşmez).
    expect(splitDocument([{ page: 1, text: renderKbExport([{ name: "Lale 1", items }]) }]).blocks[0]).toMatchObject({ kind: "heading" });
  });

  it("KONTROL: düz (Markdown olmayan) art arda iki başlıkta eski kural aynen — ilki gövde sayılır", () => {
    const d = splitDocument([{ page: 1, text: "Otopark:\n\nÇöp:\n\nÇöpler kapının önüne." }]);
    expect(d.blocks[0]).toMatchObject({ kind: "body", text: "Otopark:" });
  });
});
