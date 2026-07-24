import { describe, it, expect, vi, beforeEach } from "vitest";

// A Hospitable 402 "Subscription not active" is an expected external billing
// state (the org's own Hospitable sub lapsed), NOT a Lixus bug. It must NOT page
// Sentry + the alert email via serverError — that flooded the inbox with
// hundreds of identical "sistem hatası — api". Every other error still pages.

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { serverError } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { HospitableError } from "@/lib/hospitable";

const mockReport = vi.mocked(reportError);

beforeEach(() => vi.clearAllMocks());

describe("serverError — Hospitable 402 is not paged", () => {
  it("a HospitableError(402) → controlled 409 with a clear message, NOT a 500, and NOT paged", async () => {
    const res = serverError(undefined, new HospitableError("Hospitable API hatası (HTTP 402): Subscription not active", 402));
    expect(res.status).toBe(409); // meaningful, not a bare 500
    expect((await res.json()).error).toMatch(/Hospitable aboneliğiniz aktif değil/);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("a HospitableError with a DIFFERENT status still pages (only 402 is suppressed)", () => {
    serverError(undefined, new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe("api");
  });

  it("a generic error still pages", () => {
    serverError(undefined, new Error("boom"));
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it("no error passed → no paging (unchanged)", () => {
    serverError("x");
    expect(mockReport).not.toHaveBeenCalled();
  });
});
