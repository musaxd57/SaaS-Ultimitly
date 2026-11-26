import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ELLE MESAJ HIZLI UYANDIRMA (kurucu 10-16: "kalıcı kuyruk korunsun, gönderim işi hızlı uyandırılsın; iki dakika beklemek varsayılan
// olmasın; mevcut yapıda uygulanabilir çözümü ölç"). Kuyruğa yazan istek commit olunca aynı süreçte boşaltma turu başlar; 2 dk'lık senkron
// yedek yoldur. Gerçek yol: rota → host-send → kuyruk satırı → uyandırma → işçi → kanal katmanı (sağlayıcı çağrısı taklit).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));
vi.mock("@/lib/channels", async (orig) => {
  const actual = await orig<typeof import("@/lib/channels")>();
  return {
    ...actual,
    dispatchOutbound: dispatchMock,
    resolveOrgChannelCredential: vi.fn(async () => ({ provider: "hospitable", token: "tok" })),
  };
});

import { POST } from "@/app/api/conversations/[id]/reply/route";
import { POST as RETRY } from "@/app/api/outbox/[id]/retry/route";
import { __resetOutboxKick, __setOutboxKickFollowUpMs, outboxFastWakeEnabled } from "@/lib/outbox/worker";

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 5000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
}

describe("elle mesaj — kuyruk hızlı uyandırma", () => {
  let conversationId = "";
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    __resetOutboxKick();
    dispatchMock.mockReset();
    dispatchMock.mockImplementation(async () => ({ ok: true, providerMessageId: `p-${Math.random()}` }));
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    vi.stubEnv("OUTBOX_FAST_WAKE", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: "s@example.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: user.name, sessionEpoch: user.sessionEpoch } as SessionPayload;
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 1" } });
    const conv = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Misafir", channel: "airbnb", externalReservationId: "res-fw", status: "waiting" },
    });
    conversationId = conv.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kuyruğa yazılan elle mesaj 2 dk'lık senkronu BEKLEMEZ — aynı süreçte gönderilir; ölçüm: 20 farklı misafire kuyruk → gönderim gecikmesi", async () => {
    const property = await prisma.property.findFirstOrThrow();
    const convIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const c = await prisma.conversation.create({
        data: { propertyId: property.id, guestIdentifier: `Misafir ${i}`, channel: "airbnb", externalReservationId: `res-${i}`, status: "waiting" },
      });
      convIds.push(c.id);
    }
    const latencies: number[] = [];
    for (let i = 0; i < convIds.length; i++) {
      const res = await POST(req(convIds[i], { body: `Mesaj ${i}` }), { params: Promise.resolve({ id: convIds[i] }) });
      expect(res.status).toBe(202); // "sıraya alındı" ≠ gönderildi
      latencies.push(await waitUntil(async () => (await prisma.messageOutbox.count({ where: { status: "sent" } })) === i + 1));
    }
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    console.log(`[ölçüm] elle mesaj kuyruk→gönderim gecikmesi (yerel PG, sağlayıcı taklit, 20 farklı misafir) p50=${p50}ms p95=${p95}ms max=${latencies.at(-1)}ms`);
    expect(p95).toBeLessThan(3000); // ⬅️ ESKİDE 2 dk'lık senkron (bu testte hiç gönderilmezdi)
    expect(dispatchMock).toHaveBeenCalledTimes(20); // her mesaj TEK kez
  }, 60_000);

  it("aynı misafire bir dakikada ÜÇÜNCÜ mesaj: sağlayıcı sınırı (60 sn'de 2) korunur; sınır kalkınca takip turu gönderir (senkronu beklemez)", async () => {
    __setOutboxKickFollowUpMs(150);
    for (const body of ["Bir", "İki", "Üç"]) {
      expect((await POST(req(conversationId, { body }), { params: Promise.resolve({ id: conversationId }) })).status).toBe(202);
    }
    await waitUntil(async () => (await prisma.messageOutbox.count({ where: { status: "sent" } })) === 2);
    // En az bir takip turunun sınıra takıldığını görecek kadar bekle (150 ms); boş takip zinciri ~4 turda (≈600 ms+) biter — Opus N6:
    // 400 ms beklemek yavaş CI'da zinciri kaçırabiliyordu, pay bırakıldı.
    await new Promise((r) => setTimeout(r, 200));
    expect(dispatchMock).toHaveBeenCalledTimes(2); // üçüncüsü sınırda bekliyor (Hospitable kuralı)
    // 60 sn geçmiş gibi: ilk iki gönderimin zamanı geri alınır → sınır kalkar; takip turu üçüncüyü gönderir.
    await prisma.messageOutbox.updateMany({ where: { status: "sent" }, data: { claimedAt: new Date(Date.now() - 61_000) } });
    await waitUntil(async () => (await prisma.messageOutbox.count({ where: { status: "sent" } })) === 3, 3000);
    expect(dispatchMock.mock.calls.map((c) => c[1])).toEqual(["Bir", "İki", "Üç"]);
  }, 30_000);

  it("🚨 hızlı uyandırma VARSAYILAN AÇIK (kurucu: 'iki dakika beklemek varsayılan olmasın'); yalnız tam '0' kapatır (yaşayan mutant K2)", () => {
    const prev = process.env.OUTBOX_FAST_WAKE;
    try {
      delete process.env.OUTBOX_FAST_WAKE;
      expect(outboxFastWakeEnabled()).toBe(true);
      process.env.OUTBOX_FAST_WAKE = "";
      expect(outboxFastWakeEnabled()).toBe(true);
      process.env.OUTBOX_FAST_WAKE = "0";
      expect(outboxFastWakeEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OUTBOX_FAST_WAKE;
      else process.env.OUTBOX_FAST_WAKE = prev;
    }
  });

  it("ev sahibinin 'yeniden dene'si (gönderilemedi satırı) da senkronu beklemez — aynı süreçte TEK kez gider (Opus N7)", async () => {
    const row = await prisma.messageOutbox.create({
      data: {
        organizationId: session.organizationId,
        conversationId,
        channel: "airbnb",
        externalReservationId: "res-fw",
        body: "Tekrar deneme",
        idempotencyKey: "retry-1",
        status: "failed",
        messageType: "manual",
        lastErrorKind: "definitive_failure",
        lastErrorCode: "HTTP 400",
        availableAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await RETRY(new NextRequest(`http://localhost/api/outbox/${row.id}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);
    await waitUntil(async () => (await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status === "sent"); // ⬅️ uyandırmasız: pending kalır
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("anahtar KAPALIYSA (OUTBOX_FAST_WAKE=0) uyandırma yok — satır senkronu bekler (kaçış yolu)", async () => {
    vi.stubEnv("OUTBOX_FAST_WAKE", "0");
    const res = await POST(req(conversationId, { body: "Bekleyen" }), { params: Promise.resolve({ id: conversationId }) });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(dispatchMock).not.toHaveBeenCalled();
    expect((await prisma.messageOutbox.findFirstOrThrow()).status).toBe("pending");
  });

  it("çift tık (aynı istek kimliği) tek satır, tek gönderim; arka arkaya iki farklı mesaj sırayla ve TEK'er kez gider", async () => {
    const rid = "11111111-2222-4333-8444-555555555555";
    const a = POST(req(conversationId, { body: "Aynı", requestId: rid }), { params: Promise.resolve({ id: conversationId }) });
    const b = POST(req(conversationId, { body: "Aynı", requestId: rid }), { params: Promise.resolve({ id: conversationId }) });
    await Promise.all([a, b]);
    await POST(req(conversationId, { body: "İkinci" }), { params: Promise.resolve({ id: conversationId }) });
    await waitUntil(async () => (await prisma.messageOutbox.count({ where: { status: "sent" } })) === 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls.map((c) => c[1])).toEqual(["Aynı", "İkinci"]); // konuşma sırası korunur
  });
});
