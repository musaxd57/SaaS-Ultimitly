import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/ai/tools/availability-tool-load", () => ({ runAvailabilityTool: vi.fn() }));

import { runAvailabilityTool } from "@/lib/ai/tools/availability-tool-load";
import { loadVerifiedAvailability } from "@/lib/ai/verified-availability-load";
import { loadVerifiedExtension } from "@/lib/ai/verified-extension-load";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK / UZATMA — göreli gün mesajın YAZILDIĞI ana göre (10-10, F14 sınıfı). Akşam 22:10'da yazılıp sabah 09:00'da
// işlenen "Yarın daire müsait mi?" bugünü sorar; işleme anına göre çözülseydi bir gün sonraki geceye bakılırdı. Takvim sorgusunun
// tazeliği yine işleme anıdır. Gece yarısından sonra yazılan "yarın" belirsizdir → sorgu yok (ev sahibine).
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-10T06:00:00Z"); // 09:00 İstanbul, 10 Ekim (işleme anı)
const LAST_EVENING = new Date("2026-10-09T19:10:00Z"); // 22:10 İstanbul, 9 Ekim (yazıldığı an)
const AFTER_MIDNIGHT = new Date("2026-10-09T21:40:00Z"); // 00:40 İstanbul, 10 Ekim
const mockTool = vi.mocked(runAvailabilityTool);

const base = { organizationId: "org-A", propertyId: "p1", timeZone: TZ, now: NOW };

beforeEach(() => {
  vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "1");
  vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "1");
  mockTool.mockReset();
  mockTool.mockResolvedValue({ status: "ok" } as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("doğrulanmış müsaitlik — 'yarın' yazıldığı ana göre", () => {
  const ask = "Yarın daire müsait mi?";

  it("🚨 akşam yazılıp sabah işlenen 'yarın' → bugünün gecesi sorulur; takvim tazeliği işleme anı", async () => {
    await loadVerifiedAvailability({ ...base, guestTexts: [ask], lastGuestText: ask, writtenAt: LAST_EVENING, reservation: null });
    expect(mockTool).toHaveBeenCalledTimes(1);
    expect(mockTool.mock.calls[0][1]).toMatchObject({ propertyId: "p1", from: "2026-10-10", to: "2026-10-11" });
    expect(mockTool.mock.calls[0][2]).toBe(NOW);
  });

  it("KONTROL: yazıldığı an verilmezse işleme anı (QR anında cevaplanır)", async () => {
    await loadVerifiedAvailability({ ...base, guestTexts: [ask], lastGuestText: ask, reservation: null });
    expect(mockTool.mock.calls[0][1]).toMatchObject({ from: "2026-10-11", to: "2026-10-12" });
  });

  it("günler önce yazılmış 'yarın' YAZILDIĞI güne göre (8 Ekim) sorulur; geçmiş aralığı takvim aracı işleme anıyla reddeder → sonuç yok", async () => {
    mockTool.mockResolvedValueOnce({ status: "invalid_request" } as never); // motor: starts_in_past (işleme anına göre)
    const r = await loadVerifiedAvailability({ ...base, guestTexts: [ask], lastGuestText: ask, writtenAt: new Date("2026-10-07T09:00:00Z"), reservation: null });
    expect(mockTool.mock.calls[0][1]).toMatchObject({ from: "2026-10-08", to: "2026-10-09" });
    expect(mockTool.mock.calls[0][2]).toBe(NOW);
    expect(r).toBeNull();
  });

  it("🚨 gece yarısından sonra yazılan 'yarın' belirsiz → takvim sorgusu yok (ev sahibine)", async () => {
    const r = await loadVerifiedAvailability({ ...base, guestTexts: [ask], lastGuestText: ask, writtenAt: AFTER_MIDNIGHT, reservation: null });
    expect(r).toBeNull();
    expect(mockTool).not.toHaveBeenCalled();
  });
});

describe("doğrulanmış uzatma — 'yarın' yazıldığı ana göre", () => {
  const reservation = {
    arrivalDate: new Date("2026-10-07T00:00:00Z"),
    departureDate: new Date("2026-10-10T00:00:00Z"), // çıkış bugün (10 Ekim)
    channel: "airbnb",
    status: "confirmed",
  };
  // Kelime ağının uzatma saydığı biçim (yükleyicinin ön elemesi; "Yarın gece de kalabilir miyiz?" ağdan geçmez → modelli yol).
  const ask = "Yarın bir gece daha kalabilir miyiz?";

  it("🚨 akşam yazılan 'yarın bir gece daha kalabilir miyiz' → çıkış gecesi (10 Ekim) sorulur", async () => {
    await loadVerifiedExtension({ ...base, guestTexts: [ask], lastGuestText: ask, writtenAt: LAST_EVENING, reservation });
    expect(mockTool).toHaveBeenCalledTimes(1);
    expect(mockTool.mock.calls[0][1]).toMatchObject({ propertyId: "p1", from: "2026-10-10", to: "2026-10-11" });
  });

  it("KONTROL: işleme anına göre 'yarın' 11 Ekim olurdu — çıkış gününe değmez → sorgu yok", async () => {
    const r = await loadVerifiedExtension({ ...base, guestTexts: [ask], lastGuestText: ask, reservation });
    expect(r).toBeNull();
    expect(mockTool).not.toHaveBeenCalled();
  });

  it("🚨 gece yarısını KESEN: 23:50'de yazılıp 00:10'da işlenen 'yarın bir gece daha' → çıkış gecesi (10 Ekim)", async () => {
    const writtenAt = new Date("2026-10-09T20:50:00Z"); // 23:50 İstanbul, 9 Ekim
    const now = new Date("2026-10-09T21:10:00Z"); // 00:10 İstanbul, 10 Ekim
    await loadVerifiedExtension({ ...base, now, guestTexts: [ask], lastGuestText: ask, writtenAt, reservation });
    expect(mockTool.mock.calls[0][1]).toMatchObject({ from: "2026-10-10", to: "2026-10-11" });
    expect(mockTool.mock.calls[0][2]).toBe(now);
  });

  it("gece yarısından sonra yazılan 'yarın' belirsiz → sorgu yok", async () => {
    const r = await loadVerifiedExtension({ ...base, guestTexts: [ask], lastGuestText: ask, writtenAt: AFTER_MIDNIGHT, reservation });
    expect(r).toBeNull();
    expect(mockTool).not.toHaveBeenCalled();
  });
});
