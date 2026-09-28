import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyCodeGreeting,
  codeGreetingEnabled,
  greetingLine,
  modelGuestFirstName,
  salutationNameOf,
  stripLeadingGreeting,
  withoutCodeGreetingLine,
} from "@/lib/ai/code-greeting";

// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ + KODLA SELAM (K10-o "D", kurucu onayı 09-28) — saf kurallar. Anahtar varsayılan KAPALI.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("anahtar", () => {
  it("yalnız '1' açar", () => {
    expect(codeGreetingEnabled()).toBe(false);
    for (const v of ["true", "yes", "on", " 1"]) {
      vi.stubEnv("AI_CODE_GREETING_ENABLED", v);
      expect([v, codeGreetingEnabled()]).toEqual([v, false]);
    }
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    expect(codeGreetingEnabled()).toBe(true);
  });

  it("🚨 modele giden `{isim}`: anahtar açıkken HİÇBİR ad; kapalıyken bugünkü kural", () => {
    expect(modelGuestFirstName("Ayşe Yılmaz")).toBe("Ayşe");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    expect(modelGuestFirstName("Ayşe Yılmaz")).toBe("misafirimiz");
  });
});

describe("hitap adı — YALNIZ kanalın ayrı ad alanından, ad biçimli", () => {
  it.each([
    ["Ayşe", "Ayşe"],
    ["Mehmet Ali", "Mehmet Ali"],
    ["  Ayşe  ", "Ayşe"],
    ["Jean-Luc", "Jean-Luc"],
    ["O'Brien", "O'Brien"],
    ["J.R.R.", "J.R.R."],
    ["محمد", "محمد"],
    ["李", "李"],
    ["Ateş", "Ateş"], // gerçek ad; güvenlik sözcüğü olsa da selamda reddedilmez
  ])("%j → %j", (given, expected) => {
    expect(salutationNameOf(given)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["Ada2"],
    ["Ada Otopark Ücretsiz Bina"], // 4 sözcük
    ["Misafir Ahmet"],
    ["Rezervasyon HM4K2"],
    ["Ada:Not"],
    ["Ada\u2800Evcil"],
    ["A".repeat(41)],
    ["Aaaaaaaaaaaaa Bbbbbbbbbbbbbb Ccccccccccccccc"], // üç ad biçimli sözcük ama toplam 44 kod noktası
  ])("%j → adsız", (given) => {
    expect(salutationNameOf(given)).toBeNull();
  });
});

describe("selam tablosu (kurucu 09-28: resmî tonda da 'Merhaba Ayşe,')", () => {
  it.each([
    ["tr", "Merhaba Ayşe,", "Merhaba,"],
    ["en", "Hello Ayşe,", "Hello,"],
    ["de", "Hallo Ayşe,", "Hallo,"],
    ["fr", "Bonjour Ayşe,", "Bonjour,"],
    ["es", "Hola Ayşe,", "Hola,"],
    ["ru", "Здравствуйте, Ayşe!", "Здравствуйте!"],
    ["ar", "مرحباً Ayşe،", "مرحباً،"],
  ])("%s", (lang, named, nameless) => {
    expect(greetingLine(lang, "Ayşe")).toBe(named);
    expect(greetingLine(lang, null)).toBe(nameless);
  });

  it("tabloda olmayan / belirsiz dil → selam satırı YOK", () => {
    for (const lang of ["it", "pt", "und", "", null, undefined, "__proto__"]) expect(greetingLine(lang, "Ayşe")).toBeNull();
  });
});

describe("modelin baştaki selamı silinir", () => {
  it.each([
    ["Merhaba! Wi-Fi şifresi 1234.", "tr", "Wi-Fi şifresi 1234."],
    ["Merhaba, iyiyiz.", "tr", "İyiyiz."],
    ["İyi günler, çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["Hello!\n\nThanks for asking.", "en", "Thanks for asking."],
    ["Здравствуйте! Код 1234.", "ru", "Код 1234."],
    ["مرحباً، الرمز 1234.", "ar", "الرمز 1234."],
    // 09-28 inceleme ajanı: eskiden silinmiyordu → çift selam.
    ["¡Hola! El código es 1234.", "es", "El código es 1234."],
    ["Good morning! The code is 1234.", "en", "The code is 1234."],
    ["Good evening, the code is 1234.", "en", "The code is 1234."],
    ["Sayın misafirimiz, çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["Merhaba, değerli misafirimiz! Çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["Merhaba misafirimiz,\nçıkış 11:00.", "tr", "Çıkış 11:00."],
    ["Merhaba Hanımefendi, şifre 1234.", "tr", "Şifre 1234."],
    ["Здравствуйте, уважаемый гость! Код 1234.", "ru", "Код 1234."],
    ["Здравствуйте, [Misafir]! Код 1234.", "ru", "Код 1234."],
    ["Merhaba [Misafir], şifre 1234.", "tr", "Şifre 1234."],
    ["Merhaba\n\nÇıkış 11:00.", "tr", "Çıkış 11:00."],
    ["GÜNAYDIN, çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["İyi sabahlar! Kahvaltı 9'da.", "tr", "Kahvaltı 9'da."],
    ["İYİ AKŞAMLAR! Çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["السلام عليكم، الرمز 1234.", "ar", "الرمز 1234."],
    ["👋 Merhaba! Wi-Fi şifresi 1234.", "tr", "Wi-Fi şifresi 1234."],
    ["Merhaba! 😊 Wi-Fi şifresi 1234.", "tr", "Wi-Fi şifresi 1234."],
    ["**Merhaba!** Wi-Fi şifresi 1234.", "tr", "Wi-Fi şifresi 1234."],
    ["\u200fمرحباً! الرمز 1234.", "ar", "الرمز 1234."],
    ["Hi there, the code is 1234.", "en", "The code is 1234."],
    ["Hi all, the code is 1234.", "en", "The code is 1234."],
    ["Dear guest, the code is 1234.", "en", "The code is 1234."],
    ["Hello and welcome! The code is 1234.", "en", "Welcome! The code is 1234."],
    ["Merhaba ve hoş geldiniz! Şifre 1234.", "tr", "Hoş geldiniz! Şifre 1234."],
    ["Bonjour, le code est 1234.", "fr", "Le code est 1234."],
    ["Guten Morgen! Der Code ist 1234.", "de", "Der Code ist 1234."],
  ])("%j", (reply, lang, expected) => {
    expect(stripLeadingGreeting(reply, lang)).toBe(expected);
  });

  it.each([
    ["Hi-fi sistemi salonda.", "tr"],
    ["Heyecan verici bir haber: havuz açıldı.", "tr"],
    ["Hizmetimiz 7/24 açık.", "tr"],
    ["Hilton'a 5 dakika.", "tr"],
    ["Selamlık bölümü kapalı.", "tr"],
    ["Merhaba", "tr"], // selamdan ibaret cevap boşaltılmaz
    ["Merhaba!", "tr"],
    ["Wi-Fi şifresi 1234.", "tr"],
    // 🚨 İÇERİK SİLİNMEZ (09-28 inceleme): selamdan sonra hitap listesinde olmayan sözcük — ad ya da içerik — dokunulmaz.
    ["Günaydın Steakhouse, 5 dakika yürüme mesafesinde.", "tr"],
    ["Selam Pastanesi, 3 dakika.", "tr"],
    ["Merhaba Cafe. Sahilde.", "tr"],
    ["Hola Bar, está a 5 minutos.", "es"],
    ["Hi Michael, the code is 1234.", "en"],
    ["Merhaba Ayşe Hanım, şifre 1234.", "tr"],
    ["Hallo Anna, das WLAN heißt Lale.", "de"],
  ])("selam değil / tanınmayan hitap / tek başına selam → aynen: %j", (reply, lang) => {
    expect(stripLeadingGreeting(reply, lang)).toBe(reply);
  });

  it("büyük harf: Türkçe kuralı dil 'tr' ya da dil belirsiz + Türkçeye özgü harf; İngilizce 'it' → 'It'", () => {
    expect(stripLeadingGreeting("Merhaba, iyi ki geldiniz, şifre 1234.", null)).toBe("İyi ki geldiniz, şifre 1234.");
    expect(stripLeadingGreeting("Hello, it's 1234.", null)).toBe("It's 1234.");
    expect(stripLeadingGreeting("Hello, it's 1234.", "en")).toBe("It's 1234.");
    expect(stripLeadingGreeting("Merhaba, iyiyiz.", "tr")).toBe("İyiyiz.");
  });

  it("🚨 doğrusal: uzun girdide süre sınırlı", () => {
    for (const input of ["Merhaba " + "a".repeat(200_000), "Hi " + " ".repeat(200_000) + "x", "\n".repeat(200_000) + "Merhaba!"]) {
      const t0 = performance.now();
      stripLeadingGreeting(input, "tr");
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

describe("kodla selam — yalnız İLK cevapta, tek selam", () => {
  const base = { tone: "warm", language: "tr", name: "Ayşe" as string | null };

  it("🚨 ilk cevap: kodun selamı + gövde; modelin selamı silinir (çift selam yok)", () => {
    expect(applyCodeGreeting({ ...base, reply: "Wi-Fi şifresi 1234.", firstReply: true })).toBe("Merhaba Ayşe,\n\nWi-Fi şifresi 1234.");
    expect(applyCodeGreeting({ ...base, reply: "Merhaba! Wi-Fi şifresi 1234.", firstReply: true })).toBe(
      "Merhaba Ayşe,\n\nWi-Fi şifresi 1234.",
    );
  });

  it("🚨 sonraki cevap: selam YOK (model yazsa da silinir)", () => {
    expect(applyCodeGreeting({ ...base, reply: "Merhaba, çıkış 11:00.", firstReply: false })).toBe("Çıkış 11:00.");
  });

  it("🚨 model tanınmayan biriyle selamlaştıysa ya da cevap yalnız selamsa: cevaba dokunulmaz, kodun selamı EKLENMEZ (çift selam yok)", () => {
    for (const reply of ["Günaydın Steakhouse, 5 dakika yürüme mesafesinde.", "Hi Michael, the code is 1234.", "Merhaba!", "Merhaba"]) {
      expect(applyCodeGreeting({ ...base, reply, firstReply: true })).toBe(reply);
      expect(applyCodeGreeting({ ...base, reply, firstReply: false })).toBe(reply);
    }
  });

  it("resmî ton da 'Merhaba Ayşe,'; kısa tonda selam yok; ad yoksa adsız; dil belirsizse selam yok", () => {
    expect(applyCodeGreeting({ ...base, tone: "formal", reply: "Çıkış 11:00.", firstReply: true })).toBe("Merhaba Ayşe,\n\nÇıkış 11:00.");
    expect(applyCodeGreeting({ ...base, tone: "short", reply: "Çıkış 11:00.", firstReply: true })).toBe("Çıkış 11:00.");
    expect(applyCodeGreeting({ ...base, name: null, reply: "Çıkış 11:00.", firstReply: true })).toBe("Merhaba,\n\nÇıkış 11:00.");
    expect(applyCodeGreeting({ ...base, language: "it", reply: "Il check-out è alle 11.", firstReply: true })).toBe(
      "Il check-out è alle 11.",
    );
  });
});

describe("geçmişteki KODUN selam satırı (anahtar açıkken istemden çıkar)", () => {
  it.each([
    ["Merhaba Su,\n\nWi-Fi 1234.", "Su", "Wi-Fi 1234."],
    ["Merhaba,\n\nWi-Fi 1234.", null, "Wi-Fi 1234."],
    ["Hello Su,\nThe code is 1234.", "Su", "The code is 1234."],
    ["Здравствуйте, Су!\n\nКод 1234.", "Су", "Код 1234."],
    ["Hello,\n\nThe code is 1234.", "Su", "The code is 1234."],
  ])("🚨 %j (ad %j) → %j", (body, name, expected) => {
    expect(withoutCodeGreetingLine(body, name)).toBe(expected);
  });

  it.each([
    ["Merhaba Ali,\n\nWi-Fi 1234.", "Su"], // başka ad: kodun satırı değil
    ["Merhaba Su, Wi-Fi 1234.", "Su"], // aynı satırda devam: kodun biçimi değil
    ["Merhaba,", null], // geriye metin kalmıyor
    ["Merhaba Su,\n\n  \n", "Su"], // selam satırından sonra yalnız boş satırlar: gövde aynen (boş geçmiş satırı olmaz)
    ["Wi-Fi 1234.\nMerhaba Su,", "Su"], // yalnız İLK satır
  ])("KONTROL — dokunulmaz: %j", (body, name) => {
    expect(withoutCodeGreetingLine(body, name)).toBe(body);
  });
});

describe("uzun yalnız-selam cevap (tarama penceresinden uzun)", () => {
  it("selam + uzun boşluk: yine selamdan ibaret sayılır — dokunulmaz, kodun selamı eklenmez", () => {
    const reply = `Merhaba!${" ".repeat(300)}`;
    expect(applyCodeGreeting({ tone: "warm", language: "tr", name: "Ayşe", reply, firstReply: true })).toBe(reply);
  });
});
