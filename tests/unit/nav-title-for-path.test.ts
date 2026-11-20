import { describe, expect, it } from "vitest";
import { NAV_ITEMS, titleForPath } from "@/lib/nav";

// Üst çubuk başlığı (telefonda sayfanın hangi bölüm olduğunu söyleyen tek yer). FB gezisi 11-20: rezervasyon ayrıntısı ve kayıt
// karşılaştırma sayfalarında çubuk "Lixus AI" yazıyordu.

describe("titleForPath", () => {
  it("menüdeki her bölüm kendi adını verir — alt sayfalarında da", () => {
    for (const item of NAV_ITEMS) {
      expect(titleForPath(item.href)).toBe(item.label);
      expect(titleForPath(`${item.href}/abc`)).toBe(item.label);
    }
    expect(titleForPath("/inbox/c1")).toBe("Mesajlar");
    expect(titleForPath("/sent/queue")).toBe("Gönderilenler");
    expect(titleForPath("/guest-chats/x/misafir-ekrani")).toBe("Misafir Sohbetleri");
  });

  it("rezervasyon ayrıntısı ve kayıt karşılaştırma: 'Rezervasyon' (eskiden 'Lixus AI')", () => {
    expect(titleForPath("/reservations/r1")).toBe("Rezervasyon");
    expect(titleForPath("/reservations/compare/r1")).toBe("Rezervasyon");
  });

  it("yol parçası eşleşir: benzer önekli başka bir yol bölüm adını almaz; bilinmeyen yol marka adına düşer", () => {
    expect(titleForPath("/tasksx")).toBe("Lixus AI");
    expect(titleForPath("/sentinel")).toBe("Lixus AI");
    expect(titleForPath("/reservationsx")).toBe("Lixus AI");
    expect(titleForPath("/admin")).toBe("Lixus AI");
    expect(titleForPath("/")).toBe("Lixus AI");
  });
});
