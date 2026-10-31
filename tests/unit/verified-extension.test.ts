import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isOwnExtensionRequest,
  extensionNightsRequested,
  extensionQueryOf,
  verifiedExtensionEnabled,
  verifiedExtensionText,
  MAX_EXTENSION_NIGHTS,
} from "@/lib/ai/verified-extension";
import { AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION } from "@/lib/ai/tools/availability-tool";
import { AVAILABILITY_ENGINE_VERSION } from "@/modules/availability/core";
import type { VerifiedAvailability } from "@/lib/ai/verified-availability";

// ---------------------------------------------------------------------------
// Doğrulanmış uzatma (kurucu kararı 10-09: "Müsait + talep yolu") — saf parçalar. Sabit an 2026-10-09 Cuma 12:00 İstanbul;
// rezervasyon 14–16 Ekim (çıkış 16).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T09:00:00Z");
const ctx = { now: NOW, timeZone: "Europe/Istanbul", reservation: { arrival: "2026-10-14", departure: "2026-10-16" } };

describe("extensionNightsRequested", () => {
  it.each([
    ["Bir gece daha kalabilir miyiz?", 1],
    ["1 gece daha kalsak olur mu", 1],
    ["İki gece daha uzatabilir miyiz?", 2],
    ["ÜÇ GECE DAHA", 3],
    ["bir gün daha kalabilir miyiz", 1],
    ["Can we stay one more night?", 1],
    ["Could we book 2 extra nights?", 2],
    ["Is another night possible?", 1],
    ["Can we have an extra night?", 1],
  ])("%s → %s", (text, n) => {
    expect(extensionNightsRequested(text)).toBe(n);
  });
  it("🚨 'on bir gece daha' (11) → conflict (1 gece okunmaz); tireli yazım da (Haiku ikinci tur)", () => {
    expect(extensionNightsRequested("On bir gece daha kalabilir miyiz?")).toBe("conflict");
    expect(extensionNightsRequested("Could we stay twenty one more nights?")).toBe("conflict");
    expect(extensionNightsRequested("Can we stay twenty-one more nights?")).toBe("conflict");
    expect(extensionNightsRequested("yirmi-bir gece daha kalabilir miyiz")).toBe("conflict");
  });
  it("ifade yok → null", () => {
    expect(extensionNightsRequested("Wi-Fi şifresi nedir?")).toBeNull();
    expect(extensionNightsRequested("")).toBeNull();
  });
  it.each(["Bir gece daha, hatta iki gece daha kalabilir miyiz?", "10 gece daha kalabilir miyiz?", "0 gece daha"])(
    "🚨 tutarsız / aralık dışı → conflict (%s)",
    (text) => {
      expect(extensionNightsRequested(text)).toBe("conflict");
    },
  );
  it("sözcük İÇİ eşleşme yok ('birgece daha' / 'üçgece')", () => {
    expect(extensionNightsRequested("geceleri daha sessiz mi")).toBeNull();
  });
  it("uzun girdide doğrusal (50.000 boşluk / tekrar)", () => {
    const t0 = Date.now();
    extensionNightsRequested(`bir${" ".repeat(50_000)}gece`);
    extensionNightsRequested("bir gece ".repeat(10_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("extensionQueryOf — uzatma aralığı [çıkış, çıkış + N)", () => {
  it.each([
    ["Bir gece daha kalabilir miyiz?", { from: "2026-10-16", to: "2026-10-17" }],
    ["İki gece daha kalabilir miyiz?", { from: "2026-10-16", to: "2026-10-18" }],
    ["16 Ekim gecesi de kalabilir miyiz?", { from: "2026-10-16", to: "2026-10-17" }],
    ["16 Ekim'de bir gece daha kalabilir miyiz?", { from: "2026-10-16", to: "2026-10-17" }],
  ])("%s → %j", (text, q) => {
    expect(extensionQueryOf(text, ctx)).toEqual(q);
  });
  it.each([
    "18 Ekim'e kadar kalabilir miyiz?", // çıkış mı gece mi belirsiz
    "20 Ekim'de bir gece daha kalabilir miyiz?", // çıkışa değmiyor
    "16-18 Ekim ama bir gece daha", // tutarsız (2 gece ↔ 1 gece)
    "Biraz daha kalabilir miyiz?", // sayı yok
    "14.10 bir gece daha kalabilir miyiz?", // belirsiz tarih biçimi
    "16-18 Ekim arası da kalabilir miyiz?", // iki tarih: aralık mı liste mi belirsiz (Haiku 10-09)
    "16 ve 17 Ekim gecelerinde kalabilir miyiz?", // gece listesi tek gece okunuyordu (Haiku 10-09)
    "Bir gece daha önce gelebilir miyiz?", // erken geliş
    "Bir gün daha erken çıkabilir miyiz?", // erken çıkış
    "Arkadaşım bir gece daha kalabilir mi?", // üçüncü kişi
    "Bir gece daha kalmayacağız.", // olumsuz bildirim
    "Bir gece daha uzattık, teşekkürler.", // bildirim, istek değil
    "On bir gece daha kalabilir miyiz?", // 11 gece
    "Can we come one more night earlier?", // erken geliş (EN)
    "Can we stay twenty-one more nights?", // tireli 21 (Haiku ikinci tur)
    "16 Ekim'den itibaren bir hafta daha kalabilir miyiz?", // desteklenmeyen süre + çıkış tarihi → 1 gece sanılıyordu
    "Can we stay a week more from 16 October?", // aynı (EN)
  ])("🚨 %s → null (ev sahibine)", (text) => {
    expect(extensionQueryOf(text, ctx)).toBeNull();
  });
  it("🚨 rezervasyon yoksa → null", () => {
    expect(extensionQueryOf("Bir gece daha kalabilir miyiz?", { now: NOW, timeZone: "Europe/Istanbul" })).toBeNull();
  });
  it(`🚨 en çok ${MAX_EXTENSION_NIGHTS} gece`, () => {
    expect(extensionQueryOf("16-25 Ekim arası kalabilir miyiz?", ctx)).toBeNull();
  });
});

function va(verdict: "available" | "unavailable", from = "2026-10-16", to = "2026-10-17"): VerifiedAvailability {
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  return {
    query: { from, to },
    result: {
      tool: AVAILABILITY_TOOL,
      toolVersion: AVAILABILITY_TOOL_VERSION,
      status: "ok",
      asOf: NOW.toISOString(),
      scope: { organizationId: "o", propertyId: "p" },
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
      },
      reasons: [],
    },
  };
}

describe("verifiedExtensionText — kurucunun onayladığı metin", () => {
  it("TR tek gece: müsait + talep yolu / dolu", () => {
    expect(verifiedExtensionText(va("available"), "tr", "2026-10-09")).toBe(
      "16 Ekim gecesi daire müsait. Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.",
    );
    expect(verifiedExtensionText(va("unavailable"), "tr", "2026-10-09")).toBe("Maalesef 16 Ekim gecesi daire müsait değil.");
  });
  it("TR çok gece", () => {
    expect(verifiedExtensionText(va("available", "2026-10-16", "2026-10-18"), "tr", "2026-10-09")).toBe(
      "16 Ekim – 18 Ekim arası 2 gece daire müsait. Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.",
    );
    expect(verifiedExtensionText(va("unavailable", "2026-10-16", "2026-10-18"), "tr", "2026-10-09")).toBe(
      "Maalesef 16 Ekim – 18 Ekim arası daire müsait değil.",
    );
  });
  it("EN", () => {
    expect(verifiedExtensionText(va("available"), "en", "2026-10-09")).toBe(
      "The apartment is available on the night of 16 October. To extend your stay, you can send a reservation change request in the Airbnb app; Airbnb will show the new total.",
    );
    expect(verifiedExtensionText(va("unavailable", "2026-10-16", "2026-10-18"), "en", "2026-10-09")).toBe(
      "Unfortunately, the apartment is not available from 16 October to 18 October.",
    );
  });
  it("🚨 metin söz / fiyat / izin taşımaz ('kalabilirsiniz', tutar, para birimi yok)", () => {
    for (const v of ["available", "unavailable"] as const) {
      for (const l of ["tr", "en"] as const) {
        const t = verifiedExtensionText(va(v), l, "2026-10-09") ?? "";
        expect(t).not.toMatch(/kalabilirsiniz|you can stay|onayl|approv|garanti|guarantee|TL|€|\$|\d+[.,]\d+/i);
      }
    }
  });
});

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' açar (varsayılan KAPALI)", () => {
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "");
    expect(verifiedExtensionEnabled()).toBe(false);
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "true");
    expect(verifiedExtensionEnabled()).toBe(false);
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "1");
    expect(verifiedExtensionEnabled()).toBe(true);
  });
});

describe("isOwnExtensionRequest — misafirin KENDİ uzatma isteği şekli", () => {
  it.each([
    "Bir gece daha kalabilir miyiz?",
    "1 gece daha kalsak olur mu",
    "İki gece daha uzatmak istiyoruz",
    "Can we stay one more night?",
    "We'd like to extend by two more nights",
    "Could I stay another night?",
  ])("✓ %s", (t) => {
    expect(isOwnExtensionRequest(t)).toBe(true);
  });
  it.each([
    "Bir gece daha önce gelebilir miyiz?",
    "Arkadaşım bir gece daha kalabilir mi?",
    "Annem bir gece daha kalabilir mi, biz çıkıyoruz",
    "Bir gece daha kalabilir miyiz, mümkün değilse sorun değil",
    "Bir gece daha uzattık, teşekkürler",
    "Bir gece fazla ücret ne kadar?",
    "Can my friend stay one more night?",
    "We can't stay one more night",
    "Is another night possible?",
    // İstek kalıbına UYAN ama erken / üçüncü kişi taşıyan (mutasyon F2 / F3: kalıba uymayan örnekler bu kontrolleri sınamıyordu):
    "Bir gün erken gelip bir gece daha kalabilir miyiz?",
    "Can we stay one more night earlier?",
    "Arkadaşım için bir gece daha kalabilir miyiz?",
    "Could we stay one more night for my friend?",
    // Haiku ikinci tur: alıntı / geçmiş anlatım / kararsızlık / başka mülk / eş
    "Bir gece daha kalabilir miyiz diye sormuştum",
    "Bir gece daha kalsak mı kalmasak mı bilemedik",
    "We would like to stay one more night at another property",
    "Can we stay one more night? asked my wife",
  ])("✗ %s", (t) => {
    expect(isOwnExtensionRequest(t)).toBe(false);
  });
  it("durumsuz: aynı girdi art arda aynı sonucu verir (g bayrağı yok)", () => {
    for (let i = 0; i < 3; i++) expect(extensionNightsRequested("On bir gece daha")).toBe("conflict");
  });
  it("uzun girdide doğrusal", () => {
    const t0 = Date.now();
    isOwnExtensionRequest(`${"kal ".repeat(10_000)}${" ".repeat(50_000)}miyiz`);
    isOwnExtensionRequest("arkadaş".repeat(5_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
