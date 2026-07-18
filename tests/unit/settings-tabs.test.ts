import { describe, it, expect } from "vitest";
import {
  deriveInitialTabId,
  SETTINGS_TAB_IDS,
  CONNECTION_TAB_ID,
  DEFAULT_TAB_ID,
} from "@/lib/settings-tabs";

const ALL = [...SETTINGS_TAB_IDS];
// A staff-like visible set: no billing tab.
const NO_BILLING = ALL.filter((id) => id !== "faturalandirma");

describe("deriveInitialTabId (settings tab precedence)", () => {
  it("?hospitable=<any code> wins → connection tab (banner renders on the right panel)", () => {
    // Any of the 8 OAuth callback codes lands here.
    for (const code of ["connected", "forbidden", "denied", "state_mismatch"]) {
      expect(deriveInitialTabId({ hospitable: code, tab: "hesap-guvenlik", visibleIds: ALL })).toBe(
        CONNECTION_TAB_ID,
      );
    }
  });

  it("a valid, visible ?tab= is honored", () => {
    expect(deriveInitialTabId({ tab: "faturalandirma", visibleIds: ALL })).toBe("faturalandirma");
    expect(deriveInitialTabId({ tab: "hesap-guvenlik", visibleIds: ALL })).toBe("hesap-guvenlik");
  });

  it("a ?tab= that is HIDDEN for this role falls back to the default (never an empty panel)", () => {
    // Staff has no billing tab; typing ?tab=faturalandirma must not strand them.
    expect(deriveInitialTabId({ tab: "faturalandirma", visibleIds: NO_BILLING })).toBe(DEFAULT_TAB_ID);
  });

  it("an unknown/garbage ?tab= falls back to the default", () => {
    expect(deriveInitialTabId({ tab: "does-not-exist", visibleIds: ALL })).toBe(DEFAULT_TAB_ID);
    expect(deriveInitialTabId({ tab: "", visibleIds: ALL })).toBe(DEFAULT_TAB_ID);
  });

  it("no param → the AI tab (product core) is the default", () => {
    expect(deriveInitialTabId({ visibleIds: ALL })).toBe(DEFAULT_TAB_ID);
    expect(DEFAULT_TAB_ID).toBe("yapay-zeka");
  });

  it("hospitable wins even over an explicit ?tab= (OAuth result must be seen)", () => {
    expect(
      deriveInitialTabId({ hospitable: "connected", tab: "hesap-guvenlik", visibleIds: ALL }),
    ).toBe(CONNECTION_TAB_ID);
  });

  it("returns the first visible tab if the default itself were ever hidden (floor, never off-list)", () => {
    const weird = ["baglanti-takvim", "hesap-guvenlik"]; // default not present
    expect(deriveInitialTabId({ visibleIds: weird })).toBe("baglanti-takvim");
  });

  it("hospitable is ignored if the connection tab is not visible (defensive)", () => {
    const noConnection = ["yapay-zeka", "hesap-guvenlik"];
    expect(deriveInitialTabId({ hospitable: "connected", visibleIds: noConnection })).toBe(
      DEFAULT_TAB_ID,
    );
  });
});
