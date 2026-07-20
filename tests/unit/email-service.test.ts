import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emailService } from "@/lib/email";

// Fail-open hardening: the fire-and-forget send() must never echo the recipient /
// subject / body / verification token to the logs in PRODUCTION without a provider
// (a verification/reset link in Railway logs is an account-takeover vector). The DEV
// console fallback is dev/test-only. A send failure logs a SECRET-FREE provider error.

describe("EmailService.send — no PII/token in the production fallback or failure log", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const link = "<a href='https://x.example/verify?token=SEKRETTOKEN1234'>Doğrula</a>";

  it("PRODUCTION + no provider: NEVER logs recipient/subject/body/token (secret-free only)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_HOST", "");
    await emailService.send("victim@example.com", "E-postanı doğrula", link);
    expect(logSpy).not.toHaveBeenCalled(); // no DEV echo in production
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("victim@example.com");
    expect(logged).not.toContain("SEKRETTOKEN1234");
    expect(logged).not.toContain("E-postanı doğrula");
  });

  it("DEV + no provider: echoes the link so it's usable locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_HOST", "");
    await emailService.send("dev@example.com", "Verify", "<p>link</p>");
    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("dev@example.com");
  });

  it("configured + send FAILS: logs a SCRUBBED provider error — the recipient is not leaked", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_HOST", "");
    // A provider 4xx body that echoes the recipient (Resend/SMTP errors often do).
    vi.stubGlobal("fetch", vi.fn(async () => new Response("to: victim@example.com is not allowed", { status: 422 })));
    await emailService.send("victim@example.com", "Verify", "<p>x</p>");
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("send failed");
    expect(logged).not.toContain("victim@example.com"); // scrubbed → [EMAIL]
  });
});
