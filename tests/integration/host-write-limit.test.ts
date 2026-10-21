import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/route-guard";
import { HOST_WRITE_LIMIT } from "@/lib/host-write-limit";
import { POST as guestChatReply } from "@/app/api/guest-chats/[id]/reply/route";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Ev sahibi yazma hız sınırı (altyapı envanteri 10-21 madde 75, kurucu "olur"): ortak kapıdan geçen her yazma kişi başına dakikada
// HOST_WRITE_LIMIT; okuma sayılmaz; kova kişiye bağlı; kapısız iki QR ev sahibi rotası da aynı kovayı kullanır. Gerçek PostgreSQL sayacı.
// ---------------------------------------------------------------------------

const s = (userId: string, extra: Partial<SessionPayload> = {}): SessionPayload => ({
  userId,
  organizationId: "org-x",
  role: "owner",
  email: `${userId}@x.test`,
  name: userId,
  sessionEpoch: 0,
  ...extra,
});
const handler = vi.fn(async () => new Response("ok"));
const route = withAuth(handler);
const call = (method: string) => route(new NextRequest("http://localhost/api/x", { method }), { params: Promise.resolve({}) });

describe("ev sahibi yazma hız sınırı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    handler.mockClear();
    session = s("u1");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(`dakikada ${HOST_WRITE_LIMIT} yazma geçer, fazlası 429 + Retry-After; işleyici çağrılmaz`, async () => {
    for (let i = 0; i < HOST_WRITE_LIMIT; i++) expect((await call("POST")).status).toBe(200);
    const res = await call("PATCH");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(handler).toHaveBeenCalledTimes(HOST_WRITE_LIMIT);
  });

  it("okuma (GET) sayılmaz ve kova doluyken de geçer", async () => {
    for (let i = 0; i < HOST_WRITE_LIMIT; i++) await call("DELETE");
    expect((await call("POST")).status).toBe(429);
    expect((await call("GET")).status).toBe(200);
  });

  it("kova kişiye bağlı: başka kullanıcı etkilenmez", async () => {
    for (let i = 0; i < HOST_WRITE_LIMIT + 1; i++) await call("POST");
    session = s("u2");
    expect((await call("POST")).status).toBe(200);
  });

  it("QR ev sahibi cevabı (ortak kapısız rota) aynı kovayı kullanır: doluyken 429, mesaj yazılmaz", async () => {
    for (let i = 0; i < HOST_WRITE_LIMIT; i++) await call("POST");
    const before = await prisma.message.count();
    const res = await guestChatReply(
      new NextRequest("http://localhost/api/guest-chats/c1/reply", {
        method: "POST",
        body: JSON.stringify({ body: "Merhaba" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(429);
    expect(await prisma.message.count()).toBe(before);
  });

  it("kontrol: sınır altında QR rotası kendi akışına girer (yok konuşma → 404, 429 değil)", async () => {
    const res = await guestChatReply(
      new NextRequest("http://localhost/api/guest-chats/c1/reply", {
        method: "POST",
        body: JSON.stringify({ body: "Merhaba" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(404);
  });
});
