import { describe, it, expect, afterEach, vi } from "vitest";
import {
  availabilityQueryOf,
  replyAvailabilityPolarity,
  replyHasActionClaim,
  replyMatchesVerifiedAvailability,
  verifiedAvailabilityEnabled,
  verifiedAvailabilityPromptBlock,
  type VerifiedAvailability,
} from "@/lib/ai/verified-availability";
import { AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION } from "@/lib/ai/tools/availability-tool";

// ---------------------------------------------------------------------------
// Doğrulanmış müsaitlik cevabı (kurucu onayı 10-09) — saf parçalar. Sabit an 2026-10-09 Cuma 12:00 İstanbul.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const ctx = { now: NOW, timeZone: "Europe/Istanbul" };
const scope = { organizationId: "org-A", propertyId: "p1" };

function va(verdict: "available" | "unavailable", over: Partial<VerifiedAvailability["result"]> = {}, from = "2026-10-14", to = "2026-10-16"): VerifiedAvailability {
  return {
    query: { from, to },
    result: {
      tool: AVAILABILITY_TOOL,
      toolVersion: AVAILABILITY_TOOL_VERSION,
      status: "ok",
      asOf: NOW.toISOString(),
      scope,
      value: {
        verdict,
        certainty: "verified",
        from,
        to,
        nights: 2,
        freeNights: verdict === "available" ? 2 : 0,
        blockedNights: verdict === "available" ? 0 : 2,
        unknownNights: 0,
        conflictCount: 0,
        engineVersion: 1,
      },
      reasons: [],
      ...over,
    },
  };
}

describe("availabilityQueryOf — misafirin sorduğu aralık", () => {
  it.each([
    ["14-16 Ekim müsait mi?", { from: "2026-10-14", to: "2026-10-16" }],
    ["15 Ekim gecesi boş mu?", { from: "2026-10-15", to: "2026-10-16" }],
    ["Is Oct 20 available?", { from: "2026-10-20", to: "2026-10-21" }],
  ])("%s → %j", (text, q) => {
    expect(availabilityQueryOf(text, ctx)).toEqual(q);
  });
  it.each(["Ayın 3'ü ile 4'ü müsait mi?", "14.10 müsait mi?", "Müsait misiniz?", "14, 15 ve 16 Ekim", "14.10.2025 müsait miydi?"])(
    "🚨 %s → null (belirsiz / tarih yok / üç gün / geçmiş: tahmin yok)",
    (text) => {
      expect(availabilityQueryOf(text, ctx)).toBeNull();
    },
  );
});

describe("yön ve eylem sözü", () => {
  it.each([
    ["14-16 Ekim için daire müsait.", "available"],
    ["The apartment is available on those dates.", "available"],
    ["Maalesef 14-16 Ekim'de daire dolu.", "unavailable"],
    ["Bu tarihlerde müsait değil.", "unavailable"],
    ["Unfortunately we're fully booked then.", "unavailable"],
    ["Wi-Fi şifresi kartta yazıyor.", "none"],
    ["14 Ekim müsait ama 15 Ekim dolu.", "mixed"],
  ])("%s → %s", (reply, polarity) => {
    expect(replyAvailabilityPolarity(reply)).toBe(polarity);
  });
  it.each(["Sizin için 14-16 Ekim'i ayırdım.", "Kalabilirsiniz, müsait.", "I have booked it for you.", "Yes, you can stay those nights."])(
    "🚨 eylem / izin sözü: %s",
    (reply) => {
      expect(replyHasActionClaim(reply)).toBe(true);
    },
  );
  it("KONTROL: düz bilgi cümlesi eylem sözü değil", () => {
    expect(replyHasActionClaim("14-16 Ekim için daire müsait görünüyor.")).toBe(false);
  });
});

describe("replyMatchesVerifiedAvailability", () => {
  it("doğru yön + aralık içi tarih → uyumlu", () => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim için daire müsait.", va("available"), scope, ctx)).toBe(true);
    expect(replyMatchesVerifiedAvailability("Maalesef bu tarihlerde daire dolu.", va("unavailable"), scope, ctx)).toBe(true);
  });
  it("🚨 yön araçla ÇELİŞİRSE uyumsuz", () => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim için daire müsait.", va("unavailable"), scope, ctx)).toBe(false);
  });
  it("🚨 aralık DIŞINDA tarih söylerse uyumsuz", () => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim müsait; 20 Ekim de müsait.", va("available"), scope, ctx)).toBe(false);
  });
  it("🚨 eylem sözü varsa uyumsuz", () => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim müsait, sizin için ayırdım.", va("available"), scope, ctx)).toBe(false);
  });
  it("🚨 yönsüz / karışık cevap uyumsuz", () => {
    expect(replyMatchesVerifiedAvailability("Ev sahibinize iletiyorum.", va("available"), scope, ctx)).toBe(false);
    expect(replyMatchesVerifiedAvailability("14 Ekim müsait ama 15 Ekim dolu.", va("available"), scope, ctx)).toBe(false);
  });
  it.each(["stale", "uncertain", "error", "not_found"] as const)("🚨 araç %s → uyumsuz", (status) => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim için daire müsait.", va("available", { status }), scope, ctx)).toBe(false);
  });
  it("🚨 başka mülkün sonucu → uyumsuz", () => {
    expect(replyMatchesVerifiedAvailability("14-16 Ekim için daire müsait.", va("available"), { organizationId: "org-A", propertyId: "p2" }, ctx)).toBe(false);
  });
  it("🚨 sonucun aralığı sorulan aralık değilse uyumsuz", () => {
    const x = va("available");
    x.query = { from: "2026-10-14", to: "2026-10-17" };
    expect(replyMatchesVerifiedAvailability("Daire müsait.", x, scope, ctx)).toBe(false);
  });
});

describe("istem bloğu", () => {
  it("yalnız ok sonuçta; tarihler ve yön koddan", () => {
    const b = verifiedAvailabilityPromptBlock(va("available"));
    expect(b).toContain("2026-10-14 giriş – 2026-10-16 çıkış (2 gece) → MÜSAİT");
    expect(verifiedAvailabilityPromptBlock(va("available", { status: "stale" }))).toBe("");
    expect(verifiedAvailabilityPromptBlock(null)).toBe("");
  });
});

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' açar (varsayılan KAPALI)", () => {
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "");
    expect(verifiedAvailabilityEnabled()).toBe(false);
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "true");
    expect(verifiedAvailabilityEnabled()).toBe(false);
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "1");
    expect(verifiedAvailabilityEnabled()).toBe(true);
  });
});
