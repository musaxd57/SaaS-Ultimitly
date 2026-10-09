import { describe, it, expect } from "vitest";
import { evaluateAvailability, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";

// ---------------------------------------------------------------------------
// Doğrulanmış müsaitlik — KAPI muafiyetinin şartları. Muafiyet YALNIZ koddan kurulan metne BİREBİR eşit cevaba; Haiku güvenlik
// incelemesinin (10-09) model metni vakaları burada: hiçbiri muaf DEĞİL.
// ---------------------------------------------------------------------------

const ASK = "Merhaba, 14 Ekim ile 16 Ekim arası müsait mi?";
const CODE = "14 Ekim giriş, 16 Ekim çıkış için daire müsait.";
const understanding = { requested: true, kind: "availability", checkinTime: null, checkoutTime: null } as never;
const opts = (over: Partial<AvailabilityPolicyOptions> = {}): AvailabilityPolicyOptions => ({
  declared: { asked: "availability", stance: "states_calendar" },
  replyIntent: "availability",
  understanding,
  verifiedAvailability: { text: CODE },
  ...over,
});

describe("kapı muafiyeti — yalnız birebir kod metni", () => {
  it("KONTROL: kod metni + saf müsaitlik + anlama koştu → muaf (kanıtta 'v')", () => {
    const e = evaluateAvailability(CODE, [ASK], opts());
    expect(e.reason).toBeNull();
    expect(e.signals.lx).toContain("v");
  });

  it("KONTROL: muafiyet yoksa aynı metin iddia sayılır", () => {
    expect(evaluateAvailability(CODE, [ASK], opts({ verifiedAvailability: null })).reason).toBe("availability_claim");
  });

  it.each([
    ["izin cümlesi", "Evet, 14 Ekim gecesi boş. Bir gece daha konaklayabilirsiniz."],
    ["olumsuz yön karışıklığı", "14 Ekim gecesi dolu değil."],
    ["aralık dışı tarih", "14 Ekim giriş, 16 Ekim çıkış için daire müsait. Hafta sonları da boş."],
    ["tarihsiz iddia", "Evet, müsait."],
    ["İngilizce eylem sözü", "I've booked it for you."],
  ])("🚨 model metni (%s) muaf DEĞİL", (_n, reply) => {
    expect(evaluateAvailability(reply, [ASK], opts()).reason).not.toBeNull();
  });

  it("🚨 misafir aynı turda uzatma da istediyse muaf DEĞİL", () => {
    expect(evaluateAvailability(CODE, [ASK, "Bir de mevcut konaklamamızı bir gece daha uzatabilir miyiz?"], opts()).reason).not.toBeNull();
  });

  it("🚨 anlama katmanı KAPALI / DÜŞMÜŞ ise muaf DEĞİL (çok dilli uzatma isteği kelime ağından kaçabilir)", () => {
    expect(evaluateAvailability(CODE, [ASK], opts({ understanding: null })).reason).not.toBeNull();
    expect(evaluateAvailability(CODE, [ASK], opts({ understanding: null, understandingFailed: true })).reason).not.toBeNull();
  });

  it("🚨 anlama katmanı KOŞTU ama konaklama türü görmedi (havuz / otopark sorusu) → muaf DEĞİL", () => {
    const none = { requested: false, kind: "none", checkinTime: null, checkoutTime: null } as never;
    expect(evaluateAvailability(CODE, ["Havuz 15 Ekim'de boş mu?"], opts({ understanding: none })).reason).not.toBeNull();
  });

  it("🚨 anlama katmanı başka tür (uzatma) görüyorsa muaf DEĞİL", () => {
    const extend = { requested: true, kind: "extend", checkinTime: null, checkoutTime: null } as never;
    expect(evaluateAvailability(CODE, [ASK], opts({ understanding: extend })).reason).not.toBeNull();
  });

  it("🚨 bekçi düştüyse muaf DEĞİL", () => {
    expect(evaluateAvailability(CODE, [ASK], opts({ guard: { status: "failed" } as never })).reason).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Doğrulanmış UZATMA muafiyeti (kurucu kararı 10-09 "Müsait + talep yolu") — yalnız birebir kod metni, yalnız saf uzatma.
// ---------------------------------------------------------------------------
const EXT_ASK = "Merhaba, bir gece daha kalabilir miyiz?";
const EXT_CODE =
  "16 Ekim gecesi daire müsait. Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.";
const extUnderstanding = { requested: true, kind: "extend", checkinTime: null, checkoutTime: null } as never;
const extOpts = (over: Partial<AvailabilityPolicyOptions> = {}): AvailabilityPolicyOptions => ({
  declared: { asked: "extend", stance: "states_calendar" },
  replyIntent: "extend_stay",
  understanding: extUnderstanding,
  verifiedExtension: { text: EXT_CODE },
  ...over,
});

describe("kapı muafiyeti — doğrulanmış uzatma", () => {
  it("KONTROL: kod metni + saf uzatma + anlama katmanı 'extend' → muaf (kanıtta 'x')", () => {
    const e = evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts());
    expect(e.reason).toBeNull();
    expect(e.signals.lx).toContain("x");
  });

  it("KONTROL: muafiyet yoksa aynı metin tutulur", () => {
    expect(evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts({ verifiedExtension: null })).reason).not.toBeNull();
  });

  it.each([
    ["izin cümlesi", "Evet, bir gece daha kalabilirsiniz."],
    ["model metni + kod metni", `${EXT_CODE} Size özel indirim de yaparız.`],
  ])("🚨 model metni (%s) muaf DEĞİL", (_n, reply) => {
    expect(evaluateAvailability(reply, [EXT_ASK], extOpts()).reason).not.toBeNull();
  });

  it("🚨 anlama katmanı 'availability' görüyorsa uzatma muafiyeti YOK (tür birebir)", () => {
    const av = { requested: true, kind: "availability", checkinTime: null, checkoutTime: null } as never;
    expect(evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts({ understanding: av })).reason).not.toBeNull();
  });

  it("🚨 aynı turda geç çıkış da istendiyse muaf DEĞİL", () => {
    expect(evaluateAvailability(EXT_CODE, [EXT_ASK, "Olmazsa geç çıkış alabilir miyiz?"], extOpts()).reason).not.toBeNull();
  });

  it("🚨 anlama katmanı kapalı / bekçi düştü → muaf DEĞİL", () => {
    expect(evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts({ understanding: null })).reason).not.toBeNull();
    expect(evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts({ guard: { status: "failed" } as never })).reason).not.toBeNull();
  });

  it("🚨 müsaitlik muafiyeti uzatma metnini KAPSAMAZ (yanlış bağlam)", () => {
    expect(
      evaluateAvailability(EXT_CODE, [EXT_ASK], extOpts({ verifiedExtension: null, verifiedAvailability: { text: EXT_CODE } })).reason,
    ).not.toBeNull();
  });
});
