import { describe, it, expect } from "vitest";
import { buildReplyPrompt, buildReplyUserPrompt } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// İSTEMİN ZAMAN SATIRLARI (Konuşma Anlama Durumu v1, dilim A — 09-25). Model bugünün tarihini/gününü bilmiyordu ve
// "Zaman bağlamı" sunucu saatiyle yanlış günü söylüyordu. Bağlantı DAVRANIŞSAL pinlenir: istem METNİNE ne girdiği ölçülür.
// ---------------------------------------------------------------------------

const base: SuggestReplyInput = {
  guestMessage: "Yarın erken olabilir mi?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: {
    guestName: "Test Misafir",
    arrivalDate: new Date("2026-09-23T00:00:00.000Z"),
    departureDate: new Date("2026-09-26T00:00:00.000Z"),
    status: "confirmed",
  },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
  timeZone: "Europe/Istanbul",
};

describe("istem — bugün/yarın + konaklama evresi org diliminde", () => {
  it("🚨 çıkış sabahı (İstanbul 03:30): istem 'tamamlandı' DEMEZ, 'Çıkış günü BUGÜN' der; bugünün tarihi ve günü yazar", () => {
    const p = buildReplyUserPrompt({ ...base, now: new Date("2026-09-26T00:30:00.000Z") });
    expect(p).toContain("Bugün: 26.09.2026 Cumartesi, saat 03:30 (Europe/Istanbul) · Yarın: 27.09.2026 Pazar");
    expect(p).toContain("Zaman bağlamı: Çıkış günü BUGÜN: 26.09.2026 Cumartesi (standart çıkış saati 11:00).");
    expect(p).not.toContain("Konaklama tamamlandı");
    expect(p).toContain("Giriş: 23.09.2026 Çarşamba | Çıkış: 26.09.2026 Cumartesi");
    expect(p).toContain('göreli gün ifadelerini ("bugün", "yarın", "o gün") bu tarihlere göre çöz');
  });

  it("🚨 varıştan önceki akşam: 'Giriş YARIN' (eskiden 'Girişe 0 gün kaldı')", () => {
    const p = buildReplyUserPrompt({
      ...base,
      reservation: { ...base.reservation!, arrivalDate: new Date("2026-09-26T00:00:00.000Z"), departureDate: new Date("2026-09-29T00:00:00.000Z") },
      now: new Date("2026-09-25T18:00:00.000Z"),
    });
    expect(p).toContain("Zaman bağlamı: Giriş YARIN: 26.09.2026 Cumartesi (standart giriş saati 15:00).");
    expect(p).not.toMatch(/Girişe 0 gün/);
  });

  it("🚨 org'un KENDİ dilimi kullanılır (varsayılan değil): New York'ta 25.09 22:00 iken İstanbul çoktan 26.09'du", () => {
    const p = buildReplyUserPrompt({ ...base, reservation: null, timeZone: "America/New_York", now: new Date("2026-09-26T02:00:00.000Z") });
    expect(p).toContain("Bugün: 25.09.2026 Cuma, saat 22:00 (America/New_York) · Yarın: 26.09.2026 Cumartesi");
  });

  it("🚨 bilgi tabanıyla ÇELİŞEN standart saat zaman satırında tekrarlanmaz (P4-b 'kesin saat söyleme' bloğuyla tutarlı)", () => {
    const kbConflict = [{ category: "checkout", title: "Çıkış", content: "Çıkış saati 12:00'dir." }];
    const p = buildReplyUserPrompt({ ...base, knowledgeBase: kbConflict, now: new Date("2026-09-26T05:00:00.000Z") });
    expect(p).toContain("KAYNAK ÇELİŞKİSİ");
    expect(p).toContain("Zaman bağlamı: Çıkış günü BUGÜN: 26.09.2026 Cumartesi.");
    expect(p).not.toContain("standart çıkış saati 11:00");
  });

  it("komşu rezervasyon günleri org diliminde + gün adıyla (sunucu saatiyle DEĞİL — inceleme 09-25)", () => {
    const p = buildReplyUserPrompt({
      ...base,
      timeZone: "America/New_York",
      now: new Date("2026-09-24T14:00:00.000Z"),
      // Anlık değer: 20.09 02:00Z = New York 19.09 22:00 (UTC'de yazılsaydı 20.09 görünürdü).
      adjacency: { previousDeparture: new Date("2026-09-20T02:00:00.000Z"), nextArrival: new Date("2026-09-30T00:00:00.000Z"), previousSameDay: false, nextSameDay: false },
    });
    expect(p).toContain("Giriş gününden önceki kayıtlı son çıkış: 19.09.2026 Cumartesi");
    expect(p).toContain("Çıkıştan sonraki ilk kayıtlı giriş: 30.09.2026 Çarşamba");
  });

  it("saat satırı iddia desteği ölçümünün bağlamına girer (cevaptaki bugünün tarihi 'desteksiz' görünmesin)", () => {
    const { claimContext } = buildReplyPrompt({ ...base, now: new Date("2026-09-25T07:40:00.000Z") });
    expect(claimContext.facts.some((f) => f.includes("Bugün: 25.09.2026 Cuma"))).toBe(true);
  });

  it("dilim verilmezse uygulamanın varsayılan dilimi kullanılır (satır yine yazılır)", () => {
    const p = buildReplyUserPrompt({ ...base, timeZone: undefined, now: new Date("2026-09-25T07:40:00.000Z") });
    // Uygulama varsayılanı (Europe/Istanbul): 07:40Z = 10:40 (UTC'ye düşseydi 07:40 yazardı — test boşluğu 09-25).
    expect(p).toContain("Bugün: 25.09.2026 Cuma, saat 10:40 (Europe/Istanbul) · Yarın: 26.09.2026 Cumartesi");
  });

  it("rezervasyon yoksa da bugünün tarihi yazılır (QR / ön-rezervasyon soruları)", () => {
    const p = buildReplyUserPrompt({ ...base, reservation: null, now: new Date("2026-09-25T07:40:00.000Z") });
    expect(p).toContain("Bugün: 25.09.2026 Cuma, saat 10:40 (Europe/Istanbul)");
    expect(p).toContain("(bu konuşma bir rezervasyona bağlı değil)");
  });
});
