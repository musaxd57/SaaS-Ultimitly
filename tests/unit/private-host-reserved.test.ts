import { describe, it, expect } from "vitest";
import { isPrivateHost, isPrivateAddress } from "@/lib/net/private-host";

// ---------------------------------------------------------------------------
// SSRF: IP-LİTERAL BESLEME URL'LERİNDE PİNLENMİŞ DNS DOĞRULAMASI KOŞMAZ.
// (Siber güvenlik denetimi, 2026-08-01 — beşinci tur, ajan bulgusu.)
//
// `fetchFeedText` socket'i yalnız DOĞRULANMIŞ-public IP'ye bağlayan bir custom
// `lookup` kullanıyor. AMA Node, hostname bir IP LİTERALİ ise o lookup'ı hiç
// çağırmaz (ampirik doğrulandı: "127.0.0.1" → çağrılmadı, "localhost" → çağrıldı).
// Yani IP-literal bir feed URL'inde TEK savunma `isPrivateAddress` listesidir ve
// o liste birkaç ayrılmış aralığı kaçırıyordu.
//
// ⚠️ Bu eklemeler yalnızca EŞLEŞME EKLER — meşru bir takvim beslemesi bu
// aralıklarda barınmaz (aşağıdaki yanlış-pozitif pini bunu sabitler).
// ---------------------------------------------------------------------------
describe("isPrivateHost — ayrılmış aralıklar ve FQDN sondaki nokta", () => {
  const blocked: [string, string][] = [
    ["192.0.0.170", "192.0.0.0/24 IETF protokol tahsisi"],
    ["198.18.0.1", "198.18.0.0/15 kıyaslama ağı"],
    ["198.19.255.254", "198.18.0.0/15 üst sınır"],
    ["224.0.0.1", "multicast 224/4"],
    ["240.0.0.1", "ayrılmış 240/4"],
    ["255.255.255.255", "sınırlı yayın"],
    ["2002:7f00:1::", "6to4 — gömülü 127.0.0.1"],
    ["localhost.", "sondaki noktalı FQDN"],
    ["foo.railway.internal.", "sondaki noktalı iç ad"],
    // Regresyon pinleri (önceden de engelleniyordu, kırılmasın):
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "bulut metadata"],
    ["10.0.0.5", "özel ağ"],
    ["192.168.1.1", "özel ağ"],
    ["172.16.0.1", "özel ağ"],
    ["100.64.0.1", "CGNAT"],
    ["::ffff:7f00:1", "IPv4-mapped loopback"],
    ["fd00::1", "unique-local"],
    ["fe80::1", "link-local"],
  ];
  for (const [host, why] of blocked) {
    it(`ENGELLER: ${host} (${why})`, () => {
      expect(isPrivateHost(host)).toBe(true);
    });
  }

  const allowed = [
    "www.airbnb.com",
    "calendar.google.com",
    "ical.booking.com",
    "8.8.8.8",
    "1.1.1.1",
    "203.0.113.9",
    "198.51.100.7",
    "223.255.255.255", // 224'ün HEMEN altı — sınır pini
  ];
  for (const host of allowed) {
    it(`İZİN VERİR: ${host}`, () => {
      expect(isPrivateHost(host)).toBe(false);
    });
  }

  it("adres seviyesinde de aynı küme geçerli (tek kaynak)", () => {
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("203.0.113.9")).toBe(false);
  });
});
