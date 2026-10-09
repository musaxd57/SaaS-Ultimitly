import { describe, it, expect } from "vitest";
import { evaluateAvailability, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";
import { AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION } from "@/lib/ai/tools/availability-tool";
import type { VerifiedAvailability } from "@/lib/ai/verified-availability";

// ---------------------------------------------------------------------------
// Doğrulanmış müsaitlik — KAPI muafiyetinin şartları (ikinci savunma hattı). Yükleyicinin ön elemesi (yalnız saf müsaitlik
// sorusunda sonuç üretir) burada YOK SAYILIR: kapı, sonuç bir şekilde gelse bile uzatma / izin / beyansız / fiyatlı cevabı
// muaf tutmamalı (mutasyon V1 / V2 bu dosyadan önce yaşıyordu).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const scope = { organizationId: "org-A", propertyId: "p1" };
const dateCtx = { now: NOW, timeZone: "Europe/Istanbul" };
const va: VerifiedAvailability = {
  query: { from: "2026-10-14", to: "2026-10-16" },
  result: {
    tool: AVAILABILITY_TOOL,
    toolVersion: AVAILABILITY_TOOL_VERSION,
    status: "ok",
    asOf: NOW.toISOString(),
    scope,
    value: { verdict: "available", certainty: "verified", from: "2026-10-14", to: "2026-10-16", nights: 2, freeNights: 2, blockedNights: 0, unknownNights: 0, conflictCount: 0, engineVersion: 1 },
    reasons: [],
  },
};
const ASK = "Merhaba, 14 Ekim ile 16 Ekim arası müsait mi?";
const REPLY = "14 Ekim – 16 Ekim tarihleri için daire müsait.";
const opts = (over: Partial<AvailabilityPolicyOptions> = {}): AvailabilityPolicyOptions => ({
  declared: { asked: "availability", stance: "states_calendar" },
  replyIntent: "general",
  verifiedAvailability: { va, scope, dateCtx },
  ...over,
});

describe("kapı muafiyeti — şartlar", () => {
  it("KONTROL: saf müsaitlik + beyan states_calendar + birebir uyum → muaf", () => {
    const e = evaluateAvailability(REPLY, [ASK], opts());
    expect(e.reason).toBeNull();
    expect(e.signals.lx).toContain("v");
  });

  it("KONTROL: doğrulanmış sonuç YOKSA aynı cevap iddia sayılır (muafiyetin kaynağı sonuç)", () => {
    expect(evaluateAvailability(REPLY, [ASK], opts({ verifiedAvailability: null })).reason).toBe("availability_claim");
  });

  it("🚨 misafir aynı turda uzatma da istediyse muaf DEĞİL (ev sahibinin kararı)", () => {
    const texts = [ASK, "Bir de mevcut konaklamamızı bir gece daha uzatabilir miyiz?"];
    expect(evaluateAvailability(REPLY, texts, opts()).reason).not.toBeNull();
  });

  it("🚨 model beyanı izin (grants) ise muaf DEĞİL", () => {
    expect(evaluateAvailability(REPLY, [ASK], opts({ declared: { asked: "availability", stance: "grants" } })).reason).toBe("availability_claim");
  });

  it("🚨 model beyanı başka tür (uzatma) adlandırıyorsa muaf DEĞİL", () => {
    expect(evaluateAvailability(REPLY, [ASK], opts({ declared: { asked: "extend", stance: "states_calendar" } })).reason).not.toBeNull();
  });

  it("🚨 beyan HİÇ yoksa muaf DEĞİL (duruş bilinmiyor)", () => {
    expect(evaluateAvailability(REPLY, [ASK], opts({ declared: null })).reason).not.toBeNull();
  });

  it("🚨 bekçi izin görüyorsa muaf DEĞİL", () => {
    const guard = {
      status: "ok" as const,
      verdict: {
        guestRequestsChange: false,
        kind: "availability" as const,
        replyStatesCalendar: true,
        replyGrantsChange: true,
        replyDefersToHost: false,
        replyRefuses: false,
        replyPriceTerms: false,
        replyAmounts: [],
        requestedCheckinTime: null,
        requestedCheckoutTime: null,
      },
    };
    expect(evaluateAvailability(REPLY, [ASK], opts({ guard: guard as never })).reason).not.toBeNull();
  });

  it("🚨 cevap fiyat söylüyorsa muaf DEĞİL", () => {
    expect(evaluateAvailability("14 Ekim – 16 Ekim için daire müsait, gecelik 2.000 TL.", [ASK], opts()).reason).not.toBeNull();
  });
});
