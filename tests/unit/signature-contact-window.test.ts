import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// İMZANIN İLETİŞİM SATIRI (kurucu kararı 4.14, 10-28: "Telefon satırı çıkarılıp cevap gitsin"). Airbnb rezervasyon onayından önce telefon /
// e-posta / bağlantı içeren mesajı engeller; Ayarlar ekranı imzaya telefon yazmayı öneriyor. Onaysız konuşmada imzanın iletişim değeri
// taşıyan SATIRI çıkarılır, cevap kalan imzayla gider; onaylı konaklamada imza bugünkü gibi tam. Satırın yalnız numarası silinmez —
// "📞" / "Tel:" artığı kırık satır bırakırdı (kurucu R-S1: "asla kırık cümle").
// ---------------------------------------------------------------------------
import { signatureForContactWindow } from "@/lib/channels/airbnb-message-policy";
import { containsContactValue } from "@/lib/contact-redact";

describe("signatureForContactWindow — pencere dışında imza AYNEN", () => {
  it("onaylı konaklama (pencere kapalı): telefonlu imza da aynen", () => {
    expect(signatureForContactWindow("Sevgiler,\nAli\n📞 +90 532 123 45 67", false)).toBe("Sevgiler,\nAli\n📞 +90 532 123 45 67");
  });
  it("boş / yok → imza yok", () => {
    expect(signatureForContactWindow(null, true)).toBeNull();
    expect(signatureForContactWindow("   ", true)).toBeNull();
    expect(signatureForContactWindow(undefined, false)).toBeNull();
  });
  it("iletişim değeri olmayan imza pencerede de AYNEN (Telefon sözcüğü değer değildir)", () => {
    expect(signatureForContactWindow("Sevgiler,\nAli", true)).toBe("Sevgiler,\nAli");
    expect(signatureForContactWindow("🌿 Lale Konaklama 🌿\nTelefonla da ulaşabilirsiniz", true)).toBe("🌿 Lale Konaklama 🌿\nTelefonla da ulaşabilirsiniz");
  });
});

describe("signatureForContactWindow — onaysız Airbnb: iletişim satırı çıkar", () => {
  it("🚨 kurucunun örneği: 'Sevgiler, Ali / 📞 +90 532 …' → 'Sevgiler,\\nAli'", () => {
    expect(signatureForContactWindow("Sevgiler,\nAli\n📞 +90 532 123 45 67", true)).toBe("Sevgiler,\nAli");
  });
  it("e-posta, web adresi, sosyal medya bağlantısı satırları da çıkar; öteki satırlar sırasıyla kalır", () => {
    const sig = "Sevgiler,\nLale Konaklama\nali@ornek.com\nwww.ornek.com.tr\ninstagram.com/ornekev\nİyi tatiller!";
    expect(signatureForContactWindow(sig, true)).toBe("Sevgiler,\nLale Konaklama\nİyi tatiller!");
  });
  it("🚨 kırık satır kalmaz: yalnız emoji / yalnız etiket satırı ('📞', 'Tel:', 'WhatsApp') da çıkar", () => {
    expect(signatureForContactWindow("Sevgiler, Ali\n📞\n+90 532 123 45 67", true)).toBe("Sevgiler, Ali");
    expect(signatureForContactWindow("Ali Yılmaz\nTel:\n0532 123 45 67", true)).toBe("Ali Yılmaz");
    expect(signatureForContactWindow("Ali Yılmaz\nWhatsApp\n+90 532 123 45 67\nE-posta:\nali@ornek.com", true)).toBe("Ali Yılmaz");
    expect(signatureForContactWindow("Best,\nAli\nPhone: \n+44 20 7946 0958", true)).toBe("Best,\nAli");
  });
  it("tek satırda ad + numara → satırın tamamı çıkar (yarım satır yok); hiçbir şey kalmazsa imzasız", () => {
    expect(signatureForContactWindow("Ali · +90 532 123 45 67", true)).toBeNull();
    expect(signatureForContactWindow("Sevgiler,\nAli · +90 532 123 45 67", true)).toBe("Sevgiler,");
  });
  it("araya giren boş satırlar teke iner, baş / son boşluk kalmaz", () => {
    expect(signatureForContactWindow("Sevgiler,\n\n+90 532 123 45 67\n\nAli\n", true)).toBe("Sevgiler,\n\nAli");
  });
  it("satırlara bölünmüş numara satır satır görünmez → çıktı hâlâ iletişim değeri taşır (gönderim kapısı TUTAR, kemer)", () => {
    const out = signatureForContactWindow("Ali\n+90 532\n123 45 67", true);
    expect(containsContactValue(out)).toBe(true);
  });
  it("Windows satır sonu (CRLF) da satır sayılır", () => {
    expect(signatureForContactWindow("Sevgiler,\r\nAli\r\n+90 532 123 45 67", true)).toBe("Sevgiler,\nAli");
  });
});
