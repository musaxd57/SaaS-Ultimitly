// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LEGAL_LAST_UPDATED, LEGAL_VERSION, SELLER, SELLER_TAX_LABEL, legalDateTr } from "@/lib/legal-entity";
import { SECTIONS as GIZLILIK } from "@/app/(legal)/gizlilik/content";
import { SECTIONS as MESAFELI } from "@/app/(legal)/mesafeli-satis/content";
import { SECTIONS as ON_BILGI } from "@/app/(legal)/on-bilgilendirme/content";
import { SECTIONS as KOSULLAR } from "@/app/(legal)/kosullar/content";
import { SECTIONS as GUVENLIK } from "@/app/(legal)/guvenlik/content";
import KosullarPage from "@/app/(legal)/kosullar/page";
import OnBilgilendirmePage from "@/app/(legal)/on-bilgilendirme/page";

// ---------------------------------------------------------------------------
// UX-6 (kurucu 11-13: "hepsine dokunabilirsin … en sonda avukata gene bakarız") — yasal sayfalar:
//  · Tarih gün-ay-yıl ve SÜRÜMDEN türetilir ("Kasım 2026" ay sonunu / ileri tarihi işaret ediyor gibi okunuyordu; iki sabit elle
//    eşitleniyordu).
//  · Türkiye'ye özgü "MERSİS" etiketi yanlıştı: satıcı İtalya'da kayıtlı şahıs işletmesi, numara İtalya KDV numarası (Partita IVA).
//  · Ön bilgilendirme md. 8 yalnız "aylık dönem" diyordu; yıllık plan satılıyor.
//  · Cayma: md. 10 "14 gün hak var", md. 11 "sona erebilir" birbirinden habersiz okunuyordu → md. 10 istisnaya yollar; "riski ortadan
//    kaldırmak için … önerilir" belirsizliği kalktı. Hukuki ÖZ değişmedi (istisna aynı; avukat incelemesi kurucuyla birlikte).
//  · Güvenlik sayfasında yayındaki "🚩 … avukat incelemesindedir" taslak notu kalktı (iyi niyet cümlesi kaldı).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const all = (sections: { body?: string[]; list?: string[] }[]) => sections.flatMap((s) => [...(s.body ?? []), ...(s.list ?? [])]).join("\n");
const section = (sections: { title: string; body?: string[] }[], prefix: string) => {
  const s = sections.find((x) => x.title.startsWith(prefix));
  expect(s, prefix).toBeDefined();
  return (s!.body ?? []).join("\n");
};

describe("UX-6 — tarih", () => {
  it("sürüm gün düzeyinde; görünen tarih ondan türetilir", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_LAST_UPDATED).toBe(legalDateTr(LEGAL_VERSION));
    expect(legalDateTr("2026-11-13")).toBe("13 Kasım 2026");
    expect(legalDateTr("2027-01-05")).toBe("5 Ocak 2027");
    expect(legalDateTr("2026-08-31")).toBe("31 Ağustos 2026");
  });

  it.each(["2026-11", "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-32", "13 Kasım 2026", ""])("biçim dışı sürüm atar: %s", (v) => {
    expect(() => legalDateTr(v)).toThrow(/YYYY-AA-GG/);
  });

  it("sayfalarda 'Son güncelleme: <gün ay yıl>' görünür", () => {
    for (const Page of [KosullarPage, OnBilgilendirmePage]) {
      const { container } = render(<Page />);
      expect(container.textContent).toContain(`Son güncelleme: ${legalDateTr(LEGAL_VERSION)}`);
      cleanup();
    }
  });
});

describe("UX-6 — satıcı kimliği", () => {
  it("🚩 hiçbir yasal metinde 'MERSİS' yok; vergi numarası her yerde aynı etiketle", () => {
    for (const s of [GIZLILIK, MESAFELI, ON_BILGI, KOSULLAR]) expect(all(s)).not.toMatch(/MERSİS/i);
    expect(SELLER_TAX_LABEL).toBe("Vergi No (Partita IVA, İtalya)");
    for (const s of [GIZLILIK, MESAFELI, ON_BILGI]) {
      expect(all(s).split(`${SELLER_TAX_LABEL}: ${SELLER.vergiNo}`).length - 1).toBe(1);
    }
  });

  it("numara İtalya KDV numarası biçiminde (11 hane, denetim hanesi tutuyor)", () => {
    const d = [...SELLER.vergiNo].map(Number);
    expect(d).toHaveLength(11);
    const sum = d.slice(0, 10).reduce((acc, x, i) => acc + (i % 2 === 0 ? x : x * 2 > 9 ? x * 2 - 9 : x * 2), 0);
    expect((10 - (sum % 10)) % 10).toBe(d[10]);
  });

  it("satıcının yurt dışında kayıtlı olduğu açıkça yazar (ön bilgilendirme + sözleşme)", () => {
    expect(section(ON_BILGI, "1.")).toContain("Satıcı, İtalya'da kayıtlı bir şahıs işletmesidir.");
    expect(section(MESAFELI, "1.")).toContain("İtalya'da kayıtlı bir şahıs işletmesidir.");
  });

  it("gizlilik iletişim adresi satıcı adresiyle tek kaynak", () => {
    expect(section(GIZLILIK, "2.")).toContain(`Gizlilikle ilgili her türlü talep ve sorunuz için: ${SELLER.eposta}`);
  });
});

describe("UX-6 — süre / yenilenme ve cayma", () => {
  it("ön bilgilendirme md. 8 yıllık planı da kapsar", () => {
    const md8 = section(ON_BILGI, "8.");
    expect(md8).toContain("(aylık veya yıllık)");
    expect(md8).toContain("yıllık planda yıllık dönemin");
    expect(md8).not.toContain("seçilen aylık dönem");
  });

  it.each([
    ["ön bilgilendirme", ON_BILGI],
    ["mesafeli satış", MESAFELI],
  ])("%s: md. 10 istisnaya (md. 11) yollar; md. 11'de belirsiz 'önerilir / bu nedenle' yok, istisnanın özü aynı", (_n, s) => {
    expect(section(s, "10.")).toContain("11. maddededir");
    const md11 = section(s, "11.");
    expect(md11).not.toMatch(/riski ortadan kaldırmak|önerilir|Bu nedenle ücretsiz/);
    expect(md11).toContain("15. maddesi");
    expect(md11).toContain("14 günlük ücretsiz deneme süresini kullanabilir");
  });
});

describe("UX-6 — güvenlik sayfası taslak notu", () => {
  it("yayındaki metinde 'avukat incelemesinde' / bayrak yok; iyi niyet cümlesi duruyor", () => {
    const text = all(GUVENLIK);
    expect(text).not.toMatch(/avukat incelemesinde|🚩/);
    expect(text).toContain("lehinize yorumlanmasını isteriz");
  });
});
