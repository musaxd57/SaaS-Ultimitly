import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";

// Capture the e-mailed code instead of sending mail.
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

import { POST } from "@/app/api/account/forgot-password/route";
import { drainEmailOutboxOnce, kickEmailOutboxDrain } from "@/lib/email-outbox";
import { emailService } from "@/lib/email";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/account/forgot-password", {
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

const EMAIL = "host@example.com";
const mockSendReporting = vi.mocked(emailService.sendReporting);

describe("POST /api/account/forgot-password (public reset)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });

  it("requests a code, mails it, and stores it hashed (never plaintext)", async () => {
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200);
    const code = codeFromEmail();
    expect(code).toMatch(/^\d{8}$/);
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy();
    expect(u?.pwResetCodeHash).not.toBe(code);
  });

  it("confirm with the correct code resets the password and burns the code", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    const res = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "brandnew123" }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeHash: true },
    });
    expect(await verifyPassword("brandnew123", u!.passwordHash)).toBe(true);
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("ENUMERATION: request for an unknown email returns 200 and stores no code anywhere", async () => {
    const res = await POST(req({ action: "request", email: "nobody@example.com" }));
    expect(res.status).toBe(200); // identical to a known-email response
    expect(lastEmailHtml).toBe(""); // no mail sent
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeNull(); // the real account is untouched
  });

  it("ENUMERATION: confirm for an unknown email returns the same generic 400 as a wrong code", async () => {
    const res = await POST(
      req({ action: "confirm", email: "nobody@example.com", code: "12345678", newPassword: "brandnew123" }),
    );
    expect(res.status).toBe(400);
  });

  it("wrong code increments attempts and leaves the password unchanged", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const res = await POST(req({ action: "confirm", email: EMAIL, code: "00000000", newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeAttempts: true },
    });
    expect(u?.passwordHash).toBe("old");
    expect(u?.pwResetCodeAttempts).toBe(1);
  });

  it("burns the code after 5 wrong attempts — even the correct code then fails", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    for (let i = 0; i < 5; i++) {
      const r = await POST(req({ action: "confirm", email: EMAIL, code: "00000000", newPassword: "brandnew123" }));
      expect(r.status).toBe(400);
    }
    const res = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "brandnew123" }));
    expect(res.status).toBe(400);
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { passwordHash: true, pwResetCodeHash: true },
    });
    expect(u?.passwordHash).toBe("old");
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("does not leave a dangling code if the e-mail could not be delivered (still 200)", async () => {
    emailOk = false;
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200); // enumeration-safe: same shape as success
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeNull();
  });

  it("YARIŞ (Codex P1): aynı geçerli kodla iki PARALEL confirm — yalnız biri geçer, kod tek yanar", async () => {
    await POST(req({ action: "request", email: EMAIL }));
    const code = codeFromEmail();
    const [a, b] = await Promise.all([
      POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yarisSifre111" })),
      POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yarisSifre222" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.sessionEpoch).toBe(1); // tek bump
    expect(u.pwResetCodeHash).toBeNull();
    const winnerPw = a.status === 200 ? "yarisSifre111" : "yarisSifre222";
    const loserPw = a.status === 200 ? "yarisSifre222" : "yarisSifre111";
    expect(await verifyPassword(winnerPw, u.passwordHash)).toBe(true);
    expect(await verifyPassword(loserPw, u.passwordHash)).toBe(false);
  });
});

// ── Tur-4: EMAIL_OUTBOX_ENABLED=1 — the request path no longer touches the
// provider; the code is queued and delivered by the drain. Same generic 200s.
describe("forgot-password — durable outbox (flag ON)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    emailOk = true;
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ESKİ WRITER DEVRE DIŞI: request SENKRON e-posta göndermez; hash + outbox satırı atomik, kick tetiklenir", async () => {
    const res = await POST(req({ action: "request", email: EMAIL }));
    expect(res.status).toBe(200);
    expect(mockSendReporting).not.toHaveBeenCalled(); // no synchronous provider call
    expect(kickEmailOutboxDrain).toHaveBeenCalledTimes(1); // latency optimizer wired

    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.kind).toBe("pw_reset_code");
    expect(row.status).toBe("pending");

    // Drain delivers through the (mocked) provider; the code from the mail
    // completes the confirm flow end-to-end.
    await drainEmailOutboxOnce();
    expect(mockSendReporting).toHaveBeenCalledTimes(1);
    expect(mockSendReporting.mock.calls[0][0]).toBe(EMAIL);
    const code = codeFromEmail();
    const conf = await POST(req({ action: "confirm", email: EMAIL, code, newPassword: "yeniSifre123" }));
    expect(conf.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword("yeniSifre123", after.passwordHash)).toBe(true);
  });

  it("bilinmeyen e-posta: aynı generic 200, hiç satır yok, kick yok", async () => {
    const res = await POST(req({ action: "request", email: "yok@example.com" }));
    expect(res.status).toBe(200);
    expect(await prisma.emailOutbox.count()).toBe(0);
    expect(mockSendReporting).not.toHaveBeenCalled();
    expect(kickEmailOutboxDrain).not.toHaveBeenCalled();
  });

  it("provider hatası kodu GERİ SİLMEZ: satır retry'a düşer, hash yerinde kalır (legacy davranışın aksine)", async () => {
    emailOk = false;
    await POST(req({ action: "request", email: EMAIL }));
    await drainEmailOutboxOnce();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("pending"); // scheduled retry, not lost
    expect(row.attemptCount).toBe(1);
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { pwResetCodeHash: true } });
    expect(u?.pwResetCodeHash).toBeTruthy(); // code stays valid for the retry
  });
});
