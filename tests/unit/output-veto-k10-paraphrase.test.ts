import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// K10 (kurucu kararı 09-30, "Hiçbir şey gitmesin"): kayıt / iletme / "ev sahibiniz görebilir" bildirim cümlesi misafire GİTMEZ.
// Tur 4 (11-05, ölçüldü): Konuşma Kayıtları bloğunun "kayıtlı olduğunu ve ev sahibinin görebildiğini söyle" satırı ve istemin
// devir örnekleri modelde şu yeniden ifadelere dönüşüyor ve vetodan GEÇİYORDU:
//   - sıfat "kayıtlı(dır)" ("İsteğiniz kayıtlı"), şimdiki zaman "görebiliyor", "ev sahibiniz tarafından görülebilir";
//   - İngilizce "Your request is recorded and visible to your host", "Your late checkout request has been noted".
// Gerçek ölçüm çıktılarında (docs/olcum + değerlendirme setleri, 32.610 dize) eski / yeni veto farkı 24 dize — 24'ü de bu bildirim
// cümlesi (ör. "Your message is recorded and visible to your host." — bunlar misafire GİDİYORDU). Başka fark yok.
// Yalnız sıkılaştırır: eşleşen cevap tutulur, ev sahibine haber verilir (K-1029-C yönü).
// ---------------------------------------------------------------------------

describe("K10 bildirim cümlesinin yeniden ifadeleri tutulur", () => {
  const HELD = [
    "İsteğiniz kayıtlı ve ev sahibiniz görebiliyor.",
    "Geç çıkış isteğiniz kayıtlı; ev sahibiniz bunu görebiliyor.",
    "Geç çıkış talebiniz sistemde kayıtlı ve ev sahibiniz tarafından görülebiliyor.",
    "Geç çıkış isteğiniz kayıtlıdır ve ev sahibiniz tarafından görülebilir.",
    "Talebiniz kayıtlı.",
    "Şikâyetiniz sistemde kayıtlıdır.",
    "Ev sahibiniz bunu görebiliyor.",
    "Ev sahibiniz mesajınızı görüntüleyebiliyor.",
    "Kayıtlarımda telefon numarası bulunmuyor; mesajlarınız buradan ev sahibiniz tarafından görülebilir.",
    "Your late checkout request is recorded and visible to your host.",
    "Your late checkout request has been noted.",
    "Your request is recorded.",
    "Early check-in depends on the cleaning schedule and needs your host's approval. Your request is noted and visible to your host.",
    "Thank you for confirming. The late checkout offer is until 13:00 for an extra 300 TL; your acceptance is recorded and visible to your host.",
  ];
  for (const text of HELD) {
    it(`🚨 ${text}`, () => {
      expect(vetoOutgoingReply(text)).toBe("handoff_notice");
    });
  }
});

describe("KONTROL — bilgi cümleleri tutulmaz", () => {
  const PASS = [
    "Rezervasyonunuzda tarihleriniz 12–15 Mart olarak kayıtlı.",
    "Tarihleriniz sistemde kayıtlı: 12–15 Mart.",
    "Kayıtlı aracınız için otopark ücretsiz.",
    "Ev sahibinin evi balkondan görülebilir.",
    "Otopark binanın arkasında, girişten görülebilir.",
    "Ev sahibiniz tarafından hazırlanan kahvaltı mutfakta.",
    "Kapı kodunu ekranda görebiliyorsunuz.",
    "Wi-Fi şifresini buzdolabının üzerindeki kartta görebilirsiniz.",
    "Your reservation is recorded for 12–15 March.",
    "The lockbox is next to the door and visible from the street.",
    "The sea is visible to your left from the balcony.",
  ];
  for (const text of PASS) {
    it(text, () => {
      expect(vetoOutgoingReply(text)).toBeNull();
    });
  }
});
