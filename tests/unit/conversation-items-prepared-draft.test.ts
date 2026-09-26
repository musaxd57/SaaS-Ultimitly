import { describe, it, expect } from "vitest";
import { preparedDraftOf, type PreparedDraftMessage } from "@/lib/conversation-items/prepared-draft";

// ---------------------------------------------------------------------------
// HAZIR TASLAK (kurucu 09-26, "Otomatik hazır dursun"): konuşma açılınca yalnız EN SON misafir mesajının kayıtlı taslağı
// gösterilir; ondan sonra giden cevap varsa ya da daha yeni bir misafir mesajı geldiyse taslak bayattır. Müsaitlik uyarısı
// kayıtta yok → yeniden hesaplanır (kelime ağı + taslağın niyet etiketi; temkinli yön).
// ---------------------------------------------------------------------------

const opts = { stayTimes: { checkIn: "15:00", checkOut: "11:00" }, hostOfferText: null };
const m = (
  id: string,
  direction: "inbound" | "outbound",
  body: string,
  draft: string | null = null,
  intent: string | null = null,
): PreparedDraftMessage => ({ id, direction, body, aiSuggestedReply: draft, aiIntent: intent, aiConfidence: 0.9 });

describe("preparedDraftOf — hangi taslak gösterilir", () => {
  it("son mesaj misafirin ve taslağı var → gösterilir, uyarısız", () => {
    expect(preparedDraftOf([m("1", "inbound", "IBAN'ınızı atar mısınız?", "Ödemeler yalnızca platform üzerinden yapılır.", "general")], opts)).toEqual({
      messageId: "1",
      reply: "Ödemeler yalnızca platform üzerinden yapılır.",
      intent: "general",
      confidence: 0.9,
      availabilityCheck: null,
    });
  });

  it("taslaktan sonra giden bir cevap var → bayat, gösterilmez", () => {
    expect(preparedDraftOf([m("1", "inbound", "IBAN?", "taslak", "general"), m("2", "outbound", "Gönderdim.")], opts)).toBeNull();
  });

  it("taslağı olan mesajdan sonra yeni misafir mesajı geldi → eski taslak yeni mesajı karşılamaz", () => {
    expect(preparedDraftOf([m("1", "inbound", "IBAN?", "taslak", "general"), m("2", "inbound", "Wi-Fi şifresi?")], opts)).toBeNull();
  });

  it("son mesaj GİDEN ise taslak alanı dolu olsa bile gösterilmez (yalnız misafir mesajının taslağı)", () => {
    expect(preparedDraftOf([m("1", "inbound", "IBAN?"), { ...m("2", "outbound", "Ödemeler platformdan."), aiSuggestedReply: "taslak" }], opts)).toBeNull();
  });

  it("taslak yok / boş → gösterilmez; boş konuşma → gösterilmez", () => {
    expect(preparedDraftOf([m("1", "inbound", "Merhaba")], opts)).toBeNull();
    expect(preparedDraftOf([m("1", "inbound", "Merhaba", "   ")], opts)).toBeNull();
    expect(preparedDraftOf([], opts)).toBeNull();
  });

  it("niyet / güven kaydı yoksa güvenli varsayılan (genel, 0)", () => {
    const d = preparedDraftOf([{ id: "1", direction: "inbound", body: "Selam", aiSuggestedReply: "Merhaba!", aiIntent: null, aiConfidence: null }], opts);
    expect(d).toMatchObject({ intent: "general", confidence: 0 });
  });
});

describe("preparedDraftOf — müsaitlik uyarısı yeniden hesaplanır (takvim konusu uyarısız görünmez)", () => {
  it("misafirin konaklama isteği (kelime ağı) → uyarı", () => {
    const d = preparedDraftOf([m("1", "inbound", "Erken giriş yapabilir miyiz?", "Tabii, 12:00'de gelebilirsiniz.", "early_checkin")], opts);
    expect(d?.availabilityCheck).not.toBeNull();
  });

  it("kelime ağı görmese de taslağın niyet etiketi konaklama isteği → uyarı (birleşim)", () => {
    const d = preparedDraftOf([m("1", "inbound", "Saat 12 gibi gelsek olur mu?", "Olur.", "early_checkin")], opts);
    expect(d?.availabilityCheck).not.toBeNull();
  });

  it("taslağın kendisi takvim iddiası taşıyor → uyarı", () => {
    const d = preparedDraftOf([m("1", "inbound", "Bir şey sormak istiyorum", "O tarihlerde daire boş, kalabilirsiniz.", "general")], opts);
    expect(d?.availabilityCheck).not.toBeNull();
  });

  it("uyarı turdaki TÜM cevapsız misafir mesajlarına bakar (öndeki istek arkadaki soruya saklanamaz)", () => {
    const d = preparedDraftOf(
      [m("0", "outbound", "Hoş geldiniz"), m("1", "inbound", "Bir gece daha kalabilir miyiz?"), m("2", "inbound", "Bir de IBAN?", "Ödemeler platformdan.", "general")],
      opts,
    );
    expect(d?.messageId).toBe("2");
    expect(d?.availabilityCheck).not.toBeNull();
    // Giden cevaptan ÖNCEKİ istek sayılmaz.
    const answered = preparedDraftOf(
      [m("1", "inbound", "Bir gece daha kalabilir miyiz?"), m("2", "outbound", "Bakıyorum"), m("3", "inbound", "IBAN?", "Ödemeler platformdan.", "general")],
      opts,
    );
    expect(answered?.availabilityCheck).toBeNull();
  });
});
