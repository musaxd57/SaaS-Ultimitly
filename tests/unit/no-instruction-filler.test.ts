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
  // Opus 10-17 B3: dolgu AYRI CÜMLE olarak yazıldıysa ve cevabın geri kalanı yönerge taşıyorsa o cümle düşer (eskiden bütün cevap tutuluyordu).
  ["Çıkış için özel talimatımız yok. Anahtarı masaya bırakmanız yeterli.", "Anahtarı masaya bırakmanız yeterli."],
  ["Çıkış saati 11:00'dir. Ek bir talimatımız bulunmuyor.", "Çıkış saati 11:00'dir."],
  ["Check-out is at 11:00. There are no special instructions for check-out.", "Check-out is at 11:00."],
  ["Çıkış için özel talimatımız yok:\n- Anahtarı masaya bırakın.", "- Anahtarı masaya bırakın."],
  // Opus 10-17 B4: ortadaki yan cümle silinince TEK boşluk.
  ["Anahtar masada, özel talimatımız yok, kahvaltı 08.00-10.00 arasıdır.", "Anahtar masada, kahvaltı 08.00-10.00 arasıdır."],
  ["Merhaba Alex, çıkış için özel talimatımız yok, anahtarı masaya bırakın.", "Merhaba Alex, anahtarı masaya bırakın."],
  // Opus 10-17 B6: yedi dilin en doğal biçimleri.
  ["Особых инструкций нет, ключ в почтовом ящике.", "Ключ в почтовом ящике."],
  ["There aren't any special instructions, just leave the keys on the table.", "Just leave the keys on the table."],
  ["We don't have any special instructions for check-out, just leave the keys on the table.", "Just leave the keys on the table."],
  ["No tenemos instrucciones especiales, la llave está en el buzón.", "La llave está en el buzón."],
  ["Il n'y a aucune consigne particulière, laissez la clé sur la table.", "Laissez la clé sur la table."],
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
  // Opus 10-17 B1 (P1): "talimat yok" ardındaki adımın bilgi tabanından GELMEDİĞİNİN kanıtıdır — yönerge bir cihaz adımıysa ya da konu
  // göndergeselse ("bu konuda", "for that") silinmez (eskiden kanıtsız kombi / TV / sigorta adımı tek başına gidiyordu).
  "Özel bir talimatımız yok, kombiyi sıfırlamak için reset tuşuna 5 saniye basın.",
  "Özel bir talimatımız yok, televizyonu kumandadaki kırmızı tuşla açabilirsiniz.",
  "Bu konuda özel bir talimatımız yok, sigortayı kapatıp açabilirsiniz.",
  "No special instructions for that, just restart the router.",
  "There are no special instructions, just press the red button on the TV remote.",
  // Opus 10-17 B2: bilinmeyen konu (cihaz envanterinde olmayan jakuzi, sauna…) = silme yok (izin listesi).
  "Jakuzi için özel bir talimatımız yok, keyfini çıkarın.",
  "Bu konuda özel bir talimatımız yok, başka bir sorunuz olursa yazabilirsiniz.",
  // Opus 10-17 B5 (P1): geriye yalnız selam / nezaket kalırsa silinmez ("Merhaba Ayşe Hanım." misafire gitmez).
  "Merhaba Ayşe Hanım, çıkış için özel bir talimatımız bulunmuyor.",
  "Merhaba, çıkış için özel bir talimatımız yok. İyi yolculuklar dileriz!",
  "Hello Alex, there are no special instructions for check-out. Have a safe trip!",
  "Teşekkürler, özel bir talimatımız yok.",
];

describe("stripNoInstructionFiller — kurucu 10-17", () => {
  for (const [before, after] of STRIPPED) {
    it(`siler: ${JSON.stringify(before.slice(0, 60))}`, () => {
      expect(stripNoInstructionFiller(before)).toBe(after);
      // Silinmiş hâl misafire gidebilir (bilgisizlik kalmadı); silinmemiş hâl gitmez (kurucu: "bunu yazmasın").
      expect(admitsMissingKnowledge(after)).toBe(false);
      expect(admitsMissingKnowledge(before)).toBe(before.includes("gerekmiyor") ? false : true);
      expect(after).not.toMatch(/ {2}/); // Opus 10-17 B4: çift boşluk yok
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

describe("gece-4 S4-09 / S4-05 / S4-01 — silme yalnız AYNI konuda ve geriye konulu yönerge kalınca; büyük harf cevabın dilinde", () => {
  // S4-09 (P1): başka konudaki cevap "talimat yok"u silerse misafirin o sorusu sessizce kaybolurdu (ev sahibi hiç görmezdi) → TUTULUR.
  it.each([
    "Yakında bir market var. Sigara için özel talimatımız yok.",
    "Çöpleri binanın girişindeki konteynere atabilirsiniz. Çıkış için özel talimatımız yok.",
    "Çöpleri binanın girişindeki konteynere atabilirsiniz, çıkış için özel talimatımız yok.",
    "The garbage bins are at the building entrance. We don't have any special instructions for pets.",
    "Otopark ücretsiz. Evcil hayvan için özel talimatımız yok.",
    "Çıkış için özel talimatımız yok. Sigara için de özel talimatımız yok. Anahtarı masaya bırakın.",
  ])("başka konu → tutulur: %s", (m) => {
    expect(stripNoInstructionFiller(m)).toBe(m);
    expect(admitsMissingKnowledge(m)).toBe(true);
  });
  // S4-05: geriye yalnız nezaket / "bize yazın" kalırsa (kapalı selam listesi bunları tanımıyordu) → TUTULUR.
  it.each([
    "Çıkış için özel talimatımız yok, keyifli bir konaklama dileriz.",
    "Çıkış için özel talimatımız yok, her türlü sorunuz için bize yazabilirsiniz.",
    "Çıkış için özel talimatımız yok, konaklamanızın tadını çıkarın.",
    "There are no special instructions for checkout, enjoy the rest of your stay.",
    "There are no special instructions for checkout, feel free to message us if you need anything else.",
    "Merhaba Ayşe Hanım, çıkış için özel talimatımız yok. Keyifli bir konaklama dileriz.",
  ])("geriye konusuz nezaket → tutulur: %s", (m) => {
    expect(stripNoInstructionFiller(m)).toBe(m);
  });
  it("KONTROL: aynı konu / giriş-çıkış ↔ anahtar-kapı eşleşmesi silinmeye devam eder", () => {
    expect(stripNoInstructionFiller("Giriş saati 15:00'tir. Giriş için özel talimatımız yok.")).toBe("Giriş saati 15:00'tir.");
    expect(stripNoInstructionFiller("Çıkış için özel talimatımız yok, kapıyı çekip çıkmanız yeterli.")).toBe("Kapıyı çekip çıkmanız yeterli.");
    expect(stripNoInstructionFiller("Es gibt keine besonderen Anweisungen für den Check-out, schließen Sie einfach die Tür.", "de")).toBe(
      "Schließen Sie einfach die Tür.",
    );
  });
  // S4-01: Almanca / İngilizce cevapta "i" → "İ" olmaz (ö / ü / ç ya da Türkçe misafir adı geçse de).
  it.each([
    ["Für den Check-out gibt es keine besonderen Anweisungen, ihr könnt die Schlüssel einfach auf dem Tisch lassen.", "de", "Ihr könnt die Schlüssel einfach auf dem Tisch lassen."],
    ["No special instructions for checkout, in case of doubt just leave the keys on the table, Ayşe.", "en", "In case of doubt just leave the keys on the table, Ayşe."],
    ["Çıkış için özel talimatımız yok, içerideki anahtarı masaya bırakın.", "tr", "İçerideki anahtarı masaya bırakın."],
    ["Çıkış için özel talimatımız yok, içerideki anahtarı masaya bırakın.", "und", "İçerideki anahtarı masaya bırakın."],
  ])("büyük harf dilde: %s", (m, lang, after) => {
    expect(stripNoInstructionFiller(m, lang)).toBe(after);
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
    // Opus 10-17 B8: POLİTİKA cümlesi bilgisizlik değildir (nesne misafirin bilgisi, yüklem kod / anahtar) — eskiden tutuluyordu.
    "Kimlik bilgilerinizi göndermeden giriş kodunu veremeyiz.",
    "Kimlik bilgilerinizi paylaşmazsanız anahtarı veremem.",
  ])("KONTROL tutulmaz: %s", (m) => {
    expect(admitsMissingKnowledge(m)).toBe(false);
  });
});
