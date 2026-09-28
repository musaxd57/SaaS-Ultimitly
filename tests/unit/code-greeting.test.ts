import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyCodeGreeting,
  codeGreetingEnabled,
  greetingLine,
  modelGuestFirstName,
  salutationNameOf,
  stripLeadingGreeting,
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
    ["Merhaba Ayşe Hanım, şifre 1234.", "tr", "Şifre 1234."],
    ["Merhaba, iyiyiz.", "tr", "İyiyiz."],
    ["İyi günler, çıkış 11:00.", "tr", "Çıkış 11:00."],
    ["Hi John, the code is 1234.", "en", "The code is 1234."],
    ["Hello!\n\nThanks for asking.", "en", "Thanks for asking."],
    ["Hallo Anna, das WLAN heißt Lale.", "de", "Das WLAN heißt Lale."],
    ["Здравствуйте! Код 1234.", "ru", "Код 1234."],
    ["مرحباً، الرمز 1234.", "ar", "الرمز 1234."],
  ])("%j", (reply, lang, expected) => {
    expect(stripLeadingGreeting(reply, lang)).toBe(expected);
  });

  it.each([
    ["Hi-fi sistemi salonda.", "tr"],
    ["Heyecan verici bir haber: havuz açıldı.", "tr"],
    ["Hizmetimiz 7/24 açık.", "tr"],
    ["Merhaba", "tr"], // selamdan ibaret cevap boşaltılmaz
    ["Wi-Fi şifresi 1234.", "tr"],
  ])("selam değil / tek başına selam → aynen: %j", (reply, lang) => {
    expect(stripLeadingGreeting(reply, lang)).toBe(reply);
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

  it("resmî ton da 'Merhaba Ayşe,'; kısa tonda selam yok; ad yoksa adsız; dil belirsizse selam yok", () => {
    expect(applyCodeGreeting({ ...base, tone: "formal", reply: "Çıkış 11:00.", firstReply: true })).toBe("Merhaba Ayşe,\n\nÇıkış 11:00.");
    expect(applyCodeGreeting({ ...base, tone: "short", reply: "Çıkış 11:00.", firstReply: true })).toBe("Çıkış 11:00.");
    expect(applyCodeGreeting({ ...base, name: null, reply: "Çıkış 11:00.", firstReply: true })).toBe("Merhaba,\n\nÇıkış 11:00.");
    expect(applyCodeGreeting({ ...base, language: "it", reply: "Il check-out è alle 11.", firstReply: true })).toBe(
      "Il check-out è alle 11.",
    );
  });
});
