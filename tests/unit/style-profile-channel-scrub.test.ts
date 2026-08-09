import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// 🚨 STİL PROFİLİ OTO-GÖNDEREN YOLA DA SÜZÜLEREK GİRER (denetim 08-08/09).
//
// `aiStyleProfile`, host'un BAŞKA misafirlere yazdığı ~40 yanıttan model
// tarafından damıtılır. O yanıtlar rutin olarak wifi şifresi ve kapı kodu
// içeriyor; damıtma prompt'undaki "KESİNLİKLE DIŞARIDA BIRAK" talimatı
// (`ai/index.ts`) deponun kendi ifadesiyle "bir MODEL RİCASI, deterministik
// garanti DEĞİL" (`guest-chat.ts` başlık yorumu).
//
// QR yolu bunu ZATEN süzüyordu (`chat/[token]/route.ts`). Kanal yolu — yani
// İNSAN OLMADAN oto-gönderen yüzey — HAM geçiriyordu. Asimetri tersti:
// riski yüksek yüzey korumasız, her zaman devir mesajı gösteren yüzey korumalı.
//
// ⚠️ Süzgeç SATIR BAZLIDIR (`split(/\r?\n/)` + filter), yani KB'deki gibi
// "kalemin tamamı düşer" sorunu burada YOK — yalnız sırra benzeyen satır düşer.
// ---------------------------------------------------------------------------
describe("aiStyleProfile — kanal yolu da süzer", () => {
  it("süzgeç sırra benzeyen SATIRI atar, üslup satırlarını KORUR", () => {
    const profile = [
      "Kısa ve net yaz.",
      "Kapı kodu: 4590",
      "Misafire her zaman siz diye hitap et.",
    ].join("\n");
    const out = scrubStyleProfileForPublic(profile);
    expect(out).not.toContain("4590");
    // KONTROL: üslup bilgisi KAYBOLMAZ — yoksa "her şeyi at" mutasyonu da geçerdi.
    expect(out).toContain("Kısa ve net yaz.");
    expect(out).toContain("siz diye hitap et");
  });

  it("kanal yolu (`automation.ts`) profili SÜZEREK geçirir", () => {
    const src = readFileSync("src/lib/automation.ts", "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    // Ham geçiş YASAK; yalnız süzülmüş biçim.
    expect(code).not.toMatch(/styleProfile:\s*org\.aiStyleProfile\s*,/);
    expect(code).toMatch(/styleProfile:\s*scrubStyleProfileForPublic\(org\.aiStyleProfile\)/);
  });

  // ── DÖRT YÜZEYİN DÖRDÜ DE (08-09 (2)) ──────────────────────────────────────
  //
  // 🚨 KANAL YOLU 08-08'DE DÜZELTİLMİŞTİ AMA İKİ YÜZEY ATLANMIŞTI: `ai-suggest`
  // ("AI ile cevapla") ve `ai/test` (Ayarlar → "AI'yı Deneyin") profili HAM
  // geçiriyordu. İkisi de oturum korumalı ve çıktı TASLAK — ama taslak host'un
  // yazma alanına basılıyor ve tek tıkla misafire gidiyor. Yani sonuç aynı
  // yerde bitiyor, yalnız arada bir tık var; ve kapı kodunun misafire NE ZAMAN
  // gideceği kararı KB kapısının işi (`verifiedActiveStay`), taslağı okuyan
  // host'un anlık dikkatinin değil.
  //
  // Bu pin YENİ POLİTİKA İCAT ETMİYOR — mevcut süzgeci dört yüzeye eşitliyor.
  // Kayıp yok: rehber ÜSLUP içindir, sır satırı orada zaten bilgi taşımıyor.
  it("🚨 `ai-suggest` ve `ai/test` de SÜZEREK geçirir — dört yüzey eşit", () => {
    for (const path of [
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/app/api/ai/test/route.ts",
    ]) {
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      expect(code, path).not.toMatch(/styleProfile:\s*org\?\.aiStyleProfile\s*,/);
      expect(code, path).toMatch(/styleProfile:\s*scrubStyleProfileForPublic\(org\?\.aiStyleProfile\)/);
    }
  });

  // ⚠️ Yorum eleme SATIR BAŞINA çapalı (`trimStart().startsWith("//")`) — bu
  // deponun kendi ölçülmüş tuzağı: `/\/\/[^\n]*/g` ile eleme yapan bir sürüm
  // `https://…` içindeki `//`den itibaren her şeyi siliyor ve testi kendi
  // aradığı ipucunu yok ederek vacuous hâle getiriyordu.
  it("tarama gerçekten kod görüyor (test kendini boşa düşürmesin)", () => {
    const code = readFileSync("src/app/api/ai/test/route.ts", "utf8");
    expect(code).toContain("suggestReply");
    expect(code.length).toBeGreaterThan(2000);
  });
});
