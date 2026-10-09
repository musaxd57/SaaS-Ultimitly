import { describe, it, expect, afterEach, vi } from "vitest";
import {
  availabilityQueryOf,
  verifiedAvailabilityEnabled,
  verifiedAvailabilityLang,
  verifiedAvailabilityText,
  verifiedAvailabilityUsable,
  VERIFIED_AVAILABILITY_MAX_AGE_MS,
  type VerifiedAvailability,
} from "@/lib/ai/verified-availability";
import { AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION } from "@/lib/ai/tools/availability-tool";
import { AVAILABILITY_ENGINE_VERSION } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Doğrulanmış müsaitlik (kurucu onayı 10-09) — saf parçalar. Misafire giden metin KODDAN kurulur (Haiku güvenlik incelemesi 10-09:
// model metnini ayrıştırmak olumsuz / izin / aralık dışı tarih açıkları veriyordu). Sabit an 2026-10-09 Cuma 12:00 İstanbul.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const ctx = { now: NOW, timeZone: "Europe/Istanbul" };
const scope = { organizationId: "org-A", propertyId: "p1" };

function va(verdict: "available" | "unavailable", over: Partial<VerifiedAvailability["result"]["value"] & object> = {}, from = "2026-10-14", to = "2026-10-16", asOf = NOW): VerifiedAvailability {
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  return {
    query: { from, to },
    result: {
      tool: AVAILABILITY_TOOL,
      toolVersion: AVAILABILITY_TOOL_VERSION,
      status: "ok",
      asOf: asOf.toISOString(),
      scope,
      value: {
        verdict,
        certainty: "verified",
        from,
        to,
        nights,
        freeNights: verdict === "available" ? nights : 0,
        blockedNights: verdict === "available" ? 0 : nights,
        unknownNights: 0,
        conflictCount: 0,
        engineVersion: AVAILABILITY_ENGINE_VERSION,
        ...over,
      },
      reasons: [],
    },
  };
}

describe("availabilityQueryOf — misafirin sorduğu aralık", () => {
  it.each([
    ["14-16 Ekim müsait mi?", { from: "2026-10-14", to: "2026-10-16", explicitRange: true }],
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

describe("verifiedAvailabilityUsable", () => {
  it("ok + kapsam + birebir aralık + taze → kullanılabilir", () => {
    expect(verifiedAvailabilityUsable(va("available"), scope, NOW)).toBe(true);
    expect(verifiedAvailabilityUsable(va("unavailable"), scope, NOW)).toBe(true);
  });
  it.each(["stale", "uncertain", "error", "not_found"] as const)("🚨 araç %s → kullanılamaz", (status) => {
    const x = va("available");
    x.result.status = status;
    expect(verifiedAvailabilityUsable(x, scope, NOW)).toBe(false);
  });
  it("🚨 başka mülkün sonucu → kullanılamaz", () => {
    expect(verifiedAvailabilityUsable(va("available"), { organizationId: "org-A", propertyId: "p2" }, NOW)).toBe(false);
  });
  it("🚨 sonucun aralığı sorulan aralık değil → kullanılamaz", () => {
    const x = va("available");
    x.query = { from: "2026-10-14", to: "2026-10-17" };
    expect(verifiedAvailabilityUsable(x, scope, NOW)).toBe(false);
  });
  it("🚨 2 dakikadan eski sonuç → kullanılamaz (takvim değişmiş olabilir)", () => {
    const old = new Date(NOW.getTime() - VERIFIED_AVAILABILITY_MAX_AGE_MS - 1);
    expect(verifiedAvailabilityUsable(va("available", {}, "2026-10-14", "2026-10-16", old), scope, NOW)).toBe(false);
  });
  it("🚨 KISMEN dolu aralık 'dolu' denmez (hangi gece dolu ayrı ürün) → kullanılamaz", () => {
    expect(verifiedAvailabilityUsable(va("unavailable", { blockedNights: 1, freeNights: 1 }), scope, NOW)).toBe(false);
  });
});

describe("verifiedAvailabilityText — koddan kurulan tek cümle", () => {
  it("TR müsait / dolu, tek gece / aralık", () => {
    expect(verifiedAvailabilityText(va("available"), "tr", "2026-10-09")).toBe("14 Ekim giriş, 16 Ekim çıkış için daire müsait.");
    expect(verifiedAvailabilityText(va("unavailable"), "tr", "2026-10-09")).toBe("Maalesef 14 Ekim giriş, 16 Ekim çıkış için daire müsait değil.");
    expect(verifiedAvailabilityText(va("available", {}, "2026-10-15", "2026-10-16"), "tr", "2026-10-09")).toBe("15 Ekim gecesi için daire müsait.");
  });
  it("iki tarihle sorulan TEK gece de giriş / çıkış diye açık yazılır (yorum görünsün)", () => {
    const x = va("available", {}, "2026-10-15", "2026-10-16");
    x.query.explicitRange = true;
    expect(verifiedAvailabilityText(x, "tr", "2026-10-09")).toBe("15 Ekim giriş, 16 Ekim çıkış için daire müsait.");
  });
  it("EN", () => {
    expect(verifiedAvailabilityText(va("available"), "en", "2026-10-09")).toBe(
      "The apartment is available for check-in on 14 October and check-out on 16 October.",
    );
    expect(verifiedAvailabilityText(va("unavailable", {}, "2026-10-15", "2026-10-16"), "en", "2026-10-09")).toBe(
      "Unfortunately, the apartment is not available for the night of 15 October.",
    );
  });
  it("başka yıl ise yıl yazılır", () => {
    expect(verifiedAvailabilityText(va("available", {}, "2027-01-03", "2027-01-05"), "tr", "2026-10-09")).toBe(
      "3 Ocak 2027 giriş, 5 Ocak 2027 çıkış için daire müsait.",
    );
  });
  it("🚨 metin izin / eylem / fiyat taşımaz", () => {
    for (const v of ["available", "unavailable"] as const) {
      for (const l of ["tr", "en"] as const) {
        const t = verifiedAvailabilityText(va(v), l, "2026-10-09") ?? "";
        expect(t).not.toMatch(/kalabilir|ayır|rezerv|book|reserv|stay|TL|€|\$|ücret|price/i);
      }
    }
  });
  it("dil: yalnız TR / EN", () => {
    expect(verifiedAvailabilityLang("tr")).toBe("tr");
    expect(verifiedAvailabilityLang("en-GB")).toBe("en");
    expect(verifiedAvailabilityLang("de")).toBeNull();
    expect(verifiedAvailabilityLang(null)).toBeNull();
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
