import { describe, it, expect } from "vitest";
import {
  deriveInitialViewId,
  SETTINGS_VIEW_IDS,
  SETTINGS_NAV,
  CONNECTION_VIEW_ID,
  DEFAULT_VIEW_ID,
} from "@/lib/settings-nav";

const ALL = [...SETTINGS_VIEW_IDS];
// A non-owner visible set: no billing view.
const NO_BILLING = ALL.filter((id) => id !== "faturalandirma");

describe("settings-nav structure", () => {
  it("has exactly one grouped section (İşletme Ayarları) + two standalone sections", () => {
    expect(SETTINGS_NAV[0].label).toBe("İşletme Ayarları");
    expect(SETTINGS_NAV[0].items.map((i) => i.id)).toEqual([
      "yapay-zeka",
      "otomatik-mesajlar",
      "baglantilar",
      "bildirimler",
      "saat-dilimi",
    ]);
    // Standalone top-level sections carry no group header.
    const standalone = SETTINGS_NAV.slice(1);
    expect(standalone.map((g) => g.items[0].id)).toEqual(["faturalandirma", "hesap-guvenlik"]);
    expect(standalone.every((g) => g.label === null)).toBe(true);
  });

  it("the connection view (Hospitable deep-link target) lives under İşletme Ayarları", () => {
    expect(SETTINGS_NAV[0].items.some((i) => i.id === CONNECTION_VIEW_ID)).toBe(true);
    expect(CONNECTION_VIEW_ID).toBe("baglantilar");
  });
});

describe("deriveInitialViewId (settings view precedence)", () => {
  it("?hospitable=<any code> wins → connection view (banner on the right panel)", () => {
    for (const code of ["connected", "forbidden", "denied", "state_mismatch"]) {
      expect(deriveInitialViewId({ hospitable: code, tab: "hesap-guvenlik", visibleIds: ALL })).toBe(
        CONNECTION_VIEW_ID,
      );
    }
  });

  it("a valid, visible ?tab= is honored", () => {
    expect(deriveInitialViewId({ tab: "faturalandirma", visibleIds: ALL })).toBe("faturalandirma");
    expect(deriveInitialViewId({ tab: "bildirimler", visibleIds: ALL })).toBe("bildirimler");
  });

  it("a ?tab= HIDDEN for this role falls back to the default (never an empty panel)", () => {
    expect(deriveInitialViewId({ tab: "faturalandirma", visibleIds: NO_BILLING })).toBe(DEFAULT_VIEW_ID);
  });

  it("an unknown/garbage ?tab= falls back to the default", () => {
    expect(deriveInitialViewId({ tab: "nope", visibleIds: ALL })).toBe(DEFAULT_VIEW_ID);
    expect(deriveInitialViewId({ tab: "", visibleIds: ALL })).toBe(DEFAULT_VIEW_ID);
  });

  it("no param → the AI view (product core) is the default", () => {
    expect(deriveInitialViewId({ visibleIds: ALL })).toBe(DEFAULT_VIEW_ID);
    expect(DEFAULT_VIEW_ID).toBe("yapay-zeka");
  });

  it("hospitable wins even over an explicit ?tab=", () => {
    expect(
      deriveInitialViewId({ hospitable: "connected", tab: "hesap-guvenlik", visibleIds: ALL }),
    ).toBe(CONNECTION_VIEW_ID);
  });

  it("hospitable is ignored if the connection view is not visible (defensive)", () => {
    const noConnection = ["yapay-zeka", "hesap-guvenlik"];
    expect(deriveInitialViewId({ hospitable: "connected", visibleIds: noConnection })).toBe(
      DEFAULT_VIEW_ID,
    );
  });
});
