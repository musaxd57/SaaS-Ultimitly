import { describe, it, expect } from "vitest";
import { detectGuestLanguage } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// 🚨 ALMANCA SORULAR İNGİLİZCE SANILIYORDU (ölçüm turu, 09-11).
//
// `docs/OLCUM-2026-09-11-few-shot-ve-istem-butcesi.md` §"dil bazında": Almanca
// dalı YALNIZ `ich|sie|bitte|danke|hallo|ist|und|für|schön|grüße` listesine
// bakıyordu — yani bir SELAMLAMA ya da NEZAKET kelimesi geçmeyen düz bir Almanca
// SORU hiçbirine uymuyordu:
//     "Wie lautet das WLAN-Passwort?"  → en
//     "Wo sind die Handtücher?"        → en
//     "Gibt es einen Parkplatz?"       → en
//
// ÜÇ YERDE ETKİSİ VAR (hepsi ölçüldü, hiçbiri kozmetik değil):
//  ① `automation.ts:441` bekletme mesajının DİLİ → Alman misafire İngilizce
//     "we'll get back to you" gidiyordu.
//  ② `automation.ts:592` kapanış nezaketinin dili.
//  ③ `retrieval/select.ts:355` `queryIsTurkish` → n-gram aday kaynağı kapısı.
//
// ⚠️ DAR DÜZELTME: yalnız İngilizce VE Türkçe ile çarpışmayan Almanca işlevsel
// kelimeler eklendi. Aşağıdaki İKİNCİ blok bu şartın kendisidir — çarpışma
// olursa ürün bu kez İngilizce/Türkçe misafire ALMANCA metin gönderirdi.
// ---------------------------------------------------------------------------

describe("detectGuestLanguage — Almanca SORULAR", () => {
  it("🚨 ölçülen üç vaka (raporun kendisi)", () => {
    for (const q of ["Wie lautet das WLAN-Passwort?", "Wo sind die Handtücher?", "Gibt es einen Parkplatz?"]) {
      expect(detectGuestLanguage(q), q).toBe("de");
    }
  });

  it("🚨 HER İŞARET TEK BAŞINA PİNLİ — izole cümleler", () => {
    // ⚠️ Mutasyon turu şunu ölçtü: ilk fikstürlerim BİRDEN ÇOK Almanca işareti
    // taşıyordu, o yüzden tek bir kelimeyi silen mutantlar HAYATTA KALIYORDU
    // (M2 `wie` · M4 `gibt` · M5 `kann` · M6 `mein`). Aşağıdaki her cümle
    // YALNIZ bir yeni işaret içerir — silinen her kelime kendi satırını düşürür.
    const isolated: [string, string][] = [
      ["wie ", "Wie funktioniert der Herd?"],
      ["wo ", "Wo bleibt der Müll?"],
      ["wann", "Wann kommt die Reinigung?"],
      ["warum", "Warum tropft der Wasserhahn?"],
      ["welche", "Welche Etage bitte"],
      ["wieviel", "Wieviel kostet die Reinigung?"],
      ["gibt ", "Gibt es Frühstück?"],
      ["haben ", "Haben Gäste Parkplätze?"],
      ["können", "Können Gäste parken?"],
      ["kann ", "Kann man später auschecken?"],
      ["nicht", "Der Herd funktioniert nicht."],
      ["das ", "Das Fenster klemmt."],
      ["mit ", "Probleme mit dem Herd."],
      ["zum ", "Weg zum Strand?"],
      ["zur ", "Weg zur Apotheke?"],
      ["wir ", "Wir brauchen Adapter."],
      ["mein", "Meine Dusche tropft."],
      ["unser", "Unsere Dusche tropft."],
      ["einen", "Brauchen Gäste einen Adapter?"],
      ["kein", "Kein Warmwasser."],
    ];
    for (const [marker, q] of isolated) {
      expect(detectGuestLanguage(q), `${marker} → ${q}`).toBe("de");
    }
  });

  it("mevcut selamlama/nezaket yolu BOZULMADI", () => {
    for (const q of ["Hallo, wie geht es Ihnen?", "Danke schön für alles!", "Bitte helfen Sie mir."]) {
      expect(detectGuestLanguage(q), q).toBe("de");
    }
  });
});

describe("🚨 ÇARPIŞMA BATARYASI — İngilizce ve Türkçe ALMANCAYA KAYMAZ", () => {
  it("İngilizce misafir mesajları `en` kalır", () => {
    for (const q of [
      "What is the wifi password?",
      "Where is the parking?",
      "Is there a washing machine?",
      "The batteries die quickly, can you replace them?",
      "Can I check out later?",
      "We need more towels please.",
      "My room is not clean.",
      "Which floor is the apartment on?",
      "When can we check in?",
      "The air conditioning does not work.",
      "Do you have a spare key for us?",
      "How much is the cleaning fee?",
      // 🚨 KELİME SINIRI PİNİ (mutasyon turu: sınırsız mutant HAYATTA KALMIŞTI).
      // Bu cümlede Almanca işaretleri ALTDİZİ olarak var: "would"→wo · "two"→wo
      // · "wire"→wir · "admit"→mit · "keine"→kein. Sınır kalkarsa `de` olur ve
      // İngiliz misafire ALMANCA bekletme mesajı gider.
      "Would you send two towels? The wire basket is broken, I admit.",
      "We cannot transmit the code to the wireless keypad.",
      // 🚨 ÇEKİM GRUBUNUN baştaki sınırı: bu cümlede "being" ve "protein"
      // içinde `ein` ALTDİZİ olarak var. Sınır kalkarsa `de` olur.
      "Is the heater being repaired? The protein bars are ours.",
    ]) {
      expect(detectGuestLanguage(q), q).toBe("en");
    }
  });

  it("Türkçe misafir mesajları `tr` kalır", () => {
    for (const q of [
      "Wifi şifresi nedir?",
      "Otopark var mı?",
      "Merhaba, nasılsınız?",
      "Anahtar nerede acaba?",
      "Teşekkür ederim, her şey güzeldi.",
      "Klima çalışmıyor.",
    ]) {
      expect(detectGuestLanguage(q), q).toBe("tr");
    }
  });

  it("Fransızca / Arapça / Rusça yolları BOZULMADI", () => {
    expect(detectGuestLanguage("Où est le parking ?")).toBe("fr");
    expect(detectGuestLanguage("Bonjour, merci pour tout.")).toBe("fr");
    expect(detectGuestLanguage("Какой пароль от вайфая?")).toBe("ru");
    expect(detectGuestLanguage("ما هي كلمة مرور الواي فاي؟")).toBe("ar");
  });

  it("⚠️ TÜRKÇE ÖNCE GELİR — Türkçe işareti varsa Almanca adayları ezilir", () => {
    // Sıra sözleşmesi: TR dalı en başta. "mit"/"das" gibi bir dizi Türkçe bir
    // cümlede tesadüfen geçse bile TR işareti (ç/ğ/ı/ş ya da TR kelimesi) kazanır.
    expect(detectGuestLanguage("Şifre nedir, das ne demek?")).toBe("tr");
  });
});
