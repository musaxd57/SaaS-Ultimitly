import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// OPERATÖR UÇLARINDA HIZ SINIRI (Haiku operatör denetimi 10-10): ele geçirilmiş bir operatör oturumu döngüyle bütün hesapların 2FA'sını
// sıfırlayamasın, ücretli kalite denetimi bütçesini tüketemesin, işletme dökümünü sınırsız çekemesin. Sınır operatör kimliğine bağlı;
// meşru kullanımda ulaşılmaz. Gerçek PostgreSQL (hız sınırı sayacı veritabanında).
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as reset2fa } from "@/app/api/admin/reset-2fa/route";
import { POST as qualityAudit } from "@/app/api/admin/quality-audit/route";
import { GET as exportGet } from "@/app/api/admin/export/route";

const OPERATOR = "operator@lixusai.com";
const json = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function operator(email = OPERATOR) {
  const org = await prisma.organization.create({ data: { name: `Op ${email}` } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Op", email, passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: org.id, role: "owner", email, name: "Op", sessionEpoch: 0, mfa: true };
}

describe("operatör uçlarında hız sınırı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("SUPERADMIN_EMAILS", `${OPERATOR},operator2@lixusai.com`);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 2FA sıfırlama: saatte 10 deneme; 11.si 429 (kullanıcı yokken de sayılır); başka operatörün kovası ayrı", async () => {
    await operator();
    for (let i = 0; i < 10; i++) expect((await reset2fa(json("http://localhost/api/admin/reset-2fa", { email: `yok${i}@x.com` }))).status).not.toBe(429);
    expect((await reset2fa(json("http://localhost/api/admin/reset-2fa", { email: "yok@x.com" }))).status).toBe(429);
    await operator("operator2@lixusai.com");
    expect((await reset2fa(json("http://localhost/api/admin/reset-2fa", { email: "yok@x.com" }))).status).not.toBe(429);
  });

  it("🚨 kalite denetimi: saatte 20 deneme; 21.si 429 (yapılandırma eksikken de sayılır)", async () => {
    await operator();
    for (let i = 0; i < 20; i++) expect((await qualityAudit(json("http://localhost/api/admin/quality-audit", {}))).status).toBe(400);
    expect((await qualityAudit(json("http://localhost/api/admin/quality-audit", {}))).status).toBe(429);
  });

  it("🚨 dışa aktarma: saatte 20 deneme; 21.si 429", async () => {
    await operator();
    const get = () => exportGet(new NextRequest("http://localhost/api/admin/export", { headers: { "sec-fetch-site": "same-origin" } }));
    for (let i = 0; i < 20; i++) expect((await get()).status).toBe(400);
    expect((await get()).status).toBe(429);
  });

  it("KONTROL: operatör olmayan oturum hız sınırına girmeden 401 alır (kova tüketilmez)", async () => {
    session = { userId: "u", organizationId: "o", role: "owner", email: "musteri@x.com", name: "M", sessionEpoch: 0, mfa: true };
    for (let i = 0; i < 12; i++) expect((await reset2fa(json("http://localhost/api/admin/reset-2fa", { email: "a@x.com" }))).status).toBe(401);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  });
});
