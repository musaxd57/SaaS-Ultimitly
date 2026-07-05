import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn() } }));

import { emailService } from "@/lib/email";
import { reportError, redactSensitive, __resetReportThrottle } from "@/lib/report-error";

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

  it("redacts PII/secrets from BOTH the Sentry envelope and the alert email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SENTRY_DSN", "https://pubkey@o123.ingest.sentry.io/456");
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");

    const leaky = new Error(
      'HospitableError: HTTP 500: {"full_name":"John Smith","email":"guest@x.com","phone":"+90 555 123 4567","door_code":"482913"} Authorization: Bearer sk-abc123def456ghi Cookie: s=zzz whsec_xyz',
    );
    await reportError("hospitable-sync", leaky);

    const sentryBody = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    const emailHtml = String(mockSend.mock.calls[0][2]);
    for (const s of [sentryBody, emailHtml]) {
      expect(s).not.toContain("John Smith");
      expect(s).not.toContain("guest@x.com");
      expect(s).not.toContain("555 123");
      expect(s).not.toContain("482913");
      expect(s).not.toContain("sk-abc123def456ghi");
      expect(s).not.toContain("whsec_xyz");
      expect(s).not.toContain("s=zzz");
      // Debuggable parts SURVIVE:
      expect(s).toContain("HospitableError");
      expect(s).toContain("HTTP 500");
    }
    expect(sentryBody).toContain("hospitable-sync"); // context/transaction preserved for grouping
  });
});

describe("redactSensitive", () => {
  it("masks secret/PII values, keeps status codes + error types/codes + stack shape", () => {
    expect(redactSensitive("contact guest@x.com now")).not.toContain("guest@x.com"); // unlabeled email
    expect(redactSensitive("Bearer sk-abc123def456ghijk")).not.toContain("sk-abc123def456ghijk");
    expect(redactSensitive("whsec_abcdef")).toBe("whsec_[REDACTED]");
    expect(redactSensitive("call +905551112233 please")).not.toContain("905551112233"); // unlabeled phone
    expect(redactSensitive('{"door_code":"482913"}')).not.toContain("482913");
    // preserved:
    expect(redactSensitive("PrismaClientKnownRequestError P2002 on field")).toContain("P2002");
    expect(redactSensitive("HTTP 429 Too Many Requests")).toContain("429");
    expect(redactSensitive("invalid_grant")).toBe("invalid_grant");
    expect(redactSensitive("")).toBe("");
  });

  it("redacts quoted PII values that CONTAIN commas (address/full_name/guest_name)", () => {
    // Regression for the FIELD_RE comma-leak: the value matcher used to stop at the
    // first comma, so a quoted address/name leaked the rest of its value to the
    // US-hosted Sentry / alert email / retained logs.
    expect(redactSensitive('{"address":"Istanbul, Turkey"}')).not.toContain("Istanbul");
    expect(redactSensitive('{"address":"Istanbul, Turkey"}')).not.toContain("Turkey");
    expect(redactSensitive('{"full_name":"Yılmaz, Ahmet"}')).not.toContain("Yılmaz");
    const multi = redactSensitive('{"guest_name":"Mehmet, Demir","address":"Beşiktaş, İstanbul"}');
    expect(multi).not.toContain("Mehmet");
    expect(multi).not.toContain("Beşiktaş");
    // a bare unquoted sensitive value still redacts; an error code after it survives
    expect(redactSensitive("address: Ataturk Cad No 5, P2002")).toContain("P2002");
  });

  it("strips PII/keys from an OpenAI-style error body but keeps the error type/code", () => {
    // Mirrors what ai/index.ts feeds reportError: the OpenAI API error RESPONSE
    // body (which may echo an offending value) plus the request's auth header.
    const openai = redactSensitive(
      '{"error":{"message":"Invalid value for input: guest@x.com","type":"invalid_request_error",' +
        '"code":"invalid_value"}} Authorization: Bearer sk-live-abc123def456ghi',
    );
    expect(openai).not.toContain("guest@x.com"); // echoed PII gone
    expect(openai).not.toContain("sk-live-abc123def456ghi"); // API key gone
    expect(openai).toContain("invalid_request_error"); // error type kept (debuggable)
    expect(openai).toContain("invalid_value"); // error code kept
  });
});
