import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn() } }));

import { emailService } from "@/lib/email";
import { reportError, __resetReportThrottle } from "@/lib/report-error";

const mockSend = vi.mocked(emailService.send);

describe("reportError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetReportThrottle();
    mockSend.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("never throws and logs without email when ERROR/ALERT email is unset", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "");
    vi.stubEnv("ALERT_EMAIL", "");
    await expect(reportError("ctx", new Error("boom"))).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("emails the operator when configured, then throttles repeats", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    await reportError("sync", new Error("first"));
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, subject] = mockSend.mock.calls[0];
    expect(to).toBe("ops@example.com");
    expect(subject).toContain("sync");

    // A second error immediately after is throttled (no flood).
    await reportError("sync", new Error("second"));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("swallows email failures (reporting must not throw)", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    mockSend.mockRejectedValueOnce(new Error("smtp down"));
    await expect(reportError("ctx", "weird")).resolves.toBeUndefined();
  });
});
