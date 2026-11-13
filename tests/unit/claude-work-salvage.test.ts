import { describe, it, expect } from "vitest";
import { parseOrSalvage, salvageArrayItems, salvageStringField } from "../../scripts/claude-work/salvage";

// ---------------------------------------------------------------------------
// KESİK MODEL ÇIKTISINDAN KURTARMA (11-13). İstem denetiminde dört mercek çıktı sınırında kesildi; JSON okunamadığı için o merceklerin
// bütün bulguları atılmıştı. Kural: kesilme noktasından ÖNCE tamamlanmış her öğe geri alınır; yarım kalan öğe / metin atılır (onarım yok).
// ---------------------------------------------------------------------------

const finding = (n: number, extra: Record<string, unknown> = {}) => ({ severity: "P1", title_tr: `bulgu ${n}`, quote: `satır ${n}`, line: n, ...extra });
const full = (items: unknown[], overall = "genel değerlendirme") => JSON.stringify({ overall_tr: overall, findings: items });

describe("kesik çıktıdan kurtarma", () => {
  it("eksiksiz JSON: sonuç JSON.parse ile aynı, 'kesik' işareti yok", () => {
    const text = full([finding(1), finding(2)]);
    expect(parseOrSalvage(text, "findings", ["overall_tr"])).toEqual({ complete: true, items: [finding(1), finding(2)], strings: { overall_tr: "genel değerlendirme" } });
  });

  it("🚨 üçüncü öğenin ortasında kesilen çıktı: ilk iki öğe ve tamamlanmış metin alanı kurtulur", () => {
    const text = full([finding(1), finding(2), finding(3)]);
    const cut = text.slice(0, text.indexOf("bulgu 3") + 4);
    const res = parseOrSalvage(cut, "findings", ["overall_tr"]);
    expect(res).toEqual({ complete: false, items: [finding(1), finding(2)], strings: { overall_tr: "genel değerlendirme" } });
  });

  it("her kesme noktasında: kurtarılanlar asıl listenin bir ÖN EKİdir (uydurma / yarım öğe yok) ve kesme ilerledikçe azalmaz", () => {
    const items = [finding(1, { nested: { a: [1, { b: "}" }] } }), finding(2, { quote: 'tırnak " ve } ve { ve ] içerir \\' }), finding(3), finding(4)];
    const text = full(items, 'içinde "findings": [ yazan { metin }');
    let prev = 0;
    for (let cut = 0; cut <= text.length; cut++) {
      const got = salvageArrayItems(text.slice(0, cut), "findings");
      expect(got, `kesme ${cut}`).toEqual(items.slice(0, got.length));
      expect(got.length, `kesme ${cut}`).toBeGreaterThanOrEqual(prev);
      prev = got.length;
    }
    expect(prev).toBe(4);
  });

  it("metin değerinin içindeki süslü parantez, köşeli parantez ve kaçışlı tırnak öğe sınırı sayılmaz", () => {
    const tricky = finding(1, { quote: 'a } b ] c { d [ e \\" f', title_tr: 'başlık "tırnaklı"' });
    const text = full([tricky, finding(2)]);
    const cut = text.slice(0, text.lastIndexOf("bulgu 2"));
    expect(salvageArrayItems(cut, "findings")).toEqual([tricky]);
  });

  it("anahtar adı başka bir metin değerinin İÇİNDE geçiyorsa dizi sanılmaz", () => {
    const text = JSON.stringify({ overall_tr: '"findings": [{"severity":"P0"}]', findings: [finding(7)] });
    expect(salvageArrayItems(text, "findings")).toEqual([finding(7)]);
    // Gerçek dizi başlamadan kesilirse: metnin içindeki sahte dizi KURTARILMAZ.
    const cut = text.slice(0, text.indexOf(',"findings"'));
    expect(salvageArrayItems(cut, "findings")).toEqual([]);
  });

  it("dizi başka anahtarlardan SONRA da gelse bulunur; iç içe nesnedeki aynı adlı dizi üst düzey sayılmaz", () => {
    const text = JSON.stringify({ meta: { findings: [finding(99)] }, n: 3, ok: true, none: null, overall_tr: "x", findings: [finding(1)] });
    expect(salvageArrayItems(text, "findings")).toEqual([finding(1)]);
    expect(salvageStringField(text, "overall_tr")).toBe("x");
  });

  it("metin alanı: yarım kalan metin null (yarım cümle geri verilmez); metin olmayan alan null; olmayan alan null", () => {
    const text = full([finding(1)], "uzun bir değerlendirme metni");
    expect(salvageStringField(text.slice(0, text.indexOf("değerlendirme") + 5), "overall_tr")).toBeNull();
    expect(salvageStringField(JSON.stringify({ overall_tr: 5 }), "overall_tr")).toBeNull();
    expect(salvageStringField(text, "baska")).toBeNull();
    expect(salvageStringField(JSON.stringify({ overall_tr: 'satır\nsonu ve "tırnak"' }).slice(0, -1), "overall_tr")).toBe('satır\nsonu ve "tırnak"');
  });

  it("boş / ilgisiz girdi: boş liste (fırlatmaz)", () => {
    for (const text of ["", "düz metin", "{", '{"findings"', '{"findings":', '{"findings":[', '{"findings":"dizi değil"}', '{"baska":[{"a":1}]}', "[1,2,3]"]) {
      expect(salvageArrayItems(text, "findings"), text).toEqual([]);
    }
    expect(parseOrSalvage("", "findings", ["overall_tr"])).toEqual({ complete: false, items: [], strings: { overall_tr: null } });
  });

  it("dizide nesne olmayan öğe: eksiksiz JSON'da süzülür; kesik çıktıda tarama orada durur", () => {
    expect(parseOrSalvage(JSON.stringify({ findings: [finding(1), "metin", 3, null, [1], finding(2)] }), "findings").items).toEqual([finding(1), finding(2)]);
    expect(salvageArrayItems('{"findings":[{"a":1},"metin",{"a":2}', "findings")).toEqual([{ a: 1 }]);
  });

  it("uzun girdide doğrusal: 2 MB'lık kesik çıktı kısa sürede taranır", () => {
    const items = Array.from({ length: 4000 }, (_, i) => finding(i, { mechanism_tr: "x".repeat(400) }));
    const text = full(items);
    const cut = text.slice(0, text.length - 50);
    expect(text.length).toBeGreaterThan(1_500_000);
    expect(salvageArrayItems(cut, "findings")).toHaveLength(3999);
  });
});
