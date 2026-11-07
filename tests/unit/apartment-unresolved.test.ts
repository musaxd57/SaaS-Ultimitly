import { describe, it, expect } from "vitest";
import {
  UNRESOLVED_APARTMENT_MARK,
  apartmentResolvable,
  fillGuestPlaceholders,
  fillGuestPlaceholdersInItems,
  leftoverGuestTokens,
  usesApartmentToken,
} from "@/lib/kb-placeholders";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { packKnowledgeBase } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — ÇÖZÜLEMEYEN `{daire}` TAHMİN EDİLMEZ, YALNIZ O MESAJ GİTMEZ. Mülk adından daire numarası okunamıyorsa:
//  · yapay zekâ bağlamında belirteç `[DAİRE NO]` olur → istem "DOLDURULMAMIŞ YER TUTUCU" notu (uydurma yok), cevapta geçerse veto;
//  · misafire AYNEN giden mesaj metni belirteci korur → gönderici ve çıktı vetosu aynı yüklemle (`leftoverGuestTokens`) durdurur;
//  · çözülebilen mülkte davranış aynı.
// ---------------------------------------------------------------------------

describe("daire numarası çözülemiyor", () => {
  it("🚨 yapay zekâ bağlamında `[DAİRE NO]` (numara uydurulmaz); çözülebilirse numara", () => {
    const items = [{ title: "Adres", content: "Daireniz {daire}, kat 2." }];
    expect(fillGuestPlaceholdersInItems(items, { guestFirstName: "Ada", propertyName: "Lale" })[0].content).toBe(
      `Daireniz ${UNRESOLVED_APARTMENT_MARK}, kat 2.`,
    );
    expect(fillGuestPlaceholdersInItems(items, { guestFirstName: "Ada", propertyName: "Lale Daire 5" })[0].content).toBe("Daireniz 5, kat 2.");
  });

  it("🚨 işaret istemde DOLDURULMAMIŞ YER TUTUCU notunu doğurur", () => {
    const [item] = fillGuestPlaceholdersInItems([{ category: "location", title: "Adres", content: "Daireniz {daire}." }], {
      guestFirstName: "Ada",
      propertyName: "Lale",
    });
    expect(packKnowledgeBase([item]).text).toMatch(/DOLDURULMAMIŞ YER TUTUCU/);
  });

  it("🚨 misafire giden metinde belirteç KALIR ve kalan belirteç yüklemi onu görür", () => {
    const body = fillGuestPlaceholders("Merhaba {isim}, daireniz {daire}.", { guestFirstName: "Ada", propertyName: "Lale" });
    expect(body).toBe("Merhaba Ada, daireniz {daire}.");
    expect(leftoverGuestTokens(body)).toEqual(["{daire}"]);
    expect(leftoverGuestTokens(fillGuestPlaceholders("Daireniz {daire}.", { guestFirstName: "Ada", propertyName: "Lale Daire 5" }))).toEqual([]);
  });

  it("🚨 yapay zekâ cevabında kalmış `{daire}` / `{isim}` / işaret misafire GİTMEZ", () => {
    expect(vetoOutgoingReply("Dairenizin numarası {daire}.")).toBe("placeholder_in_reply");
    expect(vetoOutgoingReply("Merhaba {isim}, hoş geldiniz.")).toBe("placeholder_in_reply");
    expect(vetoOutgoingReply(`Dairenizin numarası ${UNRESOLVED_APARTMENT_MARK}.`)).toBe("placeholder_in_reply");
    // KONTROL — tanınmayan süslü parantez cevap metninde veto sebebi değil.
    expect(vetoOutgoingReply("Kahvaltı {sabah} 9'da.")).toBeNull();
  });

  it("mülk sayfası kuralı: çözülebilirlik + belirteç kullanımı", () => {
    expect(apartmentResolvable("Lale")).toBe(false);
    expect(apartmentResolvable("Lale Daire 5")).toBe(true);
    expect(usesApartmentToken("Daireniz {DAİRE}.")).toBe(true);
    expect(usesApartmentToken("Daireniz {apt}.")).toBe(true);
    expect(usesApartmentToken("Merhaba {isim}.")).toBe(false);
  });
});
