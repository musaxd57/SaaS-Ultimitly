import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { composeClosingCourtesy } from "@/lib/automation";

// Tur 7 S7-2: nezaket metni yer tutucuları TEK GEÇİŞTE doldurulur — adın içeriği yeniden şablon olarak çalışmaz.
describe("composeClosingCourtesy — yer tutucular", () => {
  const base = { kind: "ack" as const, lang: "tr", signature: "Sevgiler,\nAli" };

  it("{isim} ve {daire} doldurulur; imza sonda", () => {
    expect(composeClosingCourtesy({ ...base, customText: "Rica ederiz {isim}, {daire} numarada iyi konaklamalar!", guestFirstName: "Ayşe", propertyName: "Lale 7" })).toBe(
      "Rica ederiz Ayşe, 7 numarada iyi konaklamalar!\n\nSevgiler,\nAli",
    );
  });

  it("🚨 tek geçiş: adın içindeki '{daire}' yeniden doldurulmaz (ham kalır → gönderim kapısı durdurur)", () => {
    const out = composeClosingCourtesy({ ...base, customText: "Rica ederiz {isim}!", guestFirstName: "{daire}", propertyName: "Lale 7" });
    expect(out).toContain("Rica ederiz {daire}!");
    expect(out).not.toContain("Rica ederiz 7");
  });

  it("ad bilinmiyor → adsız hitap; varsayılan metin aynen; yalnız belirteçten oluşan metin varsayılana düşer", () => {
    expect(composeClosingCourtesy({ ...base, customText: "Rica ederiz {isim}, iyi günler!", guestFirstName: null })).toBe("Rica ederiz, iyi günler!\n\nSevgiler,\nAli");
    expect(composeClosingCourtesy({ ...base, customText: null, signature: null, guestFirstName: "Ayşe" })).toBe(composeClosingCourtesy({ ...base, customText: null, signature: null }));
    expect(composeClosingCourtesy({ ...base, customText: "{isim}", signature: null, guestFirstName: null })).toBe(composeClosingCourtesy({ ...base, customText: null, signature: null }));
  });
});
