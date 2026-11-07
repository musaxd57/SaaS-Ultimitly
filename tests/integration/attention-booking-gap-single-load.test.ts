import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// V2 boşluk satırı (hazır yama) — Haiku incelemesi: anahtar açıkken pano çakışma ve boşluk için müsaitlik verisini İKİ kez yüklüyordu
// (pano her açılışta çağırır). Çakışma + boşluk TEK yüklemeden türetilir; anahtar kapalıyken de tek yükleme (bugünkü yol).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/modules/availability/load", async (orig) => {
  const actual = await orig<typeof import("@/modules/availability/load")>();
  return { ...actual, loadAvailabilityInputs: vi.fn(actual.loadAvailabilityInputs) };
});

import { loadAvailabilityInputs } from "@/modules/availability/load";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

const NOW = new Date("2026-10-01T09:00:00Z");

describe("Dikkat Gerektirenler — müsaitlik verisi tek yükleme", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(loadAvailabilityInputs).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 boşluk anahtarı AÇIK: tek yükleme (çakışma + boşluk aynı veriden)", async () => {
    vi.stubEnv("ATTENTION_GAP_ENABLED", "1");
    const { orgId } = await makeOrgWithProperty();
    await findAttentionItems(orgId, { now: NOW });
    expect(vi.mocked(loadAvailabilityInputs)).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: anahtar kapalı: yine tek yükleme (bugünkü yol)", async () => {
    vi.stubEnv("ATTENTION_GAP_ENABLED", "");
    const { orgId } = await makeOrgWithProperty();
    await findAttentionItems(orgId, { now: NOW });
    expect(vi.mocked(loadAvailabilityInputs)).toHaveBeenCalledTimes(1);
  });
});
