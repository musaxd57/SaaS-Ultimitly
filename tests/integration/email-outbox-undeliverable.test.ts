import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// E-POSTA KUYRUĞU — "ALICI E-POSTA ALAMAZ" KALICIDIR (G2 tur 3 T3-B11, 11-19 gece).
// `email-core.ts` `.invalid` alıcıyı sağlayıcıya GİTMEDEN `{ ok:false, undeliverable:true }` döner ("kalıcıdır, yeniden denenmez").
// Kuyruk işçisi bu alanı okumuyordu: sıradan geçici hata sayıp ~81 dk boyunca 5 kez geri çekilmeyle yeniden deniyor, sonunda
// `failed` + operatör alarmı (`email-outbox.terminal`) üretiyordu. Kayıt formu `.invalid` alan adını kabul ettiği için KİMLİKSİZ biri bu
// alarmı tetikleyebiliyordu. Düzeltme: sonuç kalıcı → ilk denemede kapanır (`canceled`, neden `lastError`da), alarm YOK.
// Sabitlenen: kayıt yolu uçtan uca · doğrudan sonuç · KONTROL: sıradan geçici hata yine geri çekilmeyle yeniden denenir (aşırı uygulama yok).
// ---------------------------------------------------------------------------

const reported: string[] = [];
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async (context: string) => {
      reported.push(context);
      return { notified: false, throttled: false, configured: false };
    }),
  };
});

import { POST as registerPost } from "@/app/api/auth/register/route";
import { drainEmailOutboxOnce, enqueueIdentityEmail, EMAIL_OUTBOX_MAX_ATTEMPTS } from "@/lib/email-outbox";
import { __resetRateLimit } from "@/lib/rate-limit";

type SendFn = (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string; undeliverable?: true }>;

const registerReq = (email: string) =>
  new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ organizationName: "Lale Evleri", name: "Ada", email, password: "cok-gizli-parola-123", consent: true }),
  });

async function enqueueFor(email: string) {
  const org = await prisma.organization.create({ data: { name: "Lale Evleri" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Ada", email, passwordHash: "x", role: "owner" } });
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const id = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { pwChangeCodeHash: "hash-of-12345678", pwChangeCodeExpiresAt: expiresAt, pwChangeCodeAttempts: 0 },
    });
    return enqueueIdentityEmail(tx, { userId: user.id, kind: "pw_change_code", secret: "12345678", recipient: email, expiresAt });
  });
  return id;
}

const terminalAlarms = () => reported.filter((c) => c.startsWith("email-outbox.terminal"));

describe("e-posta kuyruğu — alıcı e-posta alamaz sonucu kalıcıdır", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.length = 0;
    vi.stubEnv("REGISTRATION_OPEN", "1");
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("🚨 '.invalid' adresle kayıt: doğrulama satırı ilk denemede kapanır, sağlayıcıya gidilmez, operatör alarmı YOK", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await registerPost(registerReq("kurban@ornek.invalid"));
    expect(res.status).toBe(201);
    // Kayıt yolu arka planda bir boşaltma başlatır; ardından zamanın geçtiği taklit edilerek kuyruk en çok MAX+1 kez boşaltılır.
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < EMAIL_OUTBOX_MAX_ATTEMPTS + 1; i++) {
      await prisma.emailOutbox.updateMany({ where: { status: "pending" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await drainEmailOutboxOnce();
    }
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { kind: "verify_email" } });
    expect(row).toMatchObject({ status: "canceled", attemptCount: 1, payloadEnc: null, lastError: "Alıcı adresi e-posta alamaz." });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(terminalAlarms()).toEqual([]);
  });

  it("🚨 doğrudan: gönderici 'undeliverable' derse tek deneme, satır canceled, yeniden deneme vadesi yok, alarm yok", async () => {
    const id = await enqueueFor("ada@ornek.com");
    const send = vi.fn<SendFn>(async () => ({ ok: false, error: "Alıcı adresi e-posta alamaz.", undeliverable: true }));
    const out = await drainEmailOutboxOnce({ send });
    expect(out).toMatchObject({ claimed: 1, sent: 0, retried: 0, failed: 0, canceled: 1 });
    // Bir sonraki tur satırı yeniden almaz.
    await prisma.emailOutbox.updateMany({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.emailOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "canceled", attemptCount: 1 });
    expect(terminalAlarms()).toEqual([]);
  });

  it("KONTROL (aşırı uygulama yok): sıradan geçici hata yine geri çekilmeyle yeniden denenir", async () => {
    const id = await enqueueFor("ada@ornek.com");
    const send = vi.fn<SendFn>(async () => ({ ok: false, error: "HTTP 500" }));
    const out = await drainEmailOutboxOnce({ send });
    expect(out).toMatchObject({ claimed: 1, retried: 1, canceled: 0, failed: 0 });
    const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "pending", attemptCount: 1, lastError: "HTTP 500" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(terminalAlarms()).toEqual([]);
  });
});
