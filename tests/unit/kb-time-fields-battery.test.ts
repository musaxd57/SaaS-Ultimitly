import { describe, it, expect } from "vitest";
import { fieldTimeHits } from "@/lib/ai/retrieval/time-fields";
import { findTimeConflicts } from "@/lib/ai/prompts";
import { TIME_FIELD_BATTERY } from "../helpers/time-field-battery";

// ---------------------------------------------------------------------------
// SAAT ALANI ATFI BATARYASI (09-27, kurucu: "o saat kuralını en iyi şekilde yap, didik didik"). Ölçülen canlı kusur:
// 60 kalemlik gerçekçi bilgi tabanında soruların %30'unda (geniş blokla %58) bloğa giren kalemler mülkün giriş/çıkış
// saatiyle YANLIŞ çelişki üretiyordu ("21.00'den sonra varacaksanız", "12.00–14.30 valiz", "araç girişi 19–24",
// "müzisyenler çıkıyor", "şofben 3 dakikaya çıkabilir") → istem mülk saatini gizliyor, giriş/çıkış cevabı onaya düşüyordu;
// aynı kural "iskele sabah sakin", "kuaför salonu", "şezlong" cümlelerini sessizlik / spor salonu / havuz saati sayıp ev
// sahibine sahte "uyuşmayan saat" gösteriyordu. Canlı kural (`7382338`) bu bataryada gerçek saatlerin 99/168'ini, tuzakların
// 40/146'sını doğru okuyordu; dördüncü turun kuralı (`8603f97`) 166/168 · 135/146 (mutasyon incelemesinin bulduğu on üç cümle).
// İki yön birlikte pinli: GERÇEK saat okunmaya devam eder (kaçarsa gerçek çelişki görünmez), tuzak okunmaz.
// ---------------------------------------------------------------------------

const read = (c: (typeof TIME_FIELD_BATTERY)[number]) =>
  [...new Set(fieldTimeHits(c.title, c.text, c.category).map((h) => `${h.field}:${h.time}`))].sort();

describe("gerçek saat — okunmaya devam eder", () => {
  for (const c of TIME_FIELD_BATTERY.filter((x) => x.kind === "true")) {
    it(`[${c.category}] ${c.text}`, () => {
      expect(read(c)).toEqual([...c.expect].sort());
    });
  }
});

describe("🚨 tuzak — gündelik saat anlatımı hiçbir alana okunmaz", () => {
  for (const c of TIME_FIELD_BATTERY.filter((x) => x.kind === "trap")) {
    it(`[${c.category}] ${c.text}`, () => {
      expect(read(c)).toEqual([...c.expect].sort());
    });
  }
});

describe("mülk saatiyle çelişki (istem + gönderim kapısı) — uçtan uca", () => {
  const PROP = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" };

  it("🚨 tuzak cümlelerin hiçbiri mülkün giriş/çıkış saatiyle çelişki ÜRETMEZ", () => {
    const kb = TIME_FIELD_BATTERY.filter((x) => x.kind === "trap").map((c) => ({ category: c.category, title: c.title, content: c.text }));
    expect(findTimeConflicts(PROP, kb)).toEqual([]);
  });

  it("KONTROL — gerçek çelişki yakalanır (bilgi tabanı 12:00, mülk 11:00; bilgi tabanı 14:00, mülk 15:00)", () => {
    expect(
      findTimeConflicts(PROP, [
        { category: "checkout", title: "Çıkış", content: "Standart çıkış saati en geç 12:00'dır." },
        { category: "rules", title: "Kurallar", content: "Daireden 12:00'de ayrılmanız gerekmektedir." },
        { category: "checkin", title: "Varış bilgileri", content: "14:00'ten sonra gelebilirsiniz." },
      ]),
    ).toEqual([
      { field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] },
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });
});
