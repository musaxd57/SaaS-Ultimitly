// ---------------------------------------------------------------------------
// Codex 11-17 B2 sınıfı — devam ettirmede Paddle çağrısından hemen önceki yerel abonelik okuması DÜŞERSE kör devam yok: 503 (var olan metin),
// Paddle'a devam gitmez, kilit ve onay geri bırakılır; okuma düzelince aynı onay geçer.
// ⚠️ Prisma temsilcisine casus kurulur → AYRI dosya; casus bir kez kurulur, geri alınmaz (geri alınınca temsilci bozuk kalıyor), arıza bayrakla.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as preview } from "@/app/api/billing/resume-preview/route";
import { POST as resume } from "@/app/api/billing/resume/route";
import { RESUME_PENDING_LOCK, RESUME_TEXT } from "@/lib/billing/resume";

let resumeCalls = 0;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("devam ettirme: Paddle öncesi yerel okuma arızası", () => {
  let orgId: string;
  // `resolveResume` (1) geçer; Paddle öncesi yeniden okuma (2) düşer.
  const fault = { failReread: false, calls: 0 };
  beforeAll(() => {
    const realFind = prisma.subscription.findUnique.bind(prisma.subscription);
    vi.spyOn(prisma.subscription, "findUnique").mockImplementation(((args: Parameters<typeof realFind>[0]) => {
      fault.calls++;
      if (fault.failReread && fault.calls === 2) return Promise.reject(new Error("db down")) as never;
      return realFind(args) as never;
    }) as never);
  });
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    resumeCalls = 0;
    fault.failReread = false;
    vi.stubEnv("PADDLE_RESUME_ENABLED", "1");
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-0123456789-abcdefghijkl");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if ((init?.method ?? "GET") === "GET" && path === "/subscriptions/sub_1") {
          return json(200, { data: { status: "paused", customer_id: "ctm_1", currency_code: "TRY", items: [{ price: { id: "pri_pro" } }], recurring_transaction_details: { totals: { grand_total: "89900" } } } });
        }
        if (init?.method === "POST" && path === "/subscriptions/sub_1/resume") {
          resumeCalls++;
          return json(200, { data: { status: "active" } });
        }
        return json(404, { error: { code: "not_found" } });
      }),
    );
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    await prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status: "paused", provider: "paddle", providerRef: "sub_1", customerId: "ctm_1" } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 Paddle öncesi okuma düşerse → 503, devam GİTMEZ, kilit ve onay geri bırakılır; düzelince aynı onay geçer", async () => {
    const res = await preview(post("/api/billing/resume-preview"), ctx);
    expect(res.status).toBe(200);
    const t = ((await res.json()) as { previewToken: string }).previewToken;
    fault.calls = 0;
    fault.failReread = true;
    const r = await resume(post("/api/billing/resume", { previewToken: t }), ctx);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(RESUME_TEXT.failed);
    expect(resumeCalls).toBe(0);
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(0);
    fault.failReread = false;
    expect((await resume(post("/api/billing/resume", { previewToken: t }), ctx)).status).toBe(200);
    expect(resumeCalls).toBe(1);
  });
});
