import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/crypto";
import { generateSecret, totp } from "@/lib/auth/totp";
import {
  generateRecoveryCode,
  regenerateRecoveryCodes,
  consumeRecoveryCode,
  remainingRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/lib/auth/recovery-codes";
import type { SessionPayload } from "@/lib/auth";

// Codex #20 — 2FA recovery codes. Pins: hashed-at-rest (never plaintext),
// shown once, ATOMIC single-use, regeneration invalidates, 2FA-off can't mint,
// user/tenant boundaries, cascade erasure, login integration.

// Login route: avoid the real cookie store on success.
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setTrustedDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});
// 2FA management route reads the session from @/lib/api.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { setTrustedDeviceCookie } from "@/lib/auth";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as tfaGet, POST as tfaPost } from "@/app/api/account/2fa/route";

function loginReq(body: unknown, ip = "7.7.7.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
function tfaReq(body: unknown) {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeTfaUser(email = "tf@example.com") {
  const secret = generateSecret();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "TF",
      email,
      passwordHash: await hashPassword("correct-horse"),
      role: "owner",
      twoFactorSecret: encryptSecret(secret),
      twoFactorEnabledAt: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
  session = {
    userId: user.id, organizationId: org.id, role: "owner",
    email, name: "TF", sessionEpoch: 0,
  };
  return { orgId: org.id, userId: user.id, secret, email };
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
});

describe("recovery-codes lib", () => {
  it("code format: XXXX-XXXX-XXXX from the unambiguous alphabet (no I/L/O/U/0/1)", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateRecoveryCode();
      expect(c).toMatch(/^[A-HJ-KM-NP-TV-Z2-9]{4}-[A-HJ-KM-NP-TV-Z2-9]{4}-[A-HJ-KM-NP-TV-Z2-9]{4}$/);
      expect(c).not.toMatch(/[ILOU01]/);
    }
  });

  it("normalize accepts case/separator noise; hash is domain-separated sha256 (64 hex)", () => {
    expect(normalizeRecoveryCode(" k7qw-p2mh 9dtr ")).toBe("K7QWP2MH9DTR");
    const h = hashRecoveryCode("K7QWP2MH9DTR");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("K7QW");
  });

  it("generates 10 unique codes; DB holds ONLY hashes (plaintext never stored)", async () => {
    const { userId } = await makeTfaUser();
    const codes = await regenerateRecoveryCodes(userId);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    const rows = await prisma.twoFactorRecoveryCode.findMany({ where: { userId } });
    expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
    const rowJson = JSON.stringify(rows);
    for (const code of codes) {
      expect(rowJson).not.toContain(code); // plaintext absent
      expect(rowJson).not.toContain(normalizeRecoveryCode(code));
    }
    for (const r of rows) expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SINGLE-USE: a code consumes exactly once (second attempt fails)", async () => {
    const { userId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, code)).toBe(true);
    expect(await consumeRecoveryCode(userId, code)).toBe(false);
    expect(await remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT - 1);
  });

  it("ATOMIC under race: two concurrent consumes of ONE code → exactly one wins", async () => {
    const { userId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    const results = await Promise.all([
      consumeRecoveryCode(userId, code),
      consumeRecoveryCode(userId, code),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("normalization tolerance: lowercase + missing dashes still consume", async () => {
    const { userId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, code.toLowerCase().replace(/-/g, " "))).toBe(true);
  });

  it("REGENERATION invalidates every old code", async () => {
    const { userId } = await makeTfaUser();
    const [oldCode] = await regenerateRecoveryCodes(userId);
    await regenerateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, oldCode)).toBe(false);
    expect(await remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT);
  });

  it("USER BOUNDARY: one user's code never unlocks another user", async () => {
    const { userId: userA } = await makeTfaUser("a@example.com");
    const orgB = await prisma.organization.create({ data: { name: "OrgB" } });
    const userB = await prisma.user.create({
      data: { organizationId: orgB.id, name: "B", email: "b@example.com", passwordHash: "x" },
    });
    const [codeA] = await regenerateRecoveryCodes(userA);
    expect(await consumeRecoveryCode(userB.id, codeA)).toBe(false);
    expect(await remainingRecoveryCodes(userA)).toBe(RECOVERY_CODE_COUNT); // untouched
  });

  it("CASCADE: deleting the organization erases the user's recovery codes", async () => {
    const { orgId, userId } = await makeTfaUser();
    await regenerateRecoveryCodes(userId);
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await prisma.twoFactorRecoveryCode.count()).toBe(0);
  });
});

describe("POST /api/account/2fa action recovery_codes", () => {
  it("2FA OFF → cannot mint codes (400)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "N", email: "n@example.com", passwordHash: "x" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "n@example.com", name: "N", sessionEpoch: 0 };
    const res = await tfaPost(tfaReq({ action: "recovery_codes", code: "123456" }));
    expect(res.status).toBe(400);
    expect(await prisma.twoFactorRecoveryCode.count()).toBe(0);
  });

  it("requires a VALID current TOTP code (same bar as disable)", async () => {
    await makeTfaUser();
    const res = await tfaPost(tfaReq({ action: "recovery_codes", code: "000000" }));
    expect(res.status).toBe(400);
    expect(await prisma.twoFactorRecoveryCode.count()).toBe(0);
  });

  it("valid code → 10 plaintexts ONCE + audit; GET reports recoveryRemaining", async () => {
    const { userId, orgId, secret } = await makeTfaUser();
    const res = await tfaPost(tfaReq({ action: "recovery_codes", code: totp(secret) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(json.recoveryRemaining).toBe(RECOVERY_CODE_COUNT);
    // audit breadcrumb
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "account.2fa_recovery_generate" },
    });
    expect(audit).not.toBeNull();
    // GET surfaces the count (no plaintexts anywhere in it)
    const getRes = await tfaGet();
    const getJson = await getRes.json();
    expect(getJson).toMatchObject({ enabled: true, recoveryRemaining: RECOVERY_CODE_COUNT });
    expect(JSON.stringify(getJson)).not.toContain(json.codes[0]);
    expect(await remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT);
  });

  it("DISABLING 2FA clears the codes (no orphaned bypass credentials)", async () => {
    const { userId, secret } = await makeTfaUser();
    await regenerateRecoveryCodes(userId);
    const res = await tfaPost(tfaReq({ action: "disable", code: totp(secret) }));
    expect(res.status).toBe(200);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId } })).toBe(0);
  });

  it("RE-ENABLE cannot resurrect stale codes (diff-review fix): enable clears leftovers", async () => {
    // Simulate a past disable whose code-clear failed: 2FA off, rows alive.
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const secret = generateSecret();
    const user = await prisma.user.create({
      data: {
        organizationId: org.id, name: "R", email: "r@example.com", passwordHash: "x",
        twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: null, // setup done, not active
      },
    });
    await prisma.twoFactorRecoveryCode.create({ data: { userId: user.id, codeHash: "stale-hash" } });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "r@example.com", name: "R", sessionEpoch: 0 };
    const res = await tfaPost(tfaReq({ action: "enable", code: totp(secret) }));
    expect(res.status).toBe(200);
    // The stale pre-existing code must be GONE after activation.
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("POST /api/auth/login — recovery code as the second factor", () => {
  it("valid recovery code logs in, burns the code, audits, and honors rememberDevice", async () => {
    const { userId, orgId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    const res = await loginPost(
      loginReq({ email: "tf@example.com", password: "correct-horse", recoveryCode: code, rememberDevice: true }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(await remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT - 1);
    expect(vi.mocked(setTrustedDeviceCookie)).toHaveBeenCalled();
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "account.2fa_recovery_used" },
    });
    expect(audit).not.toBeNull();
  });

  it("a REUSED recovery code is rejected with 401 (single-use at the route too)", async () => {
    const { userId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    await loginPost(loginReq({ email: "tf@example.com", password: "correct-horse", recoveryCode: code }, "7.7.7.2"));
    const replay = await loginPost(
      loginReq({ email: "tf@example.com", password: "correct-horse", recoveryCode: code }, "7.7.7.3"),
    );
    expect(replay.status).toBe(401);
    expect((await replay.json()).twoFactorRequired).toBe(true);
  });

  it("garbage / another user's recovery code → 401; TOTP path still works after", async () => {
    const { secret } = await makeTfaUser();
    const bad = await loginPost(
      loginReq({ email: "tf@example.com", password: "correct-horse", recoveryCode: "AAAA-BBBB-CCCC" }, "7.7.7.4"),
    );
    expect(bad.status).toBe(401);
    // Normal TOTP login is unaffected (regression guard on the else-branch).
    const ok = await loginPost(
      loginReq({ email: "tf@example.com", password: "correct-horse", code: totp(secret) }, "7.7.7.5"),
    );
    expect(ok.status).toBe(200);
  });

  it("2FA on + NEITHER code NOR recovery → twoFactorRequired prompt (contract unchanged)", async () => {
    await makeTfaUser();
    const res = await loginPost(loginReq({ email: "tf@example.com", password: "correct-horse" }, "7.7.7.6"));
    expect(res.status).toBe(200);
    expect((await res.json()).twoFactorRequired).toBe(true);
  });

  it("recovery code does NOT bypass the password check", async () => {
    const { userId } = await makeTfaUser();
    const [code] = await regenerateRecoveryCodes(userId);
    const res = await loginPost(
      loginReq({ email: "tf@example.com", password: "WRONG", recoveryCode: code }, "7.7.7.7"),
    );
    expect(res.status).toBe(401);
    expect(await remainingRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT); // nothing burned
  });
});
