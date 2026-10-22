import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { reportError } from "@/lib/report-error";
import {
  enqueueIdentityEmail,
  drainEmailOutboxOnce,
  registrationEmailHourlyPace,
  REGISTRATION_EMAIL_HOURLY_PACE_DEFAULT,
} from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// U15 (kurucu 10-22: "Ya gerçekten 300 kişi kayıt olursa onu doğru şekilde çözelim") — kayıt e-postası YAYMA. Son bir saatte tavan dolunca
// doğrulama / "hesabınız var" e-postaları REDDEDİLMEZ ve İPTAL EDİLMEZ: bekler, pencere açılınca gider. Şifre e-postaları sıraya girmez.
// Yayma başlayınca TEK uyarı (geçiş tabanlı), bitince kapanır.
// ---------------------------------------------------------------------------

type SendFn = (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
const okSend = () => vi.fn<SendFn>(async () => ({ ok: true }));
const paceAlerts = () => vi.mocked(reportError).mock.calls.filter(([ctx]) => ctx === "Kayıt e-postaları yavaşlatıldı");

async function makeUser(email: string) {
  const org = await prisma.organization.create({ data: { name: "Pace Org" } });
  return prisma.user.create({ data: { organizationId: org.id, name: "Umut", email, passwordHash: "x", role: "owner" } });
}

async function enqueueVerify(userId: string, email: string) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { emailVerifyTokenHash: `h-${email}`, emailVerifyExpiresAt: expiresAt } });
    await enqueueIdentityEmail(tx, { userId, kind: "verify_email", secret: "tok", recipient: email, expiresAt });
  });
}

async function enqueueChange(userId: string, email: string) {
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { pwChangeCodeHash: "h", pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 } });
    await enqueueIdentityEmail(tx, { userId, kind: "pw_change_code", secret: "12345678", recipient: email, expiresAt });
  });
}

/** Son bir saatte `n` adet gönderilmiş kayıt e-postası (tarihçe satırı — gövde yok). */
async function seedSentRegistrationMails(userId: string, n: number, sentAgoMs = 10 * 60_000) {
  const sentAt = new Date(Date.now() - sentAgoMs);
  await prisma.emailOutbox.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      userId,
      kind: i % 2 ? "account_exists" : "verify_email",
      version: 1000 + i,
      payloadEnc: null,
      status: "sent",
      sentAt,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
}

describe("email-outbox — kayıt e-postası yayma (U15)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    vi.stubEnv("REGISTRATION_EMAIL_HOURLY_PACE", "5");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("tavan ayarı: geçerli tam sayı okunur, bozuk değer varsayılana düşer", () => {
    expect(registrationEmailHourlyPace()).toBe(5);
    for (const bad of ["0", "-3", "abc", "1e3", " "]) {
      vi.stubEnv("REGISTRATION_EMAIL_HOURLY_PACE", bad);
      expect(registrationEmailHourlyPace()).toBe(REGISTRATION_EMAIL_HOURLY_PACE_DEFAULT);
    }
  });

  it("tavan ALTINDA: doğrulama e-postası hemen gider, uyarı yok", async () => {
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 4);
    const u = await makeUser("u@x.com");
    await enqueueVerify(u.id, u.email);
    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(out.sent).toBe(1);
    expect(paceAlerts()).toHaveLength(0);
  });

  it("tavan DOLU: doğrulama e-postası ALINMAZ ama İPTAL de edilmez (bekler); şifre e-postası aynen gider; TEK uyarı", async () => {
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 5);
    const a = await makeUser("a@x.com");
    const b = await makeUser("b@x.com");
    await enqueueVerify(a.id, a.email);
    await enqueueChange(b.id, b.email);

    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(out.sent).toBe(1);
    expect(send.mock.calls.map((c) => c[0])).toEqual(["b@x.com"]);
    const waiting = await prisma.emailOutbox.findFirstOrThrow({ where: { userId: a.id, kind: "verify_email" } });
    expect(waiting.status).toBe("pending");
    expect(waiting.payloadEnc).not.toBeNull();
    expect(paceAlerts()).toHaveLength(1);

    // İkinci tur hâlâ tavanda: uyarı TEKRARLANMAZ (geçiş tabanlı).
    await drainEmailOutboxOnce({ send: okSend() });
    expect(paceAlerts()).toHaveLength(1);
  });

  it("pencere açılınca bekleyen doğrulama e-postası gider ve uyarı durumu kapanır", async () => {
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 5);
    const a = await makeUser("a@x.com");
    await enqueueVerify(a.id, a.email);
    await drainEmailOutboxOnce({ send: okSend() });
    expect((await prisma.emailOutbox.findFirstOrThrow({ where: { userId: a.id } })).status).toBe("pending");

    // Tarihçe bir saatten eskiye kayar → pencere boşaldı.
    await prisma.emailOutbox.updateMany({
      where: { userId: hist.id },
      data: { sentAt: new Date(Date.now() - 61 * 60_000) },
    });
    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(out.sent).toBe(1);
    expect(send.mock.calls[0][0]).toBe("a@x.com");
    expect(await prisma.systemLock.count({ where: { name: { contains: "registration-pace" } } })).toBe(0);
  });

  it("gönderimde olan (claimed / sending) kayıt e-postası da sayılır", async () => {
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 4);
    await prisma.emailOutbox.create({
      data: {
        id: randomUUID(),
        userId: hist.id,
        kind: "verify_email",
        version: 5000,
        status: "sending",
        expiresAt: new Date(Date.now() + 60_000),
        claimExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const a = await makeUser("a@x.com");
    await enqueueVerify(a.id, a.email);
    const send = okSend();
    await drainEmailOutboxOnce({ send });
    expect(send).not.toHaveBeenCalled();
  });

  it("parti içinde şifre e-postası birikmiş kayıt e-postalarından ÖNCE alınır (tavan dolu değilken de)", async () => {
    vi.stubEnv("REGISTRATION_EMAIL_HOURLY_PACE", "300");
    const a = await makeUser("a@x.com");
    const b = await makeUser("b@x.com");
    await enqueueVerify(a.id, a.email); // daha eski
    await enqueueChange(b.id, b.email); // daha yeni
    const send = okSend();
    await drainEmailOutboxOnce({ send, batchSize: 1 });
    expect(send.mock.calls.map((c) => c[0])).toEqual(["b@x.com"]);
  });

  it("uyarı histerezisi: tavanın hemen altına inince açık kalır, %80'in altında kapanır (tekrarlı uyarı yok)", async () => {
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 5);
    const a = await makeUser("a@x.com");
    await enqueueVerify(a.id, a.email);
    await drainEmailOutboxOnce({ send: okSend() });
    expect(paceAlerts()).toHaveLength(1);
    const state = () => prisma.systemLock.count({ where: { name: { contains: "registration-pace" } } });
    expect(await state()).toBe(1);
    // Bir tarihçe satırı pencereden çıkar → 4/5 (≥ %80): kayıt e-postası gider ama durum KAPANMAZ.
    const one = await prisma.emailOutbox.findFirstOrThrow({ where: { userId: hist.id } });
    await prisma.emailOutbox.update({ where: { id: one.id }, data: { sentAt: new Date(Date.now() - 61 * 60_000) } });
    const b = await makeUser("b@x.com");
    await enqueueVerify(b.id, b.email);
    await drainEmailOutboxOnce({ send: okSend() });
    expect(await state()).toBe(1);
    // Hepsi pencereden çıkar → kapanır; yeni bir tavan aşımı yeniden TEK uyarı üretir.
    await prisma.emailOutbox.updateMany({ data: { sentAt: new Date(Date.now() - 61 * 60_000) } });
    const c = await makeUser("c@x.com");
    await enqueueVerify(c.id, c.email);
    await drainEmailOutboxOnce({ send: okSend() });
    expect(await state()).toBe(0);
    expect(paceAlerts()).toHaveLength(1);
  });

  it("tavan 1 iken de uyarı pencere boşalınca kapanır (%80 eşiği en az 1 — Opus 10-22 F7)", async () => {
    vi.stubEnv("REGISTRATION_EMAIL_HOURLY_PACE", "1");
    const hist = await makeUser("hist@x.com");
    await seedSentRegistrationMails(hist.id, 1);
    const a = await makeUser("a@x.com");
    await enqueueVerify(a.id, a.email);
    await drainEmailOutboxOnce({ send: okSend() });
    const state = () => prisma.systemLock.count({ where: { name: { contains: "registration-pace" } } });
    expect(await state()).toBe(1);
    await prisma.emailOutbox.updateMany({ where: { userId: hist.id }, data: { sentAt: new Date(Date.now() - 61 * 60_000) } });
    await drainEmailOutboxOnce({ send: okSend() });
    expect(await state()).toBe(0);
  });
});
