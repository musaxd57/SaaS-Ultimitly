import { describe, it, expect, beforeEach } from "vitest";
import { fieldTimeHits, kbPropertyMismatch, __resetFieldTimeHitsCache } from "@/lib/ai/retrieval/time-fields";
import { findTimeConflicts } from "@/lib/ai/prompts";
import type { KbContext, PropertyContext } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// K3 (kurucu kararı 09-30, Codex 3-5): bilgi tabanında OLUMSUZLANAN saat alanın değeri DEĞİLDİR, düzeltme saati okunur.
// Bugün "Check-out is not at 11:00; it is at 12:00." yalnız 11:00 okunuyordu → mülkün 11:00'iyle "uyumlu" → çelişki görünmüyor,
// yapay zekâ "çıkış 11:00" diyebiliyordu. Artık 12:00 okunur → çelişki görünür (ev sahibinde "Uyuşmayan saatler", misafire kesin
// saat söylenmez). Sınır anlatımları ("not before 15:00", "no later than 11:00", "15:00'ten önce değil") ETKİLENMEZ.
// ---------------------------------------------------------------------------

const checkout = (text: string, title = "Ev bilgileri", category: string | null = "general") =>
  [...new Set(fieldTimeHits(title, text, category).filter((h) => h.field === "checkout").map((h) => h.time))].sort();

beforeEach(() => __resetFieldTimeHitsCache());

describe("K3 — olumsuzlanan saat okunmaz, düzeltme saati okunur", () => {
  it.each([
    ["Check-out is not at 11:00; it is at 12:00.", ["12:00"]],
    ["Check-out is not at 11:00, it is at 12:00.", ["12:00"]],
    ["Checkout is at 12:00, not 11:00.", ["12:00"]],
    ["Check-out is not 11:00 but 12:00.", ["12:00"]],
    ["Checkout isn't 11am anymore, it's 12pm.", ["12:00"]],
    ["Check-out is at 12 noon (not 11 am as before).", ["12:00"]],
    ["Check-out: 12:00 (not 11:00).", ["12:00"]],
    ["Çıkış saati 11:00 değil, 12:00'dir.", ["12:00"]],
    ["Çıkış saatimiz 11:00 değildir; 12:00'dir.", ["12:00"]],
    ["Çıkış 11:00'de değil, 12:00'de.", ["12:00"]],
  ])("%s → çıkış %j", (text, want) => {
    expect(checkout(text)).toEqual(want);
  });

  it("kalem başlığı alanı adlandırsa da sonuç aynı (başlık ödüncü olumsuzlanan saati geri getirmez)", () => {
    expect(checkout("Check-out is not at 11:00; it is at 12:00.", "Check-out", "checkout")).toEqual(["12:00"]);
  });

  it("taşıma yalnız HEMEN ardındaki alansız cümleye: başka konu taşımaz", () => {
    expect(checkout("Check-out is not at 11:00. Breakfast is served at 09:00.")).toEqual([]);
  });

  it.each([
    ["Check-out is no longer 11:00, it is 12:00 now.", ["12:00"]],
    // Aradaki saatsiz / soru / karşılıklı eşleme cümlesi taşımayı keser.
    ["Check-out is not at 11:00. Thank you. See you at 16:00!", []],
    ["Check-out is not at 11:00. Questions? See you at 16:00.", []],
    ["Check-out is not at 11:00. Check-in and check-out are 15:00 and 12:00. See you at 16:00.", ["12:00"]],
    // Taşıma TEK cümlecik yaşar: düzeltmeden sonraki cümleye sızmaz.
    ["Check-out is not at 11:00; it is at 12:00. See you at 16:00.", ["12:00"]],
    // Aynı cümlecikte düzeltme saati okunduysa alan taşınmaz.
    ["Check-out is not 11:00 but 12:00. See you at 16:00.", ["12:00"]],
    // "not exactly" = yaklaşık: olumsuzlama değil.
    ["Check-out is not exactly 11:00.", ["11:00"]],
  ])("taşıma sınırları: %s → çıkış %j", (text, want) => {
    expect(checkout(text)).toEqual(want);
  });

  it("iki alan birden olumsuzlanırsa taşıma yok (hangi alanın düzeltmesi olduğu belirsiz)", () => {
    const hits = fieldTimeHits("Ev bilgileri", "Check-in is not 14:00 and check-out is not 11:00. See you at 16:00.", "general");
    expect(hits.filter((h) => h.time === "16:00")).toEqual([]);
  });

  it.each([
    ["Check-in is not before 15:00.", "checkin", "15:00"],
    ["Check-out no later than 11:00.", "checkout", "11:00"],
    ["Giriş 15:00'ten önce değil.", "checkin", "15:00"],
    ["Check-in 15:00, not earlier.", "checkin", "15:00"],
  ])("sınır anlatımı etkilenmez: %s", (text, field, time) => {
    const hits = fieldTimeHits("Ev bilgileri", text, "general");
    expect(hits.some((h) => h.field === field && h.time === time)).toBe(true);
  });
});

describe("K3 — çelişki görünür (ev sahibi raporu + istem aynı kural)", () => {
  it("🚨 mülk 11:00, bilgi tabanı 'not at 11:00; it is at 12:00' → çelişki 12:00", () => {
    const hits = fieldTimeHits("Ev bilgileri", "Check-out is not at 11:00; it is at 12:00.", "general");
    expect(kbPropertyMismatch(hits, "checkout", "11:00")).toEqual(["12:00"]);
    const property = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } as PropertyContext;
    const kb = [{ category: "general", title: "Ev bilgileri", content: "Check-out is not at 11:00; it is at 12:00." }] as KbContext[];
    expect(findTimeConflicts(property, kb)).toEqual([{ field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] }]);
  });

  it("KONTROL — düz 'Check-out is at 11:00' mülkle uyumlu (çelişki yok)", () => {
    const hits = fieldTimeHits("Ev bilgileri", "Check-out is at 11:00.", "general");
    expect(kbPropertyMismatch(hits, "checkout", "11:00")).toEqual([]);
  });
});

describe("K3 ikinci tur (Codex 10-01) — olumsuzlanan alan yalnız GERÇEK düzeltme cümleciğine taşınır", () => {
  it.each([
    // Codex örnekleri: başka olayın saati çıkışa taşınmaz (mülk 12:00 iken sahte 13:00 çelişkisi doğuyordu).
    ["Çıkış 11:00 değil. 13:00 saatinde toplantı var.", []],
    ["Check-out is not at 11:00. At 13:00 the ceremony starts.", []],
    ["Çıkış 11:00 değil. Saat 13:00'te kahvaltı salonu kapanır.", []],
    ["Check-out is not at 11:00. The shuttle leaves at 13:00.", []],
  ])("başka olay: %s → çıkış %j", (text, want) => {
    expect(checkout(text)).toEqual(want);
  });

  it.each([
    // İkiz düzeltmeler (Codex: "12:00 olacaktır" ile "13:00 toplantı var" ikiz test).
    ["Çıkış 11:00 değil. 12:00 olacaktır.", ["12:00"]],
    ["Çıkış 11:00 değil. Doğrusu 12:00.", ["12:00"]],
    ["Çıkış 11:00 değil. Saat 12:00'dir.", ["12:00"]],
    ["Çıkış 11:00 değil, artık 12:00.", ["12:00"]],
    ["Check-out is not at 11:00. It will be 12:00.", ["12:00"]],
    ["Check-out is not at 11:00. The correct time is 12:00.", ["12:00"]],
    ["Check-out is not at 11:00. Rather 12:00.", ["12:00"]],
  ])("düzeltme: %s → çıkış %j", (text, want) => {
    expect(checkout(text)).toEqual(want);
  });

  it("🚨 mülk 12:00: 'Çıkış 11:00 değil. 13:00 saatinde toplantı var.' sahte çelişki üretmez; ikizi '12:00 olacaktır' uyumludur", () => {
    const property = { name: "Lale", checkInTime: "15:00", checkOutTime: "12:00" } as PropertyContext;
    const kb = (content: string) => [{ category: "general", title: "Ev bilgileri", content }] as KbContext[];
    expect(findTimeConflicts(property, kb("Çıkış 11:00 değil. 13:00 saatinde toplantı var."))).toEqual([]);
    expect(findTimeConflicts(property, kb("Check-out is not at 11:00. At 13:00 the ceremony starts."))).toEqual([]);
    expect(findTimeConflicts(property, kb("Çıkış 11:00 değil. 12:00 olacaktır."))).toEqual([]);
    // KONTROL: düzeltme mülkten farklıysa çelişki yine görünür.
    expect(findTimeConflicts(property, kb("Çıkış 11:00 değil. 13:00 olacaktır."))).toEqual([
      { field: "checkOutTime", propertyValue: "12:00", kbValues: ["13:00"] },
    ]);
  });
});
