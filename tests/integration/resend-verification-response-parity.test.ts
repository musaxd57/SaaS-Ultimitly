import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { EMAIL_VERIFY_REQUIRED_FROM, VERIFY_TTL_MS } from "@/lib/auth/email-verify";
import { RESEND_VERIFY_RESPONSE_FLOOR_MS } from "@/lib/response-floor";

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn(), enqueueIdentityEmail: vi.fn(actual.enqueueIdentityEmail) };
});
import { emailService } from "@/lib/email";
import { enqueueIdentityEmail } from "@/lib/email-outbox";
import { POST } from "@/app/api/auth/resend-verification/route";

// ---------------------------------------------------------------------------
// Tur 7 (Codex 11-05 gece; OWASP: genel yanıt + TUTARLI YANIT SÜRESİ) — doğrulama e-postasını yeniden isteme rotasında hesaba bağlı her
// dal dışarıdan AYNI görünür: durum, gövde, başlık kümesi ve süre (en kısa süre tabanı). Yedi dal: hesap yok · doğrulanmış / eski hesap ·
// son 10 dakikada bağlantı gitmiş · gönderim (kuyruklu) · günlük gönderim hakkı dolu · kuyruğa yazma hatası · sağlayıcı reddi (kuyruksuz).
// Süreler raporda (konsola yazılır); test eşikleri cömerttir (yavaş CI), asıl iddia "hepsi tabanın üstünde ve birbirine yakın".
// ---------------------------------------------------------------------------

const AFTER = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() + 86_400_000);
const BEFORE = new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() - 86_400_000);
const req = (email: string) =>
  new NextRequest("http://localhost/api/auth/resend-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });

type Path = { name: string; outbox: boolean; setup: (i: number) => Promise<string> };

async function user(email: string, data: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({ data: { name: "X" } });
  await prisma.user.create({ data: { organizationId: org.id, name: "A", email, passwordHash: "x", role: "owner", createdAt: AFTER, ...data } });
}

const PATHS: Path[] = [
  { name: "hesap yok", outbox: true, setup: async (i) => `ghost${i}@x.com` },
  { name: "doğrulanmış / eski hesap", outbox: true, setup: async (i) => (await user(`old${i}@x.com`, { createdAt: BEFORE }), `old${i}@x.com`) },
  {
    name: "son 10 dk bağlantı gitmiş",
    outbox: true,
    setup: async (i) => (await user(`quiet${i}@x.com`, { emailVerifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS - 60_000) }), `quiet${i}@x.com`),
  },
  { name: "gönderim (kuyruk)", outbox: true, setup: async (i) => (await user(`send${i}@x.com`), `send${i}@x.com`) },
  {
    name: "gönderim hakkı dolu",
    outbox: true,
    setup: async (i) => {
      await user(`full${i}@x.com`);
      await prisma.$executeRaw`INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${`verify-resend-day:full${i}@x.com`}, 6, (now() AT TIME ZONE 'utc') + interval '1 day')`;
      return `full${i}@x.com`;
    },
  },
  {
    name: "kuyruğa yazma hatası",
    outbox: true,
    setup: async (i) => (await user(`qfail${i}@x.com`), vi.mocked(enqueueIdentityEmail).mockRejectedValueOnce(new Error("db")), `qfail${i}@x.com`),
  },
  {
    name: "sağlayıcı reddi (kuyruksuz)",
    outbox: false,
    setup: async (i) => (await user(`pfail${i}@x.com`), vi.mocked(emailService.sendReporting).mockResolvedValueOnce({ ok: false, error: "x" }), `pfail${i}@x.com`),
  },
];

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe("doğrulama e-postası yeniden isteme — dallar dışarıdan ayırt edilemez", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 yedi dalda durum + gövde + başlık kümesi aynı; süre tabanın üstünde ve birbirine yakın", async () => {
    const N = 4;
    const report: Array<{ name: string; median: number; status: number; body: string; headers: string }> = [];
    for (const p of PATHS) {
      vi.stubEnv("EMAIL_OUTBOX_ENABLED", p.outbox ? "1" : "");
      const times: number[] = [];
      let last: { status: number; body: string; headers: string } | null = null;
      for (let i = 0; i < N; i++) {
        const email = await p.setup(i);
        await prisma.rateLimitCounter.deleteMany({ where: { NOT: { key: { startsWith: "verify-resend-day:" } } } });
        __resetRateLimit();
        const t0 = performance.now();
        const res = await POST(req(email));
        times.push(performance.now() - t0);
        last = { status: res.status, body: await res.text(), headers: [...res.headers.keys()].filter((k) => k !== "date").sort().join(",") };
      }
      report.push({ name: p.name, median: Math.round(median(times)), ...last! });
    }
    console.log("YANIT PARİTESİ\n" + report.map((r) => `  ${r.name}: ${r.status} ${r.body} [${r.headers}] medyan ${r.median} ms`).join("\n"));
    for (const r of report) {
      expect(r.status).toBe(200);
      expect(r.body).toBe(report[0].body);
      expect(r.headers).toBe(report[0].headers);
      expect(r.median).toBeGreaterThanOrEqual(RESEND_VERIFY_RESPONSE_FLOOR_MS - 5);
    }
    const ms = report.map((r) => r.median);
    expect(Math.max(...ms) - Math.min(...ms)).toBeLessThan(120);
  }, 60_000);

  it("🚨 adres başına istek sınırı (429) hesabın varlığından bağımsız: var olan hesap ile olmayan adres AYNI durum / gövde / başlık", async () => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    await user("real@x.com");
    const seen: Record<string, { status: number; body: string; headers: string; retryAfter: string | null }[]> = {};
    for (const email of ["real@x.com", "ghost@x.com"]) {
      seen[email] = [];
      for (let i = 0; i < 6; i++) {
        // IP kovası (15 dk'da 8) bu iddianın konusu değil: her istekten önce yalnız onu temizle.
        await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: "verify-resend:" } } });
        __resetRateLimit();
        const res = await POST(req(email));
        seen[email].push({
          status: res.status,
          body: await res.text(),
          headers: [...res.headers.keys()].filter((k) => k !== "date").sort().join(","),
          retryAfter: res.headers.get("retry-after"),
        });
      }
    }
    const shape = (rows: (typeof seen)[string]) => rows.map((r) => `${r.status} ${r.body} [${r.headers}] ${r.retryAfter ? "retry" : "-"}`);
    console.log("İSTEK SINIRI PARİTESİ\n  var: " + shape(seen["real@x.com"]).join(" | ") + "\n  yok: " + shape(seen["ghost@x.com"]).join(" | "));
    expect(seen["real@x.com"].map((r) => r.status)).toEqual([200, 200, 200, 200, 429, 429]);
    expect(shape(seen["ghost@x.com"])).toEqual(shape(seen["real@x.com"]));
  }, 60_000);
});
