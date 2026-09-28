import { describe, it, expect } from "vitest";
import { detectAvailabilityRequest, detectAvailabilityRequestKinds, hasAvailabilityDeferral } from "@/lib/ai/availability-claims";

// ---------------------------------------------------------------------------
// MÜSAİTLİK KELİME AĞI MALİYETİ — düşmanca girdide sınırlı kalır (ReDoS denetimi 09-28, ÖLÇÜLDÜ).
//
// Başı çapasız iki kalıp ailesi uzun tek sözcükte karesel koşuyordu: `\S+\s+(?:kadar|dek)\s+kal…` (her konumdan sözcük
// sonuna kadar tarıyordu; aday çoğaltan önekle 20.000 karakterde 12,5 sn) ve Kiril kök + `\p{L}*\s+…` (kök tek sözcükte
// tekrarlanınca; 20.000 karakterde 2,6 sn). Misafir mesajı her cevaptan sonra bu ağdan geçer (kanal + QR); kanal mesajında
// uzunluk tavanı yok. Düzeltme sonucu DEĞİŞTİRMEZ (18.616 metinlik eski/yeni kıyasında fark 0); anlam aşağıda ayrıca pinli.
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

/** Aday biçim sayısını çoğaltan önek (büyük I, Türkçe harf, birleşik harf, Kiril görsel ikiz, ayıraçlı yazım, kesme). */
const PREFIX = "I \u015f \u00e9 \u043e a.b.c.d x'y ";

const ADVERSARIAL: [string, string][] = [
  ["önek + tek uzun sözcük", PREFIX + "a".repeat(4000)],
  ["önek + tekrarlanan Kiril kökü (ранн)", PREFIX + "\u0440\u0430\u043d\u043d".repeat(1000)],
  ["tekrarlanan Kiril kökü (поздн)", "\u043f\u043e\u0437\u0434\u043d".repeat(800)],
  ["tekrarlanan Kiril kökü (дополнительн)", "\u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d".repeat(330)],
];

describe("müsaitlik kelime ağı — düşmanca girdide sınırlı süre", () => {
  it.each(ADVERSARIAL)("%s (~4.000 karakter) → 200 ms altında", (_ad, girdi) => {
    detectAvailabilityRequestKinds(girdi.slice(0, 40)); // ısınma (JIT) — ölçüme girmez
    const t = ms(() => {
      detectAvailabilityRequestKinds(girdi);
      detectAvailabilityRequest(girdi);
      hasAvailabilityDeferral(girdi);
    });
    expect(t).toBeLessThan(200);
  });
});

describe("anlam aynı — değişen kalıpların gerçek cümleleri", () => {
  it.each([
    ["Можно ранний заезд?", "early"],
    ["Возможно раннее заселение?", "early"],
    ["Можно выехать попозже?", "late"],
    ["Нужна дополнительная ночь", "extend"],
    ["Yarına kadar kalabilir miyiz?", "extend"],
    ["Pazara dek kalmamız mümkün mü?", "extend"],
  ])("%s → %s", (msg, kind) => {
    expect(detectAvailabilityRequestKinds(msg)).toContain(kind);
  });

  it("cevap tarafı: ev sahibine bırakan Rusça cümle erteleme sayılır", () => {
    expect(hasAvailabilityDeferral("Это на усмотрении хозяина.")).toBe(true);
    expect(hasAvailabilityDeferral("Хозяин должен подтвердить.")).toBe(true);
  });
});
