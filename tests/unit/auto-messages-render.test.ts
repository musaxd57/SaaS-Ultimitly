import { describe, it, expect } from "vitest";
import { autoMessageIssue, isAutoMessageKind, previewAutoMessage, AUTO_MESSAGE_ISSUE_TEXT } from "@/lib/auto-messages/render";

// ---------------------------------------------------------------------------
// KURUCU T4 (10-21): otomatik mesajın "gönderilebilir mi" kuralı (kart uyarısı + önizleme) — gönderici kapısıyla AYNI sıra: boş → daire
// numarası çözülemiyor → doldurulmamış alan. Önizleme misafire gidecek metnin aynısı (örnek ad "Ayşe").
// ---------------------------------------------------------------------------

describe("autoMessageIssue", () => {
  it("boş / yalnız boşluk → empty", () => {
    expect(autoMessageIssue("", "Lale Daire 5")).toBe("empty");
    expect(autoMessageIssue("  \n ", "Lale Daire 5")).toBe("empty");
  });
  it("{daire} kullanıyor + mülk adında numara yok → apartment_unresolved; numara varsa sorun yok", () => {
    expect(autoMessageIssue("Daire {daire} hazır.", "Lale")).toBe("apartment_unresolved");
    expect(autoMessageIssue("Daire {daire} hazır.", "Lale Daire 5")).toBeNull();
  });
  it("doldurulmamış alan ([…], {{…}}, tanınmayan {kod}) → unfilled", () => {
    expect(autoMessageIssue("Adres: [AÇIK ADRES]", "Lale 5")).toBe("unfilled");
    expect(autoMessageIssue("Wi-Fi: {{wifi}}", "Lale 5")).toBe("unfilled");
    expect(autoMessageIssue("Kapı kodu: {kod}", "Lale 5")).toBe("unfilled");
  });
  it("KONTROL: {isim} ve düz metin sorun değil", () => {
    expect(autoMessageIssue("Merhaba {isim}, kod 4821.", "Lale 5")).toBeNull();
  });
});

describe("previewAutoMessage", () => {
  it("misafire gidecek metin: selam + örnek ad + imza; {daire} çözülür", () => {
    const p = previewAutoMessage("Daire {daire} sizi bekliyor.", "Lale Daire 5", "Lale Ekibi");
    expect(p.issue).toBeNull();
    expect(p.text).toBe("Merhaba Ayşe,\n\nDaire 5 sizi bekliyor.\n\nLale Ekibi");
  });
  it("{isim} kullanan metin AYNEN (ev sahibinin kendi selamı)", () => {
    expect(previewAutoMessage("Selam {isim}!", "Lale 5").text).toBe("Selam Ayşe!");
  });
  it("doldurulmamış alan → sebep + alan adları; boş → metin yok", () => {
    const p = previewAutoMessage("Adres: [AÇIK ADRES]", "Lale 5");
    expect(p.issue).toBe("unfilled");
    expect(p.unfilledTokens).toContain("[AÇIK ADRES]");
    expect(previewAutoMessage("", "Lale 5")).toEqual({ text: "", issue: "empty", unfilledTokens: [] });
  });
  it("tür kümesi kapalı; sebep metinleri sade", () => {
    expect(["welcome", "checkin", "checkout"].every(isAutoMessageKind)).toBe(true);
    expect(isAutoMessageKind("general")).toBe(false);
    for (const t of Object.values(AUTO_MESSAGE_ISSUE_TEXT)) expect(t).toMatch(/gönderilmez/);
  });
});
