import { describe, it, expect } from "vitest";
import { unverifiedActionClaims } from "../helpers/claim-detectors";

// ---------------------------------------------------------------------------
// MAKBUZSUZ TAAHHÜT DEDEKTÖRÜ — ölçüm (tests/helpers), ürün kapısı DEĞİL (P5 açık).
//
// 4. gerçek koşu (09-09) E4 karşı örneği bir boşluğu açığa çıkardı: "ev sahibiniz
// size iletecek" TEMİZ sayılıyordu — kalıp gelecek ekini yalnız birinci şahıs
// "-eceğ-" biçimiyle yakalıyordu. Üçüncü şahıs söz de makbuzsuzdur (kim, ne
// zaman?). Fiil listesi DEĞİŞMEDİ; yalnız çekim boşluğu kapandı.
// ---------------------------------------------------------------------------

describe("makbuzsuz taahhüt — üçüncü şahıs gelecek zaman", () => {
  it("üçüncü şahıs sözler YAKALANIR (eski kalıp hepsini kaçırıyordu)", () => {
    for (const t of [
      "Şifre kayıtlarımda yok; ev sahibiniz size iletecek.",
      "Bu konuyu ev sahibimiz değerlendirecek.",
      "Ev sahibiniz sizinle paylaşacak.",
      "Ev sahibiniz size dönecek.",
      "En kısa sürede dönüş yapacaktır.",
      "Ev sahibiniz sizinle iletişime geçecek.",
      "Size haber verecek.",
      "Ev sahibiniz kodu gönderecek.",
      "Ev sahibiniz halledecek.",
      "Ev sahibiniz sizi bilgilendirecek.",
      "Ev sahibiniz inceleyecek.",
    ]) {
      expect(unverifiedActionClaims(t), t).toContain("future_commitment");
    }
  });

  it("birinci şahıs biçimleri KORUNUR; cümle başı noktalı İ de yakalanır", () => {
    for (const t of ["Detayları ileteceğim.", "Değerlendireceğiz.", "size dönüş yapacağım", "İleteceğim.", "İlettim, merak etmeyin."]) {
      expect(unverifiedActionClaims(t).length, t).toBeGreaterThan(0);
    }
    expect(unverifiedActionClaims("İlettim, merak etmeyin.")).toContain("past_action");
  });

  it("OLGU bildiren cümleler TEMİZ: kayıt + görünürlük, yetenek ('iletebilir'), yönlendirme ('isteyebilirsiniz'), 'gelecek hafta'", () => {
    for (const t of [
      "Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir.",
      "Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.",
      "Ev sahibiniz bu bilgiyi iletebilir.",
      "Gelecek hafta için rezervasyon platform üzerinden yapılır.",
      "Bu konu ev sahibinizin kararıdır.",
    ]) {
      expect(unverifiedActionClaims(t), t).toEqual([]);
    }
  });
});
