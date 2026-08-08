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
});
