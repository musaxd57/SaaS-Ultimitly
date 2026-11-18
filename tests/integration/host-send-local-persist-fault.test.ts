import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 C1, 2. tur (ana oturum incelemesi): DIŞ KANAL YOKKEN (hedefsiz / iç QR konuşma) kayıt düşerse hiçbir şey ne gitti ne
// kaydedildi. Dış kanalda "teslim kesin → gönderildi" sözleşmesi doğrudur (çift mesaj riski alınmaz — `host-send-persist-fault.test.ts`),
// yerel rotada ise aynı dal 201 + "kaydedildi / gönderildi" diyordu: ev sahibi cevabının kaybolduğunu bilmiyordu. Artık yerel rotada kayıt
// hatası KESİN başarısızlıktır: talepler bırakılır, var olan "gönderilemedi, tekrar deneyin" yolu döner (rota 502, karar kartı yeniden açılır).
//
// Prisma casusu sonraki testlere sızmasın diye AYRI dosya; casus BİR KEZ kurulur, bayrakla açılır (geri alınmaz).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "prov-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
const reported = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async (ctx: string) => {
    reported.calls.push(ctx);
    return "reported";
  }),
}));

import { POST as REPLY } from "@/app/api/conversations/[id]/reply/route";
import { POST as DECIDE } from "@/app/api/conversations/[id]/decisions/[decisionId]/route";

const RID = "11111111-2222-4333-8444-555555555555";
const DAY = 86_400_000;

/** Kayıt işlemi (etkileşimli `$transaction`) bir kez düşer; casus dosyada bir kez kurulur. */
let failNextPersist = false;
const realTx = prisma.$transaction.bind(prisma) as (arg: unknown, opts?: unknown) => Promise<unknown>;
vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
  if (failNextPersist && typeof arg === "function") {
    failNextPersist = false;
    return Promise.reject(new Error("db blip (test)"));
  }
  return realTx(arg, opts);
}) as never);

async function seed(externalReservationId: string | null) {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const conv = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "Guest", channel: "airbnb", externalReservationId, status: "waiting" },
  });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Owner", sessionEpoch: 0 };
  return { orgId: org.id, propertyId: property.id, conversationId: conv.id };
}

const reply = async (conversationId: string, body = "Havlular dolapta.") => {
  const res = await REPLY(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, requestId: RID }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const outbound = (conversationId: string) => prisma.message.count({ where: { conversationId, direction: "outbound" } });
const statusOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id } })).status;

describe("yerel / QR konuşmada kayıt düşerse başarı denmez", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.calls.length = 0;
    failNextPersist = false;
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["hedefsiz konuşma", null],
    ["iç QR konuşması", "qr-chat:abc"],
  ] as const)("🚨 %s: kayıt düştü → 201 DEĞİL, delivery yok, mesaj yok, 'Cevaplandı' değil; hata raporlanır; aynı istek kimliğiyle yeniden deneme TEK mesaj yazar", async (_n, ext) => {
    const s = await seed(ext);
    failNextPersist = true;
    const first = await reply(s.conversationId);
    expect(first.status).not.toBe(201);
    expect(first.status).toBe(502);
    expect(first.json?.delivery).toBeUndefined();
    expect(await outbound(s.conversationId)).toBe(0);
    expect(await statusOf(s.conversationId)).toBe("waiting");
    expect(reported.calls).toContain("host-send.local-persist-failed");
    // Arıza kalktı: aynı istek kimliği (istemci hata sonrası kimliği TUTAR) — talepler bırakıldığı için geçer, tek mesaj.
    const retry = await reply(s.conversationId);
    expect(retry.status).toBe(201);
    expect(retry.json?.delivery).toBe(ext ? "qr_visible" : "local_only");
    expect(await outbound(s.conversationId)).toBe(1);
  });

  it("🚨 karar kartı (hedefsiz konuşma): kayıt düştü → kart yeniden AÇILIR (kesin başarısızlık yolu), mesaj yok", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const s = await seed(null);
    const now = new Date();
    const arrival = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const reservation = await prisma.reservation.create({
      data: { propertyId: s.propertyId, guestName: "Ada", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), status: "confirmed", channel: "airbnb" },
    });
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { reservationId: reservation.id } });
    const asked = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "Ada", authorType: "guest", body: "13:00'te girebilir miyiz?", createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    const decision = await prisma.decisionRequest.create({
      data: {
        organizationId: s.orgId, conversationId: s.conversationId, messageId: asked.id, reservationId: reservation.id,
        kind: "early_checkin", requestedTime: "13:00", dayKey: arrival.toISOString().slice(0, 10), lang: "tr",
      },
    });
    failNextPersist = true;
    const res = await DECIDE(
      new NextRequest(`http://localhost/api/conversations/${s.conversationId}/decisions/${decision.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", version: 0, time: "13:00", body: "Erken giriş talebiniz onaylandı: yarın 13:00." }),
      }),
      { params: Promise.resolve({ id: s.conversationId, decisionId: decision.id }) },
    );
    expect(res.status).toBe(502);
    expect(await outbound(s.conversationId)).toBe(0);
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: decision.id } })).toMatchObject({ status: "pending", resultMessageId: null });
  });

  it("KONTROL — dış kanala giden gönderimde kayıt düşerse bugünkü sözleşme: teslim kesin → 201 'channel_accepted' (mesaj satırı sonra senkronla gelir)", async () => {
    const s = await seed("res-1");
    failNextPersist = true;
    const r = await reply(s.conversationId);
    expect(r.status).toBe(201);
    expect(r.json?.delivery).toBe("channel_accepted");
    expect(reported.calls).toContain("host-send.persist-after-delivery");
    expect(reported.calls).not.toContain("host-send.local-persist-failed");
  });
});
