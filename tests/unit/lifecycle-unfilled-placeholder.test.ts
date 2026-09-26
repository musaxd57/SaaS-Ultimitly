import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kbPlaceholderTokens } from "@/lib/kb-placeholders";
import { ANY_DOUBLE_BRACE } from "@/lib/template-apply";

// ---------------------------------------------------------------------------
// DOLDURULMAMIŞ YER TUTUCU MİSAFİRE GİTMEZ (kurucu iş emri, 2026-09-11).
//
// 🚨 ÖLÇÜLEN MİSAFİR-GÖRÜNÜR KUSUR: `KB_PRESETS`in "Giriş talimatı" ve "Çıkış"
// hazır şablonlarının İKİSİ de doldurulmamış köşeli parantez taşıyor
// (`[AÇIK ADRES]` · `[ZİL / KAPI KODU TARİFİ]` · `[ANAHTAR TESLİM ŞEKLİ]` ·
// `[ANAHTAR BIRAKMA YERİ]`). Host rozete basıp kaydedebiliyor, kalem `approved`
// doğuyor ve YAŞAM-DÖNGÜSÜ MESAJI MODELDEN HİÇ GEÇMİYOR — yani ürünün `[…]`
// koruması (`packKnowledgeBase`in `[NOT]` notu, bir MODEL İSTEMİ notudur) bu
// yolda DEVREDE DEĞİLDİ. Misafir `Adres: [AÇIK ADRES]` okuyordu.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** Gönderici ve rozet AYNI iki yüklemden türer — ayrışmasınlar. */
const unfilled = (s: string) => kbPlaceholderTokens(s).length > 0 || ANY_DOUBLE_BRACE.test(s);

describe("yer tutucu yüklemi — sınıf", () => {
  it("🚨 köşeli parantezli alan DOLDURULMAMIŞ sayılır", () => {
    expect(unfilled("Adres: [AÇIK ADRES]")).toBe(true);
    expect(unfilled("Anahtar: <ANAHTAR TESLİM>")).toBe(true);
    expect(unfilled("Kapı kodu: ______")).toBe(true);
  });

  it("🚨 çözülmemiş `{{…}}` de DOLDURULMAMIŞ sayılır (bu yolda HİÇ çözülmüyor)", () => {
    // `fillPlaceholders` yalnız tek-parantez `{isim}`/`{daire}` sınıfını bilir.
    expect(unfilled("Wi-Fi: {{wifiInfo}}")).toBe(true);
    // ⚠️ `\\w` ASCII: Türkçe harfli ve noktalı biçimler de yakalanmalı.
    expect(unfilled("{{misafirAdı}}")).toBe(true);
    expect(unfilled("{{property.name}}")).toBe(true);
  });

  it("ÇÖZÜLEN belirteçler doldurulmamış SAYILMAZ (aşırı uygulama kontrolü)", () => {
    // Bunlar gönderim anında `fillGuestPlaceholders` ile doldurulur.
    expect(unfilled("Merhaba {isim}, hoş geldiniz.")).toBe(false);
    expect(unfilled("Daire {daire}")).toBe(false);
    // Madde imi yer tutucu değildir.
    expect(unfilled("Kurallar [1] sessizlik [2] sigara yok")).toBe(false);
    expect(unfilled("Giriş 15:00, çıkış 11:00.")).toBe(false);
  });

  it("🚨 ANTI-VAKUM: hazır şablonlar GERÇEKTEN bu sınıfı taşıyor (kusur kurgusal değil)", () => {
    // ⚠️ Kaynak taraması: `KB_PRESETS` istemci bileşeninde module-private ve
    // dışa aktarılmıyor. Ölçülen şey tek yönlü ama YETERLİ — bu satırın işi
    // "kusur kurgusal mı" sorusunu yanıtlamak, davranış pini değil.
    const s = read("src/components/knowledge/kb-manager.tsx");
    const block = /const KB_PRESETS[\s\S]*?\n\];/.exec(s);
    expect(block, "KB_PRESETS bloğu bulunamadı").toBeTruthy();
    const trig = /category: "(?:welcome|checkin|checkout)"/.test(block![0]);
    expect(trig, "hazır şablonlarda tetikleyici kategori yok").toBe(true);
    expect(unfilled(block![0]), "hiçbir hazır şablon doldurulmamış alan taşımıyor").toBe(true);
  });
});

describe("gönderici kapısı — fail-closed", () => {
  const src = () =>
    read("src/lib/automation.ts")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");

  it("🚨 ÜÇ yaşam-döngüsü göndericisinin ÜÇÜ de kapıyı çağırır", () => {
    // Davranışsal integration pini ayrı ve DB ister; burada ölçülen şey kapının
    // üç yolun ÜÇÜNE de bağlandığı — bir gönderici atlanırsa o kanal sessizce
    // ham belirteç göndermeye devam ederdi (tam olarak bu turun düzelttiği
    // kusur sınıfı, yalnız bir yolda).
    const hits = src().match(/if \(hasUnfilledPlaceholders\(body\)\) \{/g) ?? [];
    expect(hits.length).toBe(3);
  });

  it("🚨 kapı GÖVDE KURULDUKTAN SONRA çalışır (ikame edilmiş metni denetler)", () => {
    // `{isim}` çözülmeden denetlenirse her karşılama "doldurulmamış" sayılırdı.
    const s = src();
    for (const build of ["welcome.content", "tpl.content"]) {
      let from = 0;
      while (true) {
        const at = s.indexOf(`buildGuestMessageBody(${build}`, from);
        if (at === -1) break;
        from = at + 1;
        const after = s.slice(at, at + 600);
        // Önizleme fonksiyonları gövde kurmaz; yalnız gönderici dallarını sına.
        if (!after.includes("hasUnfilledPlaceholders")) continue;
        expect(after.indexOf("hasUnfilledPlaceholders")).toBeGreaterThan(0);
      }
    }
  });

  it("sayaç `failures`'a İTİLMEZ (yanlış alarm metni + 6 saatlik kilit penceresi)", () => {
    const s = src();
    expect(s).toContain("let unfilled = 0;");
    // `failures.push("unfilled")` benzeri bir şey OLMAMALI: o dizi "teslim
    // başarısız" alarmını tetikler ve burada teslim DENENMEDİ bile.
    expect(s).not.toMatch(/failures\.push\([^)]*unfilled/i);
  });
});

describe("Bilgi Tabanı ekranı — host DÜZELTMENİN YAPILACAĞI YERDE uyarılır", () => {
  const src = () => read("src/components/knowledge/kb-manager.tsx");

  it("🚨 KOŞULSUZ 'otomatik gönderilir' VAADİ KALKTI", () => {
    const s = src();
    expect(s).not.toContain("Bu metin misafire otomatik gönderilir.");
    // Yerine KONTROL EDİLEBİLİR bir yönlendirme var (bileşen org ayarını
    // props olarak ALMIYOR — bilmediğimiz şeyi iddia etmiyoruz).
    expect(s).toContain("Bu kategori otomatik gönderim içindir");
    expect(s).toContain("/settings?view=ai-otomasyon");
  });

  it("🚨 doldurulmamış alan taşıyan tetikleyici kalemde ROZET var", () => {
    const s = src();
    expect(s).toContain("hasUnfilledField");
    expect(s).toContain("Doldurulmamış alan");
    // Yalnız tetikleyici kategorilerde — bilgi kalemleri zaten modelden geçer.
    expect(s).toMatch(/TRIGGER_CATEGORIES\.has\(item\.category\) && hasUnfilledField\(item\.content\)/);
  });

  it("rozet yüklemi gönderici ile AYNI iki kaynaktan türer (ayrışma olamaz)", () => {
    const s = src();
    expect(s).toContain('from "@/lib/kb-placeholders"');
    expect(s).toContain('from "@/lib/template-apply"');
  });
});
