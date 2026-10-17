import { describe, it, expect } from "vitest";
import { stripNoInstructionFiller } from "@/lib/ai/no-instruction-filler";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// "TALİMAT YOK" YAN CÜMLESİ (kurucu 10-17, aynen): "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. bunun ilk
// cümlesini yazmasına gerek yok zaten yeterli … Çıkış için özel talimatımız yok, bunu yazmasın" · "televizyonla ilgili ayrı bir talimatım
// bulunmuyor böyle birşey yazamaz kesinlikle" · "bilgi veremem cümlesi tabiki tutulsun … sussa daha iyi".
// Sözleşme: aynı cümlede yönerge varsa yalnız yan cümle silinir (ÖNCE → SONRA aşağıda); cihazdan söz eden ya da tek başına kalan "talimat
// yok" silinmez, cevap "bilgim yok" kuralıyla tutulur (misafire gitmez); "bilgi veremem" ailesi tutulur.
// ---------------------------------------------------------------------------

const STRIPPED: [string, string][] = [
  // Kurucunun kendi örneği.
  ["Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.", "Anahtarı masaya bırakmanız yeterli."],
  ["Çıkış için ek bir talimatımız bulunmuyor; anahtarları masada bırakabilirsiniz.", "Anahtarları masada bırakabilirsiniz."],
  ["Anahtarı masaya bırakmanız yeterli, özel bir talimatımız yok.", "Anahtarı masaya bırakmanız yeterli."],
  ["Çıkış için özel talimatımız yok, ama anahtarı masaya bırakın.", "Anahtarı masaya bırakın."],
  ["Giriş için özel bir talimat gerekmiyor, kapı açık.", "Kapı açık."],
  ["Çöp için özel bir talimat yok, konteynere atabilirsiniz.", "Konteynere atabilirsiniz."],
  ["No special instructions for checkout, just close the door.", "Just close the door."],
  ["There are no other instructions in my notes, so just leave the keys on the table.", "Just leave the keys on the table."],
  ["No hay instrucciones especiales para el check-in; la llave está en el buzón.", "La llave está en el buzón."],
  ["Нет особых инструкций, ключ в почтовом ящике.", "Ключ в почтовом ящике."],
  ["Es gibt keine besonderen Anweisungen, der Schlüssel liegt im Kasten.", "Der Schlüssel liegt im Kasten."],
  ["Il n'y a pas d'instructions particulières, la clé est dans la boîte.", "La clé est dans la boîte."],
  // Haiku 10-17: 3. şahıs iyelik, "yok ve / yok ama" sınırı, sondaki bağlaç, madde işareti, ortadaki yan cümle + ardındaki bağlaç.
  ["Çıkış için özel talimatı yok, anahtarı masaya bırakın.", "Anahtarı masaya bırakın."],
  ["Çıkış için özel talimatımız yok ve anahtarı masaya bırakın.", "Anahtarı masaya bırakın."],
  ["Çıkış için özel talimatımız yok ama anahtarı masaya bırakın.", "Anahtarı masaya bırakın."],
  ["Çıkış için özel talimatımız yok, ve anahtarı masaya bırakın.", "Anahtarı masaya bırakın."],
  ["- Çıkış için özel talimatımız yok, anahtarı masaya bırakın.\n- Otopark ücretsiz.", "- Anahtarı masaya bırakın.\n- Otopark ücretsiz."],
  ["Anahtar masada, özel talimatımız yok ve kahvaltı 08.00-10.00 arasıdır.", "Anahtar masada, kahvaltı 08.00-10.00 arasıdır."],
  ["Çıkış 15.00'e kadar, özel talimatımız yok.", "Çıkış 15.00'e kadar."],
  // Selam satırı ve sonraki cümle korunur; satır yapısı aynı.
  [
    "Merhaba Alex,\n\nÇıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. İyi yolculuklar dileriz.",
    "Merhaba Alex,\n\nAnahtarı masaya bırakmanız yeterli. İyi yolculuklar dileriz.",
  ],
];

// Silinmez → cevap aynen kalır ve "bilgim yok" kuralı onu misafire göndermez.
const HELD: string[] = [
  // Kurucu: "televizyonla ilgili ayrı bir talimatım bulunmuyor … ev sahibinize ileteceğim … söylenemez".
  "Televizyonla ilgili ayrı bir talimatım bulunmuyor, ev sahibinize ileteceğim.",
  // Cihazdan söz eden "talimat yok" sorunun bilgisizliğidir: yanına başka konuda yönerge yazılsa da silinmez (soru sessizce "cevaplanmış" olurdu).
  "Televizyonla ilgili ayrı bir talimatım bulunmuyor, çöpleri konteynere atabilirsiniz.",
  "Wi-Fi için ayrı bir talimatımız yok, şifre kartta yazıyor.",
  // Tek başına: geriye yönerge yok.
  "Çıkış için özel talimatımız yok.",
  "Özel talimatımız yok.",
  "لا توجد تعليمات خاصة للمغادرة.",
  // Kalan kısım da bilgisizlik.
  "Çıkış için özel talimatımız yok, bu konuda bilgi veremem.",
  // Haiku 10-17: sayı ayracı yan cümle sınırı DEĞİL ("15:00", "1,5") — eskiden "Çıkış saat 15." / "Ücret 1." gidiyordu.
  "Çıkış saat 15:00 ve özel talimatımız yok.",
  "Ücret 1,5 TL olup özel talimatımız yok.",
  // Haiku 10-17: konu ayrı yan cümlede asılı ("Kombi için,") — cihaz bilgisizliği sessizce kaybolmaz.
  "Kombi için, özel talimatımız yok, anahtarı masaya bırakın.",
  "Televizyonla ilgili, ayrı bir talimatım bulunmuyor.",
  "Özel talimatımız yok, televizyon için.",
  "Anahtarı masaya bırakın, Wi-Fi için özel talimatımız yok.",
];

describe("stripNoInstructionFiller — kurucu 10-17", () => {
  for (const [before, after] of STRIPPED) {
    it(`siler: ${JSON.stringify(before.slice(0, 60))}`, () => {
      expect(stripNoInstructionFiller(before)).toBe(after);
      // Silinmiş hâl misafire gidebilir (bilgisizlik kalmadı); silinmemiş hâl gitmez (kurucu: "bunu yazmasın").
      expect(admitsMissingKnowledge(after)).toBe(false);
      expect(admitsMissingKnowledge(before)).toBe(before.includes("gerekmiyor") ? false : true);
    });
  }
  for (const m of HELD) {
    it(`silmez, cevap tutulur: ${JSON.stringify(m.slice(0, 60))}`, () => {
      expect(stripNoInstructionFiller(m)).toBe(m);
      expect(admitsMissingKnowledge(m)).toBe(true);
    });
  }
  it("KONTROL: 'talimat yok' taşımayan cevap AYNI dize (aşırı uygulama yok)", () => {
    for (const m of [
      "Check-in saati 15:00, anahtar kutusu kapının solunda.",
      "Anahtarı masaya bırakmanız yeterli, ama pencereleri kapatın.",
      "Talimatlar kartta yazıyor, kapı kodu ayrıca gönderilecek.",
      "Sie brauchen keine besonderen Anweisungen, die Tür ist offen.",
      "You need no special instructions for checkout.",
      "No special instructions are needed for checkout.",
      "",
    ]) {
      expect(stripNoInstructionFiller(m)).toBe(m);
    }
  });
});

describe("'bilgi veremem' ailesi (kurucu 10-17 M1: 'tabiki tutulsun … sussa daha iyi')", () => {
  it.each([
    "Bu konuda bilgi veremem.",
    "Kesin bilgi veremeyiz, ev sahibinize sorun.",
    "Size bu konuda bilgi veremeyeceğim.",
    "Maalesef bilgi verememekteyiz.",
    "Bu konuda net bir bilgi veremiyoruz.",
  ])("tutulur: %s", (m) => {
    expect(admitsMissingKnowledge(m)).toBe(true);
  });
  it.each([
    "Size Wi-Fi şifresini hemen veriyorum: Lale2024.",
    "Bilgi vermek isterim: check-in 15:00.",
    "Anahtarı resepsiyona veremezseniz kutuya bırakın.",
  ])("KONTROL tutulmaz: %s", (m) => {
    expect(admitsMissingKnowledge(m)).toBe(false);
  });
});
