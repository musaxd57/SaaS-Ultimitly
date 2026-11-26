import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { EMAIL_VERIFY_REQUIRED_FROM } from "@/lib/auth/email-verify";
import { RESEND_VERIFY_RESPONSE_FLOOR_MS } from "@/lib/response-floor";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
import { reportError } from "@/lib/report-error";
import { POST } from "@/app/api/auth/resend-verification/route";

// ---------------------------------------------------------------------------
// Opus 11-05 (Tur 7 D'nin derin incelemesi): veritabanı zorlanınca (havuz dolu, işlem zaman aşımı) dalların hatası DURUM KODUNA sızmaz.
// Eskiden gönderim dalı kendi hatasını yutup 200 dönüyor, "hesap yok / doğrulanmış / sessiz pencere" dalının eşitleyici işlemi ise
// yutmuyordu → yalnız hesabı OLMAYAN adres 500 → hesap kâhini. Şimdi iki dal da aynı 200 + aynı taban; hata raporlanır.
// (Prisma istemcisine casus: sonraki dosyalara sızmasın diye AYRI dosya — CLAUDE.md dersi.)
// ---------------------------------------------------------------------------

const AFTER = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() + 86_400_000);
const req = (email: string) =>
  new NextRequest("http://localhost/api/auth/resend-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });

async function observe(email: string) {
  const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("Unable to start a transaction in the given time (test)"));
  const t0 = performance.now();
  try {
    const res = await POST(req(email));
    return {
      status: res.status,
      body: await res.text(),
      headers: [...res.headers.keys()].filter((k) => k !== "date").sort().join(","),
      ms: performance.now() - t0,
      txCalls: spy.mock.calls.length,
    };
  } finally {
    spy.mockRestore();
  }
}

describe("doğrulama e-postası yeniden isteme — veritabanı arızasında da dallar ayırt edilemez", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.mocked(reportError).mockClear();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 işlem açılamıyor: hesabı OLMAYAN adres ile gerçek doğrulanmamış hesap AYNI 200 / gövde / başlık, ikisi de tabanın üstünde; hata raporlanır", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await prisma.user.create({ data: { organizationId: org.id, name: "A", email: "real@x.com", passwordHash: "x", role: "owner", createdAt: AFTER } });

    const ghost = await observe("ghost@x.com");
    const real = await observe("real@x.com");
    // İki dal da arızalı işleme gerçekten ulaştı (casus boşa kurulmadı).
    expect(ghost.txCalls).toBe(1);
    expect(real.txCalls).toBe(1);
    for (const r of [ghost, real]) {
      expect(r.status).toBe(200);
      expect(r.body).toBe('{"ok":true}');
      expect(r.ms).toBeGreaterThanOrEqual(RESEND_VERIFY_RESPONSE_FLOOR_MS - 5);
    }
    expect(ghost.headers).toBe(real.headers);
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(2);
  }, 30_000);
});
