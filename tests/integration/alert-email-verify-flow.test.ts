import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// UYARI ADRESİ — DOĞRULAMA BAĞLANTISI (kurucu kararı 09-30, seçim "Doğrulama bağlantısı"; bayrak `ALERT_EMAIL_VERIFY_ENABLED`).
//  · Bayrak kapalı → bugünkü davranış (ekip dışı adres reddedilir).
//  · Bayrak açık → ekip dışı adres KAYDEDİLMEZ; o adrese imzalı bağlantı gider; onaylanınca kaydedilir.
//  · Eski bağlantı sonradan seçilen adresi geri alamaz (CAS); başka işletmeye dokunamaz; gönderim günlük tavanlı.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { PATCH } from "@/app/api/settings/route";
import { POST as VERIFY } from "@/app/api/alert-email/verify/route";
import { emailService } from "@/lib/email";
import { ALERT_EMAIL_VERIFY_SUBJECT } from "@/lib/alert-email-verify";

const mockMail = vi.mocked(emailService.sendReporting);
const ctx = { params: Promise.resolve({} as Record<string, never>) };
const OUTSIDE = "ops-desk@example.net";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}
function verify(token: unknown, contentType = "application/json") {
  return VERIFY(
    new NextRequest("http://localhost/api/alert-email/verify", {
      method: "POST",
      headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ token }),
    }),
  );
}
/** E-postadaki bağlantıdan belirteç (parçadaki `#t=`). */
function tokenFromMail(call = 0): string {
  const html = String(mockMail.mock.calls[call]![2]);
  const m = /\/uyari-adresi-dogrula#t=([A-Za-z0-9._~%-]+)/.exec(html);
  if (!m) throw new Error("bağlantı yok");
  return decodeURIComponent(m[1]!);
}
async function alertEmailOf(id: string) {
  return (await prisma.organization.findUniqueOrThrow({ where: { id }, select: { alertEmail: true } })).alertEmail;
}

describe("uyarı adresi doğrulaması", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true });
    vi.stubEnv("AUTH_SECRET", "test-secret-0123456789abcdef");
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const owner = await prisma.user.create({
      data: { organizationId: orgId, name: "Sahip", email: "owner@example.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "owner@example.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL — bayrak KAPALI: ekip dışı adres bugünkü gibi reddedilir, e-posta yok", async () => {
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "");
    const res = await patch({ alertEmail: OUTSIDE });
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.alertEmail).toContain("bu işletmedeki bir kullanıcının");
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("🚨 ekip dışı adres KAYDEDİLMEZ; o adrese doğrulama bağlantısı gider; onaylanınca kaydedilir", async () => {
    const res = await patch({ alertEmail: OUTSIDE });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alertEmailPending: true });
    expect(await alertEmailOf(orgId)).toBeNull();
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(mockMail.mock.calls[0]![0]).toBe(OUTSIDE);
    expect(mockMail.mock.calls[0]![1]).toBe(ALERT_EMAIL_VERIFY_SUBJECT);
    // Kişiselleştirilmez: işletme adı e-postada yok.
    expect(String(mockMail.mock.calls[0]![2])).not.toContain("Org<");
    const sent = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "settings.alert_email_verification_sent" } });
    expect(sent.metadataJson ?? "").not.toContain(OUTSIDE); // değer denetim kaydına girmez

    const ok = await verify(tokenFromMail());
    expect(ok.status).toBe(200);
    expect(await alertEmailOf(orgId)).toBe(OUTSIDE);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "settings.alert_email_verified" } })).toBe(1);
    // Aynı bağlantı ikinci kez: zaten bu adres → başarı (idempotent), ikinci kayıt yok.
    expect((await verify(tokenFromMail())).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "settings.alert_email_verified" } })).toBe(1);
  });

  it("KONTROL — ekip üyesinin adresi bugünkü gibi doğrudan kaydedilir (e-posta yok)", async () => {
    const res = await patch({ alertEmail: "owner@example.com" });
    expect(res.status).toBe(200);
    expect(await alertEmailOf(orgId)).toBe("owner@example.com");
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("kayıtlı bir uyarı adresi varken de onay çalışır (belirteç o adresi taşır, CAS onunla eşleşir)", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "owner@example.com" } });
    await patch({ alertEmail: OUTSIDE });
    expect(await alertEmailOf(orgId)).toBe("owner@example.com"); // onaya kadar eski adres geçerli
    expect((await verify(tokenFromMail())).status).toBe(200);
    expect(await alertEmailOf(orgId)).toBe(OUTSIDE);
  });

  it("🚨 eski bağlantı sonradan seçilen adresi GERİ ALAMAZ (CAS: belirteç istek anındaki adrese bağlı)", async () => {
    await patch({ alertEmail: OUTSIDE });
    const stale = tokenFromMail();
    // Ev sahibi fikrini değiştirip ekipten birini seçti.
    await patch({ alertEmail: "owner@example.com" });
    const res = await verify(stale);
    expect(res.status).toBe(409);
    expect(await alertEmailOf(orgId)).toBe("owner@example.com");
  });

  it("🚨 bir işletmenin bağlantısı YALNIZ o işletmeyi değiştirir", async () => {
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    await patch({ alertEmail: OUTSIDE });
    await verify(tokenFromMail());
    expect(await alertEmailOf(other.id)).toBeNull();
  });

  it("değiştirilmiş / boş belirteç 400 ve hiçbir şey değişmez", async () => {
    await patch({ alertEmail: OUTSIDE });
    const token = tokenFromMail();
    expect((await verify(`${token}x`)).status).toBe(400);
    expect((await verify("")).status).toBe(400);
    expect((await verify(undefined)).status).toBe(400);
    expect(await alertEmailOf(orgId)).toBeNull();
  });

  it("onay ucu: bayrak KAPALIYSA 404; JSON olmayan istek IP kovasına DOKUNMADAN 415", async () => {
    await patch({ alertEmail: OUTSIDE });
    const token = tokenFromMail();
    const sent = await verify(token, "text/plain");
    expect(sent.status).toBe(415);
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: "alert-verify-ip:" } } })).toBe(0);
    vi.stubEnv("ALERT_EMAIL_VERIFY_ENABLED", "");
    expect((await verify(token)).status).toBe(404);
    expect(await alertEmailOf(orgId)).toBeNull();
  });

  it("🚨 günlük tavan: aynı ALICIYA 3'ten fazla doğrulama e-postası gitmez", async () => {
    for (let i = 0; i < 3; i++) expect((await patch({ alertEmail: OUTSIDE })).status).toBe(200);
    const res = await patch({ alertEmail: OUTSIDE });
    expect(res.status).toBe(429);
    expect(mockMail).toHaveBeenCalledTimes(3);
  });

  it("🚨 günlük tavan: bir işletme 5'ten fazla doğrulama e-postası isteyemez", async () => {
    for (let i = 0; i < 5; i++) expect((await patch({ alertEmail: `ops${i}@example.net` })).status).toBe(200);
    expect((await patch({ alertEmail: "ops9@example.net" })).status).toBe(429);
    expect(mockMail).toHaveBeenCalledTimes(5);
  });

  it("e-posta GİTMEZSE 503, adres kaydedilmez, 'gönderildi' kaydı yazılmaz", async () => {
    mockMail.mockResolvedValueOnce({ ok: false, error: "smtp" });
    const res = await patch({ alertEmail: OUTSIDE });
    expect(res.status).toBe(503);
    expect(await alertEmailOf(orgId)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "settings.alert_email_verification_sent" } })).toBe(0);
  });

  it("aynı istekte başka alan da varsa o alan kaydedilir, adres beklemede kalır", async () => {
    const res = await patch({ alertEmail: OUTSIDE, handoffHoldHours: 9 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handoffHoldHours: 9, alertEmailPending: true });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.handoffHoldHours).toBe(9);
    expect(org.alertEmail).toBeNull();
  });
});
