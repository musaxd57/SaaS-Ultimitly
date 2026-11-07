import { describe, it, expect, afterEach, vi } from "vitest";
import { rangeTouchesStay, verifiedQrEnabled } from "@/lib/ai/verified-qr";

// QR'de müsaitlik yalnız konaklamaya DEĞMEYEN aralıkta (kurucu yokken karar #3). Konaklama 14–16 Ekim (çıkış 16).
const stay = { arrival: "2026-10-14", departure: "2026-10-16" };

describe("rangeTouchesStay", () => {
  it.each([
    [{ from: "2026-10-16", to: "2026-10-18" }, true], // çıkış gecesinden başlıyor = uzatma
    [{ from: "2026-10-15", to: "2026-10-17" }, true], // örtüşüyor
    [{ from: "2026-10-12", to: "2026-10-14" }, true], // giriş gününde bitiyor = erken geliş
    [{ from: "2026-10-17", to: "2026-10-19" }, false], // çıkıştan sonraki günden başlıyor
    [{ from: "2026-10-10", to: "2026-10-13" }, false], // girişten önce bitiyor
  ])("%j → %s", (q, touches) => {
    expect(rangeTouchesStay(q, stay)).toBe(touches);
  });
});

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' (varsayılan KAPALI)", () => {
    vi.stubEnv("AI_VERIFIED_QR_ENABLED", "true");
    expect(verifiedQrEnabled()).toBe(false);
    vi.stubEnv("AI_VERIFIED_QR_ENABLED", "1");
    expect(verifiedQrEnabled()).toBe(true);
  });
});
