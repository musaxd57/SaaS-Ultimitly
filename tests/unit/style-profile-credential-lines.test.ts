import { describe, it, expect } from "vitest";
import { scrubStyleProfileForPublic, styleProfileForPrompt } from "@/lib/guest-chat";
import { markStyleProfile } from "@/lib/ai/style-profile";

// ---------------------------------------------------------------------------
// ÜSLUP PROFİLİ OLGU KAYNAĞI DEĞİLDİR (F13) + erişim sırları bağlamdan TAMAMEN çıkar — 15 ajan incelemesi A07 (10-01, ölçüldü): sır
// süzgeci DEĞER biçimine bakıyordu; rakamsız / iki noktasız Wi-Fi bilgisi ("Wi-Fi: LaleEv / denizkenari", "Ağ adı LaleEv, şifre
// denizkenari diye paylaşır") profilden isteme gidiyordu. Erişim bilgisi ANAN satır değer görünmese de düşer; üslup satırları kalır.
// ---------------------------------------------------------------------------

describe("üslup profili — erişim bilgisi anan satır düşer", () => {
  it.each([
    "Wi-Fi: LaleEv / denizkenari",
    "Ağ adı LaleEv, şifre denizkenari diye paylaşır.",
    "Shares the network name and password as 'LaleEv / seaside'.",
    "Gibt das WLAN-Passwort immer direkt an.",
    "Donne le mot de passe sans attendre.",
    "Comparte la contraseña del wifi al instante.",
    "Сразу сообщает пароль от сети.",
    "Kapı kodunu ilk mesajda verir.",
    "Tells guests the keypad and lockbox details upfront.",
  ])("🚨 düşer: %j", (line) => {
    expect(scrubStyleProfileForPublic(line)).toBeNull();
  });

  it.each([
    "TARZ: Samimi ve kısa yazar, 'Merhaba' ile başlar.",
    "SIK SORULAN: Otopark için bina altını tarif ediyor.",
    "Kodlama gibi teknik terimlerden kaçınır.",
    "Pinpoint answers, no fluff.",
    "Resmî bir dil kullanır, 'siz' der.",
  ])("KONTROL — üslup satırı kalır: %j", (line) => {
    expect(scrubStyleProfileForPublic(line)).toBe(line);
  });

  it("tek giriş (styleProfileForPrompt) de aynı süzgeçten geçer: karışık profilde yalnız üslup kalır", () => {
    const stored = markStyleProfile("Kısa cümleler kurar.\nWi-Fi: LaleEv / denizkenari\nEmoji kullanmaz.");
    expect(styleProfileForPrompt(stored)).toBe("Kısa cümleler kurar.\nEmoji kullanmaz.");
  });
});
