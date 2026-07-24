import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// requireSession reads the cookie in production; mock it to our seeded user.
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// Capture the e-mailed verification code instead of actually sending mail.
let lastEmailHtml = "";
let emailOk = true;
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _subject: string, html: string) => {
      lastEmailHtml = html;
      return emailOk ? { ok: true } : { ok: false, error: "no mailer" };
    }),
  },
}));

// Outbox (Tur-4): the inline kick is mocked so the fire-and-forget drain can't
// race the assertions — tests drain EXPLICITLY; the kick call itself is pinned.
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

import { POST } from "@/app/api/account/password/route";
import { drainEmailOutboxOnce, kickEmailOutboxDrain } from "@/lib/email-outbox";
import { emailService } from "@/lib/email";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function codeFromEmail(): string {
  const m = lastEmailHtml.match(/(\d{8})/);
  if (!m) throw new Error("no code in e-mail");
  return m[1];
}

describe("POST /api/account/password (e-mail code flow)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "old", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("request e-mails a code and stores it hashed (never plaintext)", async () => {
    const res = await POST(req({ action: "request" }));
    expect(res.status).toBe(200);
    const code = codeFromEmail();
    expect(code).toMatch(/^\d{8}$/);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { pwChangeCodeHash: true, pwChangeCodeExpiresAt: true },
    });
    expect(u?.pwChangeCodeHash).toBeTruthy();
    expect(u?.pwChangeCodeHash).not.toBe(code); // stored hashed
    expect(u?.pwChangeCodeExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("confirm with the correct code sets the new password and burns the code", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();

    const res = await POST(req({ action: "confirm", code, newPassword: "brandnew123" }));
    expect(res.status).toBe(200);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, pwChangeCodeHash: true, sessionEpoch: true },
    });
    expect(await verifyPassword("brandnew123", u!.passwordHash)).toBe(true);
    expect(u?.pwChangeCodeHash).toBeNull(); // code burned after use
    expect(u?.sessionEpoch).toBe(1); // bumped 0→1 → invalidates stolen tokens
  });

  it("rejects a wrong code, increments attempts, and leaves the password unchanged", async () => {
    await POST(req({ action: "request" }));

    const res = await POST(req({ action: "confirm", code: "00000000", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);

    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, pwChangeCodeAttempts: true },
    });
    expect(u?.passwordHash).toBe("old"); // unchanged
    expect(u?.pwChangeCodeAttempts).toBe(1);
  });

  it("burns the code after 5 wrong attempts — even the correct code then fails", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();
    for (let i = 0; i < 5; i++) {
      const r = await POST(req({ action: "confirm", code: "00000000", newPassword: "brandnew123" }));
      expect(r.status).toBe(400);
    }
    // 6th try with the REAL code must fail — the code is burned, not unlimited.
    const res = await POST(req({ action: "confirm", code, newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, pwChangeCodeHash: true },
    });
    expect(u?.passwordHash).toBe("old"); // never changed
    expect(u?.pwChangeCodeHash).toBeNull(); // burned
  });

  it("rejects confirm when no code was requested", async () => {
    const res = await POST(req({ action: "confirm", code: "12345678", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
    expect(u?.passwordHash).toBe("old");
  });

  it("rejects a too-short new password", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();
    const res = await POST(req({ action: "confirm", code, newPassword: "short" }));
    expect(res.status).toBe(400);
  });

  it("does not leave a dangling code if the e-mail could not be delivered", async () => {
    emailOk = false;
    const res = await POST(req({ action: "request" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { pwChangeCodeHash: true },
    });
    expect(u?.pwChangeCodeHash).toBeNull();
  });

  it("YARIŞ (Codex P1): aynı geçerli kodla iki PARALEL confirm — yalnız biri geçer, epoch TEK artar", async () => {
    await POST(req({ action: "request" }));
    const code = codeFromEmail();
    const [a, b] = await Promise.all([
      POST(req({ action: "confirm", code, newPassword: "yarisSifre111" })),
      POST(req({ action: "confirm", code, newPassword: "yarisSifre222" })),
    ]);
    // Koşulsuz çifte yazma yok: tam olarak biri 200, diğeri 400 (kod tüketildi).
    expect([a.status, b.status].sort()).toEqual([200, 400]);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(u.sessionEpoch).toBe(1); // tek bump — kaybeden epoch'a dokunamadı
    expect(u.pwChangeCodeHash).toBeNull(); // kod tek seferde yandı
    // Geçerli şifre KAZANANINKİ; kaybedenki asla yazılmadı (last-writer-wins yok).
    const winnerPw = a.status === 200 ? "yarisSifre111" : "yarisSifre222";
    const loserPw = a.status === 200 ? "yarisSifre222" : "yarisSifre111";
    expect(await verifyPassword(winnerPw, u.passwordHash)).toBe(true);
    expect(await verifyPassword(loserPw, u.passwordHash)).toBe(false);
  });
});

// ── Tur-4: EMAIL_OUTBOX_ENABLED=1 — the code request queues instead of sending.
describe("account/password — durable outbox (flag ON)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "old", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ESKİ WRITER DEVRE DIŞI: request senkron göndermez; satır + hash atomik; drain sonrası confirm uçtan uca çalışır", async () => {
    const res = await POST(req({ action: "request" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(emailService.sendReporting)).not.toHaveBeenCalled();
    expect(kickEmailOutboxDrain).toHaveBeenCalledTimes(1);
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.kind).toBe("pw_change_code");
    expect(row.status).toBe("pending");

    await drainEmailOutboxOnce();
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emailService.sendReporting).mock.calls[0][0]).toBe("u@example.com");
    const code = codeFromEmail();
    const conf = await POST(req({ action: "confirm", code, newPassword: "yeniSifre123" }));
    expect(conf.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(await verifyPassword("yeniSifre123", u.passwordHash)).toBe(true);
  });
});
