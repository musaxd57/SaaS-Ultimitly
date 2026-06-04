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

  it("posts a Sentry envelope when SENTRY_DSN is set, and skips when unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ERROR_ALERT_EMAIL", "");
    vi.stubEnv("ALERT_EMAIL", "");

    // Unset → no Sentry call.
    vi.stubEnv("SENTRY_DSN", "");
    await reportError("ctx", new Error("x"));
    expect(fetchMock).not.toHaveBeenCalled();

    // Set → one envelope POST to the derived ingest endpoint.
    vi.stubEnv("SENTRY_DSN", "https://pubkey@o123.ingest.sentry.io/456");
    await reportError("sync-fail", new Error("kaboom"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    expect(String((init as RequestInit).body)).toContain("kaboom");
  });
});
