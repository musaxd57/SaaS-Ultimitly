import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// ŞİFRE SIFIRLAMA İSTEĞİ — KUYRUK ARIZASINDA DA DALLAR AYIRT EDİLEMEZ (Codex 11-25, kurucu talimatı 2026-11-25).
// Eskiden kayıtlı hesapta sıfırlama kaydı (`PasswordResetChallenge`) ve e-posta kuyruğu (`EmailOutbox`) AYRI işlemlerde yazılıyordu:
// kuyruk yazımı düşünce kayıtlı adres 500 alıyor (kayıtsız adres 200 → hesap kâhini) ve e-postası hiç kuyruğa girmemiş bir kayıt
// kalıyordu. Şimdi iki yazım TEK işlemde; işlem düşerse iki dal da aynı 200 / gövde / başlık, hata operatöre raporlanır. Kayıtsız dalın
// eşitleyici yazımı düşerse de aynı 200 (ters yönlü kâhin açılmasın — `resend-verification-fault-parity` emsali).
// (Prisma istemcisine casus: sonraki dosyalara sızmasın diye AYRI dosya — CLAUDE.md dersi.)
// ---------------------------------------------------------------------------

const { enqueueFault } = vi.hoisted(() => ({ enqueueFault: { on: false } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ reported: true })) }));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return {
    ...actual,
    kickEmailOutboxDrain: vi.fn(),
    enqueueIdentityEmail: vi.fn(async (...args: Parameters<typeof actual.enqueueIdentityEmail>) => {
      if (enqueueFault.on) throw new Error("outbox write failed (test)");
      return actual.enqueueIdentityEmail(...args);
    }),
  };
});
import { reportError } from "@/lib/report-error";
import { POST } from "@/app/api/account/forgot-password/route";

const REAL = "host@example.com";
const GHOST = "ghost@example.com";
let ipSeq = 0;
const req = (email: string) =>
  new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `9.8.7.${++ipSeq}` },
    body: JSON.stringify({ action: "request", email }),
  });

async function observe(email: string) {
  const res = await POST(req(email));
  return {
    status: res.status,
    body: await res.text(),
    headers: [...res.headers.keys()].filter((k) => k !== "date").sort().join(","),
  };
}

describe("şifre sıfırlama isteği — yazım arızasında da dallar ayırt edilemez", () => {
  let userId: string;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    enqueueFault.on = false;
    vi.mocked(reportError).mockClear();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    userId = (await prisma.user.create({ data: { organizationId: org.id, name: "Host", email: REAL, passwordHash: "old", role: "owner" } })).id;
  });
  afterEach(() => {
    enqueueFault.on = false;
  });

  it("🚨 kuyruk yazımı düşüyor: kayıtlı ve kayıtsız adres AYNI 200 / gövde / başlık; e-postası kuyruğa girmemiş sıfırlama kaydı KALMAZ; hata raporlanır", async () => {
    enqueueFault.on = true;
    const ghost = await observe(GHOST);
    const real = await observe(REAL);
    expect(real).toEqual(ghost);
    expect(real.status).toBe(200);
    expect(real.body).toBe('{"ok":true}');
    // İki yazım tek işlemde: kuyruk düşünce sıfırlama kaydı da geri alındı.
    expect(await prisma.passwordResetChallenge.count({ where: { userId } })).toBe(0);
    expect(await prisma.emailOutbox.count({ where: { userId } })).toBe(0);
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]![0]).toBe("auth.forgot_password.enqueue");
  }, 30_000);

  it("KONTROL (aşırı uygulama yok): arıza yokken kayıtlı adreste kayıt + kuyruk satırı BİRLİKTE yazılır, rapor yok", async () => {
    const real = await observe(REAL);
    expect(real.status).toBe(200);
    expect(await prisma.passwordResetChallenge.count({ where: { userId } })).toBe(1);
    expect(await prisma.emailOutbox.count({ where: { userId, kind: "pw_reset_challenge" } })).toBe(1);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  }, 30_000);

  it("🚨 kayıtsız dalın eşitleyici yazımı düşüyor → yine aynı 200 (ters yönlü kâhin yok); hata raporlanır", async () => {
    const real = await observe(REAL);
    const spy = vi.spyOn(prisma.user, "updateMany").mockRejectedValueOnce(new Error("pool timeout (test)"));
    try {
      const ghost = await observe(GHOST);
      expect(spy).toHaveBeenCalledTimes(1); // casus boşa kurulmadı: kayıtsız dal gerçekten o yazıma ulaştı
      expect(ghost).toEqual(real);
    } finally {
      spy.mockRestore();
    }
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]![0]).toBe("auth.forgot_password.parity");
  }, 30_000);
});
