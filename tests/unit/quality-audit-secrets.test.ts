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
