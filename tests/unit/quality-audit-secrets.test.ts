import { describe, it, expect } from "vitest";
import { redactForAudit } from "@/lib/quality-audit";

// ---------------------------------------------------------------------------
// #211 (gece güvenlik turu, S2 bulgusu — çalıştırılarak doğrulandı 09-27): kalite denetçisi (Claude = İKİNCİ veri işleyen) mesaj
// gövdelerini `redactSensitive`ten geçiriyordu; o merkezî log redaksiyonu Türkçe "şifre/kod" etiketini ve kısa kodları tanımıyor →
// "Wifi şifresi lale2024", "Kapı kodu 4821#", "lockbox combination is 0917" AYNEN gidiyordu. Denetim ölçütleri (üslup, risk, dil,
// uydurma saat/adres/kural/ücret) kodun DEĞERİNİ istemez: fazla maskelemek zararsız, eksik maskelemek sızıntı. Saat / tarih / ücret
// KORUNUR (denetçi uydurma saati ve ücreti arar).
// ---------------------------------------------------------------------------

const audit = (s: string) => redactForAudit(s, []);

describe("sır değerleri denetçiye gitmez", () => {
  const CASES: Array<[string, string[]]> = [
    ["Wi-Fi ağı LaleNet, şifresi: Lale2024!", ["Lale2024"]],
    ["Wifi şifresi lale2024", ["lale2024"]],
    ["Kapı kodu 4821#, anahtar kutusu şifresi 1234.", ["4821", "1234"]],
    ["KAPI KODU 4821, WİFİ ŞİFRESİ GUNES99", ["4821", "GUNES99"]],
    ["The door code is 4821 and the lockbox combination is 0917.", ["4821", "0917"]],
    ["Keypad: 5521. Wi-Fi password: SunnyDays99", ["5521", "SunnyDays99"]],
    ["Wi-Fi password: sunnydays", ["sunnydays"]],
    ["WLAN-Passwort: Sonne123", ["Sonne123"]],
    ["Der Zugangscode für die Tür lautet 7788.", ["7788"]],
    ["Mot de passe du wifi : soleil2024", ["soleil2024"]],
    ["Le digicode est 45B12.", ["45B12"]],
    ["La contraseña del wifi es Playa2024 y el código de la puerta 3344.", ["Playa2024", "3344"]],
    ["Пароль от вайфая: Mope2024, код двери 5566.", ["Mope2024", "5566"]],
    ["كلمة المرور: Bahr2024", ["Bahr2024"]],
    ["Ana kapı şifresi 2580*, daire kapısı 1470#", ["2580", "1470"]],
    ["Kasanın şifresi 0000", ["0000"]],
    ["Kod: 9911", ["9911"]],
    ["Giriş için *7391 tuşlayın.", ["7391"]],
    ["Anahtar kutusu kodunu 6612 olarak güncelledik.", ["6612"]],
    // Rakamsız değer yalnız ":" / "=" ile verildiğinde (merkezî redaksiyon Türkçe etiketi tanımıyor).
    ["Kasa şifresi: gunesli", ["gunesli"]],
  ];
  for (const [text, secrets] of CASES) {
    it(`🚨 ${text}`, () => {
      const out = audit(text);
      for (const s of secrets) expect(out, out).not.toContain(s);
      // İngilizce "password: X" biçimini merkezî redaksiyon zaten `[REDACTED]` yapıyor; ikisinden biri görünmeli.
      expect(out).toMatch(/\[GİZLİ\]|\[REDACTED\]/);
    });
  }
});

describe("KONTROL — denetimin ihtiyaç duyduğu olgular korunur", () => {
  const KEEP: Array<[string, string[]]> = [
    ["Giriş 15:00'ten itibaren, çıkış 11:00.", ["15:00", "11:00"]],
    ["Temizlik ücreti 500 TL, depozito ₺1.000.", ["500", "₺1.000"]],
    ["Rezervasyonunuz için 4 kişilik hazırlık yapıldı, 2 yatak odası hazır.", ["4 kişilik", "2 yatak"]],
    ["Daire 3. katta, 12 numara.", ["3. katta", "12 numara"]],
    ["Wi-Fi ağı LaleNet; şifre buzdolabındaki kartta yazıyor.", ["LaleNet", "buzdolabındaki kartta"]],
    ["Havalimanı 25 km, taksi yaklaşık 40 dakika.", ["25 km", "40 dakika"]],
    ["Kapı kodunu giriş günü 12:00'de gönderiyoruz.", ["12:00"]],
    // Etiketin penceresi cümlecikte biter: virgülden sonraki ücret maskelenmez.
    ["Wi-Fi şifresi karttadır, temizlik ücreti 500 TL.", ["karttadır", "500 TL"]],
  ];
  for (const [text, keep] of KEEP) {
    it(text, () => {
      const out = audit(text);
      for (const k of keep) expect(out, out).toContain(k);
      expect(out).not.toContain("[GİZLİ]");
    });
  }

  it("zaten redakte edilmiş yer tutucular yeniden maskelenmez; ad redaksiyonu korunur", () => {
    const out = redactForAudit("Merhaba Ayşe, kod: +90 532 123 45 67 numarasını arayın.", ["Ayşe"]);
    expect(out).toContain("[Misafir]");
    expect(out).toContain("[PHONE]");
    expect(out).not.toContain("[GİZLİ]");
  });

  it("uzun gövde tavanı maskelemeden sonra da korunur", () => {
    const out = redactForAudit(`Kod: 1234. ${"a".repeat(5000)}`, []);
    expect(out.length).toBeLessThan(800);
    expect(out).not.toContain("1234");
  });
});

// ---------------------------------------------------------------------------
// 09-28 inceleme ajanı (çalıştırılarak doğrulandı): etiket listesinde anahtar kutusu / kasa / kapı / keybox / Schlüssel / tuş takımı
// / Wi-Fi yoktu; "(wifi):" ve "for wifi:" ilk değer kuralını kırıyordu; etiketten ÖNCE yazılan değer bakılmıyordu. Ters yönde
// "pass…" kalıbı passenger / passport'u da tutup aynı cümlecikteki ücreti, "3pm" / "11 am" saatini ve saat aralığını maskeliyordu —
// denetçinin tam aradığı olgular.
// ---------------------------------------------------------------------------

describe("09-28 — eksik sır etiketleri ve değer önce yazımı", () => {
  it.each([
    ["Anahtar kutusu: 4821", "4821"],
    ["Kasa: 0917", "0917"],
    ["Kasa 0917", "0917"],
    ["Kapı: 4821", "4821"],
    ["Bina kapısı 4821", "4821"],
    ["Otopark kapısı: 1234", "1234"],
    ["keybox 4821", "4821"],
    ["Schlüsselbox 4821", "4821"],
    ["WLAN-Schlüssel: sonne2024", "sonne2024"],
    ["Kapıdaki tuş takımına 4821 girin", "4821"],
    ["Use 4821 to open the lockbox", "4821"],
    ["Password for wifi: gunesli", "gunesli"],
    ["Şifre (wifi): gunesli", "gunesli"],
    ["WiFi: gunesli2024", "gunesli2024"],
    ["The pass 4821 opens the gate", "4821"], // çıplak "pass" etiket kalır ("Pass: x" zaten merkezî redaksiyonda)
  ])("🚨 %j → %j gitmez", (text, secret) => {
    expect(audit(text)).not.toContain(secret);
    expect(audit(text)).toContain("[GİZLİ]");
  });

  it.each([
    ["Kapı kodu 4821, check-in is from 3pm", "3pm"],
    ["Kapı kodu 4821 ve erken giriş ücreti 450 TL", "450 TL"],
    ["Kod 4821, check-out by 11 am", "11 am"],
    ["Kapı kodu 4821 ve çıkış 11 am", "11 am"], // aynı cümlecikte: 1–12 + am/pm saattir (mutasyon M5)
    ["Shuttle for passengers 2 adults and 1 child", "2 adults"], // passenger etiket değil (mutasyon M1)
    ["Kapı kodu 4821 giriş 14:00-16:00 arası", "14:00-16:00"],
    ["Passengers pay 30€ for the shuttle", "30€"],
    ["Passport number is not needed, the fee is 40 EUR", "40 EUR"],
  ])("KONTROL — denetçinin aradığı olgu korunur: %j → %j kalır", (text, fact) => {
    expect(audit(text)).toContain(fact);
  });
});
