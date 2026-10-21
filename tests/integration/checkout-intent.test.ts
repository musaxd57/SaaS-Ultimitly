import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖDEME NİYETİ (Codex 10-21 P1, migration 82; anahtar `PADDLE_CHECKOUT_INTENT_ENABLED`) — GERÇEK POSTGRESQL, Paddle istemcisi TAKLİT.
// Codex: "İki ödeme ekranından çift tahsilat riski — aynı işletmeden iki açılış isteği ikisi de 201 ve farklı onay kimliği aldı." Anahtar
// açıkken kanıtlananlar:
//  1. İki sekme AYNI ANDA aynı paket → iki onay (her kabul delildir) ama TEK Paddle işlemi; iki yanıt da AYNI işlem kimliğini taşır.
//  2. Farklı paket → eski ödenmemiş işlem iptal edilir, yenisi açılır; iptal edilemezse yeni ekran YOK ("açık bir ödemeniz var").
//  3. Açık işlem Paddle'da ödenmişse (webhook gelmedi) yeni ekran YOK ("işleniyor").
//  4. Paddle işlem açamazsa niyet "failed" olur, kilit kalkar → sonraki deneme yenisini açar (takılı kalmaz).
//  5. Webhook işlemi tamamlayınca niyet kapanır; süresi dolan açık niyet süpürgede iptal + kapanır.
//  6. KONTROL: anahtar KAPALIYKEN bugünkü yol AYNEN (işlem kimliği yok, Paddle çağrısı yok).
//  7. KİRACI: B işletmesinin onayı A'nın işlem kimliğini asla almaz.
// ---------------------------------------------------------------------------

const { paddle } = vi.hoisted(() => ({
  paddle: {
    created: 0,
    canceled: [] as string[],
    statuses: new Map<string, string>(),
    failCreate: false,
    failCancel: false,
    createDelayMs: 0,
  },
}));
vi.mock("@/lib/payments/paddle", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paddle")>();
  return {
    ...actual,
    paddleRequest: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "/transactions" && init?.method === "POST") {
        if (paddle.createDelayMs) await new Promise((r) => setTimeout(r, paddle.createDelayMs));
        if (paddle.failCreate) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=transactions");
        paddle.created += 1;
        const id = `txn_${paddle.created}`;
        paddle.statuses.set(id, "ready");
        return { data: { id, status: "ready" } };
      }
      const m = path.match(/^\/transactions\/(txn_\d+)$/);
      if (m && init?.method === "PATCH") {
        if (paddle.failCancel) throw new Error("Paddle HTTP 400 (transaction_immutable) env=sandbox resource=transactions");
        paddle.canceled.push(m[1]!);
        paddle.statuses.set(m[1]!, "canceled");
        return { data: { id: m[1], status: "canceled" } };
      }
      if (m) return { data: { id: m[1], status: paddle.statuses.get(m[1]!) ?? "ready" } };
      throw new Error(`beklenmeyen Paddle çağrısı ${path}`);
    }),
  };
});
const { sessionQueue } = vi.hoisted(() => ({ sessionQueue: [] as SessionPayload[] }));
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => sessionQueue.shift() ?? session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/billing/consent/route";
import { completeCheckoutIntent, sweepCheckoutIntents, CHECKOUT_INTENT_TTL_MS } from "@/lib/billing/checkout-intent";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
const postReq = (priceId = "pri_pro", planCode = "pro") =>
  new NextRequest("http://localhost/api/billing/consent", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0" },
    body: JSON.stringify({ planCode, priceId }),
  });
type Body = { consentId?: string; transactionId?: string; error?: string; fields?: Record<string, string> };

describe("ödeme niyeti — işletme başına tek açık Paddle işlemi", () => {
  let orgId = "";

  async function owner(name: string) {
    const org = (await prisma.organization.create({ data: { name } })).id;
    const user = (await prisma.user.create({ data: { organizationId: org, name, email: `${name}@x.com`, passwordHash: "x", role: "owner" } })).id;
    return { org, s: { userId: user, organizationId: org, role: "owner", email: `${name}@x.com`, name, sessionEpoch: 0 } as SessionPayload };
  }

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    sessionQueue.length = 0;
    Object.assign(paddle, { created: 0, canceled: [], failCreate: false, failCancel: false, createDelayMs: 0 });
    paddle.statuses.clear();
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    vi.stubEnv("PADDLE_CHECKOUT_INTENT_ENABLED", "1");
    const o = await owner("a");
    orgId = o.org;
    session = o.s;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 iki sekme AYNI ANDA aynı paket → iki onay ama TEK Paddle işlemi; iki yanıt da aynı işlem kimliği", async () => {
    paddle.createDelayMs = 150; // birinci Paddle'ı beklerken ikincisi gelir
    const [r1, r2] = await Promise.all([POST(postReq(), ctx), POST(postReq(), ctx)]);
    const bodies = [(await r1.json()) as Body, (await r2.json()) as Body];
    expect(paddle.created).toBe(1);
    // Biri işlemi açar; öteki ya aynı işlemi alır ya da "hazırlanıyor" (409) der — İKİNCİ işlem asla açılmaz.
    const opened = bodies.filter((b) => b.transactionId);
    expect(opened.length).toBeGreaterThanOrEqual(1);
    expect(new Set(opened.map((b) => b.transactionId))).toEqual(new Set(["txn_1"]));
    // Hazırlık bitince tekrar deneyen sekme AYNI işlemi alır.
    const again = (await (await POST(postReq(), ctx)).json()) as Body;
    expect(again.transactionId).toBe("txn_1");
    expect(paddle.created).toBe(1);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(3);
    expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId, openKey: { not: null } } })).toBe(1);
  }, 15_000);

  it("farklı paket → eski ödenmemiş işlem iptal edilir, yenisi açılır", async () => {
    const first = (await (await POST(postReq(), ctx)).json()) as Body;
    const second = (await (await POST(postReq("pri_isletme", "isletme"), ctx)).json()) as Body;
    expect(first.transactionId).toBe("txn_1");
    expect(second.transactionId).toBe("txn_2");
    expect(paddle.canceled).toEqual(["txn_1"]);
    const intents = await prisma.checkoutIntent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
    expect(intents.map((i) => [i.status, i.openKey === null])).toEqual([
      ["canceled", true],
      ["open", false],
    ]);
  });

  it("🚨 farklı paket ama eski işlem iptal EDİLEMİYOR (ödeme başlamış olabilir) → yeni ekran YOK", async () => {
    await POST(postReq(), ctx);
    paddle.failCancel = true;
    const res = await POST(postReq("pri_isletme", "isletme"), ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Body).error).toMatch(/Açık bir ödemeniz var/);
    expect(paddle.created).toBe(1);
  });

  it("🚨 açık işlem Paddle'da ÖDENMİŞ (webhook gelmedi) → yeni ekran YOK, 'işleniyor'; niyet tamamlandı", async () => {
    await POST(postReq(), ctx);
    paddle.statuses.set("txn_1", "completed");
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/işleniyor/i);
    expect(paddle.created).toBe(1);
    expect((await prisma.checkoutIntent.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("completed");
  });

  it("Paddle işlem açamazsa → 503, niyet 'failed' ve kilit kalkar; sonraki deneme yenisini açar", async () => {
    paddle.failCreate = true;
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(503);
    expect(await prisma.checkoutIntent.count({ where: { openKey: { not: null } } })).toBe(0);
    paddle.failCreate = false;
    expect(((await (await POST(postReq(), ctx)).json()) as Body).transactionId).toBe("txn_1");
  });

  it("webhook işlemi tamamlayınca niyet kapanır; sonraki onay YENİ işlem açar", async () => {
    await POST(postReq(), ctx);
    await completeCheckoutIntent("txn_1");
    expect((await prisma.checkoutIntent.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("completed");
    // (Gerçekte canlı abonelik / işleniyor kilidi ikinci ödemeyi zaten engeller; burada yalnız niyetin kapandığı sınanır.)
    expect(((await (await POST(postReq(), ctx)).json()) as Body).transactionId).toBe("txn_2");
  });

  it("süresi dolan açık niyet süpürgede iptal edilir ve kapanır; 90 günden eski kapalı niyet silinir", async () => {
    await POST(postReq(), ctx);
    const later = new Date(Date.now() + CHECKOUT_INTENT_TTL_MS + 60_000);
    await sweepCheckoutIntents(later);
    expect(paddle.canceled).toEqual(["txn_1"]);
    const intent = await prisma.checkoutIntent.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(intent).toMatchObject({ status: "expired", openKey: null });
    await sweepCheckoutIntents(new Date(later.getTime() + 91 * 86_400_000));
    expect(await prisma.checkoutIntent.count()).toBe(0);
  });

  it("🚨 KİRACI: B işletmesinin onayı A'nın işlem kimliğini ALMAZ (anahtar işletme)", async () => {
    const b = await owner("b");
    const ra = (await (await POST(postReq(), ctx)).json()) as Body;
    sessionQueue.push(b.s);
    const rb = (await (await POST(postReq(), ctx)).json()) as Body;
    expect(ra.transactionId).toBe("txn_1");
    expect(rb.transactionId).toBe("txn_2");
  });

  it("KONTROL: anahtar KAPALI → bugünkü yol aynen (işlem kimliği yok, Paddle çağrısı yok, niyet yok)", async () => {
    vi.stubEnv("PADDLE_CHECKOUT_INTENT_ENABLED", "");
    const res = await POST(postReq(), ctx);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Body;
    expect(body.consentId).toBeTruthy();
    expect(body.transactionId).toBeUndefined();
    expect(paddle.created).toBe(0);
    expect(await prisma.checkoutIntent.count()).toBe(0);
  });
});
