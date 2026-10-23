import { describe, it, expect } from "vitest";
import {
  assembleDrafts,
  draftIsVerbatim,
  headingText,
  KB_IMPORT_ITEM_MAX_CHARS,
  KB_IMPORT_MAX_CHARS,
  KB_IMPORT_MAX_PAGES,
  KB_IMPORTABLE_CATEGORIES,
  normalizeDocText,
  planDocumentImport,
  sectionByHeadings,
  splitDocument,
} from "@/lib/kb-import/document";

// ---------------------------------------------------------------------------
// DOSYADAN BİLGİ TABANI TASLAĞI — çekirdek (10-23 öğle; tasarım `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §4).
// İki değişmez: model / ayırıcı BİLGİ YAZAMAZ (taslak belgenin paragraflarının aynen birleşimi) · her paragraf hesap verir (sessiz kayıp yok).
// Fikstür kurgusal "Lale" dairesi.
// ---------------------------------------------------------------------------

const GUIDE = [
  {
    page: 1,
    text:
      "# Lale Ev Rehberi\n\nHoş geldiniz! Aşağıda konaklamanız için gerekli bilgiler var.\n\nWİ-Fİ\n\nAğ adı Lale-5G, şifre Lale2025.\n\n" +
      "Otopark:\n\nOtopark ücretsizdir; 12 numaralı yer size ayrılmıştır.\nAraç girişi bina arkasından.",
  },
  {
    page: 2,
    text:
      "Giriş saati 15:00, çıkış saati 11:00.\n\nÇöpler bina girişinin sağındaki konteynere atılır.\n\nSayın {isim}, iyi tatiller.\n\n" +
      "Sigara içilmez, evcil hayvan kabul edilmez.\n\nHavuz 09:00-20:00 arası açıktır.",
  },
];

describe("bölme", () => {
  it("normalize: satır sonu tek biçim, görünmez / kontrol karakteri silinir, satır uçları kırpılır — başka hiçbir şey değişmez", () => {
    expect(normalizeDocText("A\r\nB\rC\u0000D​E \t\n  F  ")).toBe("A\nB\nCDE\nF");
    expect(normalizeDocText("Çıkış 11:00'dir. Ücret 250 TL.")).toBe("Çıkış 11:00'dir. Ücret 250 TL.");
  });

  it("başlık: '#', sonu ':' ve kısa tamamı büyük harf; kural cümlesi, saat taşıyan satır, uzun satır başlık değildir", () => {
    expect(headingText("# Lale Ev Rehberi")).toBe("Lale Ev Rehberi");
    expect(headingText("Otopark:")).toBe("Otopark");
    expect(headingText("Wİ-Fİ")).toBe("Wİ-Fİ");
    expect(headingText("Wi-Fi")).toBeNull(); // kısa düz satır gövdedir
    expect(headingText("SİGARA İÇMEK KESİNLİKLE YASAK BURADA LÜTFEN")).toBeNull(); // 6 sözcük
    expect(headingText("Giriş 15:00:")).toBeNull();
    expect(headingText("Sigara içilmez.")).toBeNull();
    expect(headingText("12345")).toBeNull();
    expect(headingText("Otopark:\nAyrıntı")).toBeNull();
  });

  it("🚨 her blok normalize belgenin BİTİŞİK dilimi; uzun paragraf cümle sınırında bölünür, metin aynen", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Kural ${i + 1}: misafirler ortak alanda sessiz olmalıdır.`).join(" ");
    const doc = splitDocument([{ page: 1, text: `Giriş\n\n${long}` }]);
    const body = doc.blocks.filter((b) => b.kind === "body").map((b) => b.text);
    expect(body.length).toBeGreaterThan(2);
    expect(body.slice(1).join(" ")).toBe(long);
    for (const b of doc.blocks) expect(normalizeDocText(`Giriş\n\n${long}`)).toContain(b.text);
  });

  it("altında gövde olmayan başlık gövde sayılır (içerik düşmez)", () => {
    const doc = splitDocument([{ page: 1, text: "Otopark:\n\nWİ-Fİ" }]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["body", "body"]);
  });

  it("tavanlar: metin ve sayfa sınırını aşan kısım okunmaz, söylenir", () => {
    const big = splitDocument([{ page: 1, text: `${"a".repeat(KB_IMPORT_MAX_CHARS - 10)}\n\nfazla metin burada` }]);
    expect(big.truncated).toBe(true);
    expect(big.blocks.every((b) => !b.text.includes("fazla"))).toBe(true);
    const pages = splitDocument(Array.from({ length: KB_IMPORT_MAX_PAGES + 1 }, (_, i) => ({ page: i + 1, text: `Sayfa ${i + 1} metni.` })));
    expect(pages.truncated).toBe(true);
    expect(pages.blocks).toHaveLength(KB_IMPORT_MAX_PAGES);
  });
});

describe("konu ayırma + taslak (modelsiz uçtan uca)", () => {
  const plan = planDocumentImport(GUIDE);
  const doc = splitDocument(GUIDE);
  const byCat = (c: string) => plan.drafts.filter((d) => d.category === c);

  it("🚨 başlığın kapsamı: 'Otopark:' altında yalnız kendi paragrafı; sonraki sayfadaki çöp / kural / havuz kendi konusuna gider", () => {
    expect(byCat("parking")).toMatchObject([{ title: "Otopark", content: "Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır.\nAraç girişi bina arkasından." }]);
    expect(byCat("trash")).toMatchObject([{ title: "Çöp", content: "Çöpler bina girişinin sağındaki konteynere atılır." }]);
    expect(byCat("rules")).toMatchObject([{ title: "Ev Kuralları", content: "Sigara içilmez, evcil hayvan kabul edilmez." }]);
    expect(byCat("wifi")).toMatchObject([{ title: "Wİ-Fİ", content: "Ağ adı Lale-5G, şifre Lale2025." }]);
    expect(byCat("general").map((d) => d.content)).toEqual(["Hoş geldiniz! Aşağıda konaklamanız için gerekli bilgiler var.", "Havuz 09:00-20:00 arası açıktır."]);
  });

  it("🚨 model bilgi yazamaz: her taslak belgenin bloklarının AYNEN birleşimi; başlık belgenin başlığı ya da kategorinin sabit adı", () => {
    expect(plan.drafts.length).toBeGreaterThan(0);
    for (const d of plan.drafts) expect(draftIsVerbatim(doc, d)).toBe(true);
    expect(draftIsVerbatim(doc, { ...plan.drafts[0], content: `${plan.drafts[0].content} Çocuklar ücretsiz.` })).toBe(false);
    expect(draftIsVerbatim(doc, { content: "", blocks: [] })).toBe(false);
  });

  it("🚨 Haiku 10-23 öğle: kategorili başlık AYNI sayfadaki kategorisiz paragrafı almaz (havuz saati 'Otopark' kalemine girmez); kategorisiz başlık alır", () => {
    const p = planDocumentImport([{ page: 1, text: "Otopark:\n\nOtopark ücretsizdir.\n\nHavuz 09:00-20:00 arası açıktır." }]);
    expect(p.drafts.map((d) => [d.category, d.title, d.content])).toEqual([
      ["parking", "Otopark", "Otopark ücretsizdir."],
      ["general", "Genel", "Havuz 09:00-20:00 arası açıktır."],
    ]);
    const q = planDocumentImport([{ page: 1, text: "Ayrıntılar:\n\nAğ adı Lale-5G.\n\nModem salonda." }]);
    expect(q.drafts.map((d) => [d.category, d.title, d.blocks.length])).toEqual([["wifi", "Ayrıntılar", 2]]); // kategori gövdeden ("modem")
  });

  it("🚨 her paragraf hesap verir: yer tutucu ve yalnız giriş / çıkış saati kalem olmaz, neden söylenir; saatler daire ayarı önerisi", () => {
    const accounted = new Set([...plan.drafts.flatMap((d) => d.blocks), ...plan.skipped.map((s) => s.block)]);
    expect(doc.blocks.filter((b) => b.kind === "body").every((b) => accounted.has(b.index))).toBe(true);
    const reasons = Object.fromEntries(plan.skipped.map((s) => [doc.blocks[s.block].text, s.reason]));
    expect(reasons).toEqual({ "Giriş saati 15:00, çıkış saati 11:00.": "property_field", "Sayın {isim}, iyi tatiller.": "placeholder" });
    expect(plan.fields.map((f) => [f.target, f.value])).toEqual([
      ["checkInTime", "15:00"],
      ["checkOutTime", "11:00"],
    ]);
    expect(plan.drafts.some((d) => /\{isim\}|15:00/.test(d.content))).toBe(false);
  });

  it("kaynak işaretçisi PII'siz: belge özeti + sayfa aralığı; içerik taşımaz", () => {
    for (const d of plan.drafts) expect(d.sourceRef).toMatch(/^doc:[0-9a-f]{16}:p\d+-\d+$/);
    expect(byCat("trash")[0].sourceRef.endsWith(":p2-2")).toBe(true);
  });

  it("giriş saati başka bilgiyle aynı paragraftaysa paragraf kalemde kalır, işaretlenir ve öneri de çıkar", () => {
    const mixed = planDocumentImport([{ page: 1, text: "Giriş saati 15:00; anahtar kutusu kapının solunda, kod size mesajla gelir." }]);
    expect(mixed.drafts).toHaveLength(1);
    expect(mixed.drafts[0].mentionsPropertyField).toBe(true);
    expect(mixed.fields.map((f) => f.value)).toEqual(["15:00"]);
  });
});

describe("bölüm doğrulaması (ileride model bölümleri de aynı yoldan geçer)", () => {
  const doc = splitDocument(GUIDE);
  const body = doc.blocks.filter((b) => b.kind === "body").map((b) => b.index);

  it("🚨 misafire aynen giden şablon kategorileri (karşılama / giriş talimatı / çıkış mesajı) ve bilinmeyen kategori kalem AÇMAZ", () => {
    expect(KB_IMPORTABLE_CATEGORIES).not.toEqual(expect.arrayContaining(["welcome"]));
    for (const category of ["welcome", "checkin", "checkout", "amenities"]) {
      const plan = assembleDrafts(doc, [{ category, blocks: [body[0]] }]);
      expect(plan.drafts).toEqual([]);
      expect(plan.problems).toEqual([{ section: 0, reason: "invalid_category" }]);
      expect(plan.skipped).toContainEqual({ block: body[0], reason: "unassigned" });
    }
  });

  it("🚨 geçersiz, tekrar eden, başlık bloğu gösteren ya da başka bölümün kullandığı numara BÜTÜN bölümü düşürür", () => {
    const heading = doc.blocks.find((b) => b.kind === "heading")!.index;
    for (const blocks of [[body[0], 999], [body[0], body[0]], [heading], [1.5], []]) {
      expect(assembleDrafts(doc, [{ category: "general", blocks }]).problems).toEqual([{ section: 0, reason: "invalid_block" }]);
    }
    const twice = assembleDrafts(doc, [
      { category: "general", blocks: [body[0]] },
      { category: "rules", blocks: [body[0], body[1]] },
    ]);
    expect(twice.drafts.map((d) => d.blocks)).toEqual([[body[0]]]);
    expect(twice.problems).toEqual([{ section: 1, reason: "invalid_block" }]);
  });

  it("🚨 başlık yalnız BELGE başlık bloğundan: gövde bloğunu başlık diye göstermek sabit kategori adına düşer", () => {
    const heading = doc.blocks.find((b) => b.kind === "heading" && b.heading === "Otopark")!.index;
    expect(assembleDrafts(doc, [{ category: "parking", blocks: [body[2]], headingBlock: heading }]).drafts[0].title).toBe("Otopark");
    expect(assembleDrafts(doc, [{ category: "parking", blocks: [body[2]], headingBlock: body[0] }]).drafts[0].title).toBe("Otopark");
    expect(assembleDrafts(doc, [{ category: "rules", blocks: [body[0]], headingBlock: body[1] }]).drafts[0].title).toBe("Ev Kuralları");
  });

  it("tavanı aşan konu blok sınırında sıralı parçalara bölünür; her parça yine aynen", () => {
    const para = "Misafirlerimizden ortak alanlarda sessiz olmalarını rica ederiz.".padEnd(800, " x");
    const text = Array.from({ length: 30 }, () => para.trim()).join("\n\n");
    const big = splitDocument([{ page: 1, text }]);
    const plan = assembleDrafts(big, [{ category: "rules", blocks: big.blocks.map((b) => b.index) }]);
    expect(plan.drafts.length).toBe(2);
    expect(plan.drafts.map((d) => d.title)).toEqual(["Ev Kuralları (1/2)", "Ev Kuralları (2/2)"]);
    for (const d of plan.drafts) {
      expect(d.content.length).toBeLessThanOrEqual(KB_IMPORT_ITEM_MAX_CHARS);
      expect(draftIsVerbatim(big, d)).toBe(true);
    }
  });

  it("başlıksız belge: paragraflar kategoriye göre toplanır, eşleşmeyen 'Genel'", () => {
    const sections = sectionByHeadings(splitDocument([{ page: 1, text: "Wi-Fi şifresi Lale2025.\n\nÇöp konteyneri bina önünde.\n\nModem salonda.\n\nBalkon kapısını kilitleyin." }]));
    expect(sections.map((s) => [s.category, s.blocks])).toEqual([
      ["wifi", [0, 2]],
      ["trash", [1]],
      ["general", [3]],
    ]);
  });
});

describe("süre (misafir değil ev sahibi metni ama 200.000 karakter)", () => {
  it("tek sözcük / boşluk dizisi / tekrarlanan başlık / tekrarlanan saat doğrusal", () => {
    const t0 = performance.now();
    planDocumentImport([{ page: 1, text: "a".repeat(190_000) }]);
    planDocumentImport([{ page: 1, text: `${" ".repeat(190_000)}x` }]);
    planDocumentImport([{ page: 1, text: "OTOPARK:\n\n".repeat(18_000) }]);
    planDocumentImport([{ page: 1, text: "Giriş saati 15:00, ".repeat(9_000) }]);
    expect(performance.now() - t0).toBeLessThan(4_000);
  });
});
