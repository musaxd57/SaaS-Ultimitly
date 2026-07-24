import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import {
  EMAIL_VERIFY_REQUIRED_FROM,
  needsEmailVerification,
  makeVerifyToken,
  hashVerifyToken,
  appBaseUrl,
  baseUrlFromHost,
  verifyUrl,
} from "@/lib/auth/email-verify";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";

// setSessionCookie touches next/headers cookies() — unavailable outside a request
// scope in tests. Mock it (the existing login-route test does the same).
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined) };
});

// Don't actually send mail; capture the HTML so we can pull the verify link.
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
import { emailService } from "@/lib/email";

// Outbox (Tur-4): the inline kick is mocked so its fire-and-forget drain can't
// race the assertions — the flag-ON tests drain EXPLICITLY.
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
import { drainEmailOutboxOnce } from "@/lib/email-outbox";

import { LEGAL_VERSION } from "@/lib/legal-entity";
import { LEGAL_TEXT_HASH } from "@/lib/legal-text-hash";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as verifyEmail } from "@/app/api/auth/verify-email/route";

// register + resend-verification now go through sendReporting (checked result — not
// fire-and-forget), so the verification link + "was it sent" assertions read it.
const mockSendReporting = vi.mocked(emailService.sendReporting);

function postReq(url: string, body: unknown, extraHeaders?: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

const BEFORE = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() - 86_400_000); // pre-cutoff
const AFTER = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() + 86_400_000); // post-cutoff

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  process.env.REGISTRATION_OPEN = "1";
});
afterAll(async () => {
  delete process.env.REGISTRATION_OPEN;
  await prisma.$disconnect();
});

describe("email-verify helpers", () => {
  it("hash is deterministic; makeVerifyToken matches its hash", () => {
    const { raw, hash } = makeVerifyToken();
    expect(raw).toHaveLength(64);
    expect(hash).toBe(hashVerifyToken(raw));
  });

  it("appBaseUrl is a FIXED trusted base — canonical-pinned (Codex 07-23 #2)", () => {
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // canonical default (APP_URL unset)
    // Trusted values pass through:
    vi.stubEnv("APP_URL", "https://www.lixusai.com/");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // trailing slash normalized
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(appBaseUrl()).toBe("http://localhost:3000"); // dev/test localhost carve-out
    // UNTRUSTED values fail CLOSED to canonical — verification tokens ride these
    // links, so a foreign/http origin must never become the link base:
    vi.stubEnv("APP_URL", "https://app.example.com");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // foreign https → canonical
    vi.stubEnv("APP_URL", "https://www.lixusai.eu");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // .eu DELİBERATELY not allowlisted yet
    vi.stubEnv("APP_URL", "not-a-url");
    expect(appBaseUrl()).toBe("https://www.lixusai.com"); // invalid → canonical
    vi.unstubAllEnvs();
  });

  it("PRODUCTION: appBaseUrl accepts ONLY the exact canonical origin (localhost dahil hiçbir şey)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://www.lixusai.com");
    expect(appBaseUrl()).toBe("https://www.lixusai.com");
    for (const bad of [
      "http://www.lixusai.com", // http'li canonical bile RED
      "https://evil.example",
      "https://www.lixusai.eu",
      "http://localhost:3000", // prod'da localhost carve-out YOK
    ]) {
      vi.stubEnv("APP_URL", bad);
      expect(appBaseUrl()).toBe("https://www.lixusai.com");
    }
    // isAllowedHost'un APP_URL dalı da güvenilmeyen host'u AÇMAZ:
    vi.stubEnv("APP_URL", "https://evil.example");
    expect(baseUrlFromHost("evil.example")).toBe("https://www.lixusai.com");
    vi.unstubAllEnvs();
  });

  it("verifyUrl ignores the Host entirely — the emailed link is host-injection-proof", () => {
    const url = verifyUrl("a".repeat(64));
    expect(url.startsWith("https://www.lixusai.com/api/auth/verify-email?token=")).toBe(true);
  });

  it("baseUrlFromHost ALLOWLISTS: real/localhost hosts pass, a forged host falls back to the fixed base", () => {
    expect(baseUrlFromHost("www.lixusai.com")).toBe("https://www.lixusai.com");
    expect(baseUrlFromHost("lixusai.com")).toBe("https://lixusai.com");
    expect(baseUrlFromHost("localhost:3000")).toBe("http://localhost:3000"); // dev
    expect(baseUrlFromHost("attacker.com")).toBe("https://www.lixusai.com"); // injection → trusted base
    expect(baseUrlFromHost("www.lixusai.com.evil.com")).toBe("https://www.lixusai.com"); // suffix trick blocked
    expect(baseUrlFromHost(null)).toBe("https://www.lixusai.com");
  });

  it("gates ONLY post-cutoff unverified accounts (existing users exempt)", () => {
    expect(needsEmailVerification({ createdAt: BEFORE, emailVerifiedAt: null })).toBe(false);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: null })).toBe(true);
    expect(needsEmailVerification({ createdAt: AFTER, emailVerifiedAt: new Date() })).toBe(false);
  });
});

describe("registration → verification → login", () => {
  it("registration creates an UNVERIFIED account, mails a link, returns verifyEmail (no auto-login)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ verifyEmail: true });
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).toBeTruthy();
    expect(u?.acceptedTermsAt).not.toBeNull(); // KVKK consent recorded
    expect(mockSendReporting).toHaveBeenCalledOnce();
  });

  it("verification-email failure → 503 (NOT a false 201), account KEPT and resend-able", async () => {
    // Fail-open fix: the mailer reports a failure — the caller must NOT pretend the
    // account is ready. It returns a secret-free 503, keeps the account (its verify
    // token is intact so the user can resend), and never deletes it or wraps the send
    // in the DB transaction.
    mockSendReporting.mockResolvedValueOnce({ ok: false, error: "Resend HTTP 500 — upstream down" });
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "mailfail@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.accountCreated).toBe(true);
    expect(json).not.toMatchObject({ verifyEmail: true }); // never the success shape
    expect(String(json.error ?? "")).not.toContain("Resend HTTP 500"); // no provider detail leaked
    // Account KEPT with a live verify token → resend works later.
    const u = await prisma.user.findUnique({ where: { email: "mailfail@x.com" } });
    expect(u).not.toBeNull();
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.emailVerifyTokenHash).toBeTruthy();
  });

  it("records KVKK consent EVIDENCE: privacy timestamp, legal version, IP (rightmost XFF), User-Agent", async () => {
    const res = await register(
      postReq(
        "http://localhost/api/auth/register",
        { organizationName: "Acme", name: "Ada", email: "ev@x.com", password: "secret123", consent: true },
        // leftmost XFF is the client-spoofable hop; rightmost (5.6.7.8) is what the
        // platform proxy actually observed and the value we must record.
        { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "TestBrowser/1.0" },
      ),
    );
    expect(res.status).toBe(201);
    const u = await prisma.user.findUnique({ where: { email: "ev@x.com" } });
    expect(u?.acceptedTermsAt).not.toBeNull();
    expect(u?.privacyAcceptedAt).not.toBeNull();
    // one checkbox → both acceptances share the same instant
    expect(u?.privacyAcceptedAt?.getTime()).toBe(u?.acceptedTermsAt?.getTime());
    expect(u?.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(u?.acceptedLegalTextHash).toBe(LEGAL_TEXT_HASH); // tamper-evident companion
    expect(u?.acceptedIp).toBe("5.6.7.8"); // rightmost hop, spoofed leftmost discarded
    expect(u?.acceptedUserAgent).toBe("TestBrowser/1.0");
  });

  it("consent evidence is null-safe when IP/UA headers are absent (no crash)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "noua@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    const u = await prisma.user.findUnique({ where: { email: "noua@x.com" } });
    expect(u?.acceptedLegalVersion).toBe(LEGAL_VERSION); // version always stamped
    expect(u?.acceptedLegalTextHash).toBe(LEGAL_TEXT_HASH); // hash always stamped too
    expect(u?.acceptedIp).toBe("unknown"); // clientIp fallback when no XFF/x-real-ip
    expect(u?.acceptedUserAgent).toBeNull(); // header absent → null (not "")
  });

  it("rejects registration without KVKK consent (400, no account created)", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "noconsent@x.com",
        password: "secret123",
        // consent intentionally omitted
      }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: "noconsent@x.com" } })).toBeNull();
    expect(mockSendReporting).not.toHaveBeenCalled();
  });

  it("clicking the e-mailed link verifies the account + clears the token", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    const html = String(mockSendReporting.mock.calls[0][2]);
    const token = html.match(/token=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();

    const res = await verifyEmail(new NextRequest(`http://www.lixusai.com/api/auth/verify-email?token=${token}`));
    expect(res.status).toBe(307); // redirect
    expect(res.headers.get("location")).toContain("/dashboard");
    const u = await prisma.user.findUnique({ where: { email: "ada@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.emailVerifyTokenHash).toBeNull();
  });

  it("RACE: concurrent clicks on the same verify link mint EXACTLY ONE session (atomic consume)", async () => {
    // Codex #11: findFirst→update let two concurrent requests both pass the
    // lookup before either update landed — two sessions from one token. The
    // consume must be conditionally atomic (updateMany WHERE hash still set).
    const org = await prisma.organization.create({ data: { name: "X" } });
    const { raw, hash } = makeVerifyToken();
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "race@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
        emailVerifyTokenHash: hash,
        emailVerifyExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        verifyEmail(new NextRequest(`http://www.lixusai.com/api/auth/verify-email?token=${raw}`)),
      ),
    );
    const winners = responses.filter((r) => r.headers.get("location")?.includes("/dashboard"));
    const losers = responses.filter((r) => r.headers.get("location")?.includes("verify=expired"));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);

    const u = await prisma.user.findUnique({ where: { email: "race@x.com" } });
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.emailVerifyTokenHash).toBeNull();
  });

  it("HOST-INJECTION: a forged Host on register does NOT poison the emailed verify link", async () => {
    await register(
      postReq(
        "http://localhost/api/auth/register",
        { organizationName: "Acme", name: "Ada", email: "vic@x.com", password: "secret123", consent: true },
        { host: "attacker.evil.com" }, // attacker-controlled Host header
      ),
    );
    const html = String(mockSendReporting.mock.calls[0][2]);
    expect(html).not.toContain("attacker.evil.com"); // token never leaves for the attacker's domain
    expect(html).toContain("https://www.lixusai.com/api/auth/verify-email?token=");
  });

  it("HOST-INJECTION: a forged Host on RESEND does NOT poison the emailed verify link", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "resend@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
        emailVerifiedAt: null,
      },
    });
    const res = await resendVerification(
      postReq("http://localhost/api/auth/resend-verification", { email: "resend@x.com" }, { host: "attacker.evil.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockSendReporting).toHaveBeenCalledOnce();
    const html = String(mockSendReporting.mock.calls[0][2]);
    expect(html).not.toContain("attacker.evil.com");
    expect(html).toContain("https://www.lixusai.com/api/auth/verify-email?token=");
  });

  it("a NEW (post-cutoff) unverified account is BLOCKED from login (403), then allowed once verified", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ada",
        email: "ada@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: AFTER,
      },
    });
    const blocked = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ needsVerification: true });

    await prisma.user.update({ where: { email: "ada@x.com" }, data: { emailVerifiedAt: new Date() } });
    const ok = await login(postReq("http://localhost/api/auth/login", { email: "ada@x.com", password: "secret123" }));
    expect(ok.status).toBe(200);
  });

  it("an EXISTING (pre-cutoff) user logs in fine even if unverified — founder NOT locked out", async () => {
    const org = await prisma.organization.create({ data: { name: "Nuve" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Founder",
        email: "founder@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "owner",
        createdAt: BEFORE,
        emailVerifiedAt: null,
      },
    });
    const res = await login(postReq("http://localhost/api/auth/login", { email: "founder@x.com", password: "secret123" }));
    expect(res.status).toBe(200);
  });
});

// ── Tur-4: EMAIL_OUTBOX_ENABLED=1 — register/resend queue the verification
// link instead of sending synchronously. 201 ⟺ hesap+hash+outbox TEK commit.
describe("register + resend — durable outbox (flag ON)", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  function linkFromLastMail(): string {
    const html = String(mockSendReporting.mock.calls.at(-1)?.[2] ?? "");
    const m = html.match(/href="([^"]+)"/);
    if (!m) throw new Error("no link in e-mail");
    return m[1];
  }

  it("ATOMİK 201 (Codex kapanış 2): kayıt tek TX'te hesap+hash+outbox yazar; SENKRON e-posta yok; drain sonrası link doğrular", async () => {
    const res = await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendReporting).not.toHaveBeenCalled(); // eski writer devre dışı

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } });
    expect(user.emailVerifyTokenHash).toBeTruthy();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.kind).toBe("verify_email");
    expect(row.status).toBe("pending");
    expect(row.userId).toBe(user.id); // aynı commit'in parçası

    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][0]).toBe("ada@x.com");
    const link = linkFromLastMail();
    const verify = await verifyEmail(new NextRequest(link, { headers: { host: "www.lixusai.com" } }));
    expect([200, 302, 307]).toContain(verify.status); // link works end-to-end
    const after = await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } });
    expect(after.emailVerifiedAt).toBeTruthy();
  });

  it("RESEND: yeni token eski teslim-edilmemiş linki süperseder; yalnız YENİ link gönderilir ve doğrular", async () => {
    await register(
      postReq("http://localhost/api/auth/register", {
        organizationName: "Acme",
        name: "Ada",
        email: "ada@x.com",
        password: "secret123",
        consent: true,
      }),
    );
    // İlk link HİÇ teslim edilmeden kullanıcı "yeniden gönder" der.
    const res = await resendVerification(
      postReq("http://localhost/api/auth/resend-verification", { email: "ada@x.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockSendReporting).not.toHaveBeenCalled(); // resend de senkron göndermez

    const rows = await prisma.emailOutbox.findMany({ orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "canceled"], // superseded — eski token'ın maili ASLA gitmez
      [2, "pending"],
    ]);

    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1); // tek mail: yenisi
    const link = linkFromLastMail();
    const verify = await verifyEmail(new NextRequest(link, { headers: { host: "www.lixusai.com" } }));
    expect([200, 302, 307]).toContain(verify.status);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: "ada@x.com" } })).emailVerifiedAt,
    ).toBeTruthy();
  });
});
