import { describe, it, expect } from "vitest";
import { mapReservationStatus } from "@/lib/channels/hospitable-ingest";

// ---------------------------------------------------------------------------
// REZERVASYON DURUMU EŞLEMESİ (09-27 güvenlik denetimi, AI yüzeyleri ajanı): tanınmayan her değer "confirmed" sayılıyordu. Sır kapısı
// (`kbForStayScope`), istemin onaylı-konaklama kontrolü, erken giriş onayı ve modelsiz giriş bilgisi mesajı bu duruma güvenir →
// reddedilmiş bir talep ("not accepted") ya da bir soru ("inquiry") kapı koduna kadar giden yolu açıyordu. Açıkça olumsuz / soru
// değerleri artık onaylı değil. Bilinmeyen değerin varsayılanı karar bekliyor (sabah kararları K7) — bilinen sınır olarak pinli.
// ---------------------------------------------------------------------------

const m = (status?: string, category?: string) =>
  mapReservationStatus({ status, ...(category ? { reservation_status: { current: { category } } } : {}) } as Parameters<typeof mapReservationStatus>[0]);

describe("açıkça olumsuz / soru değerleri onaylı DEĞİL", () => {
  it("🚨 reddedilmiş talep ('not accepted') ve 'not possible' → cancelled", () => {
    expect(m(undefined, "not accepted")).toBe("cancelled");
    expect(m("not_accepted")).toBe("cancelled");
    expect(m("Not Accepted")).toBe("cancelled");
    expect(m("not possible")).toBe("cancelled");
  });
  it("🚨 soru ('inquiry') → pending", () => {
    expect(m("inquiry")).toBe("pending");
    expect(m(undefined, "inquiry")).toBe("pending");
  });
});

describe("KONTROL — mevcut eşlemeler aynen", () => {
  it("accepted onaylı; request beklemede; declined / cancelled / not_possible iptal; checked_out tamamlandı", () => {
    expect(m("accepted")).toBe("confirmed");
    expect(m("accepted", "accepted")).toBe("confirmed");
    expect(m("request")).toBe("pending");
    expect(m("pending")).toBe("pending");
    expect(m("declined")).toBe("cancelled");
    expect(m("cancelled")).toBe("cancelled");
    expect(m("not_possible")).toBe("cancelled");
    expect(m(undefined, "checked_out")).toBe("completed");
  });
  it("BİLİNEN SINIR (karar bekliyor, K7): tanınmayan değer hâlâ 'confirmed'", () => {
    expect(m("checkpoint")).toBe("confirmed");
    expect(m("")).toBe("confirmed");
  });
});
