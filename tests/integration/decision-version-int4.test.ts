import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// G2 YENİDEN ÜRETME (11-19) — 11-14 tur 2 M-1 sınıfının ("32 biti taşan otomatik mesaj sürümü" → 400) açık kalan komşusu: karar kartı
// "Kapat" dalı. Şema `version: z.number().int().min(0)` (zod 4: güvenli tamsayı, 2^53'e kadar) — "Kapat" dalı sürümü önce okunan satırla
// KIYASLAMADAN doğrudan `updateMany({ where: { version } })`a koyuyor; Int (int4) sütununa sığmayan değer Prisma hatası → 500 +
// `reportError("api")`. Onay / ret dalı önce bellekte kıyaslıyor (409). Anahtar `HOST_DECISIONS_ENABLED` açılışta KAPALI → "anahtar açılınca".
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
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

import { POST } from "@/app/api/conversations/[id]/decisions/[decisionId]/route";

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const arrival = new Date(Date.now() + 86_400_000);
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 3 * 86_400_000), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "res-1", status: "new" },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Erken giriş?" },
  });
  const decision = await prisma.decisionRequest.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      messageId: message.id,
      reservationId: reservation.id,
      kind: "early_checkin",
      requestedTime: "13:00",
      dayKey: arrival.toISOString().slice(0, 10),
      lang: "tr",
    },
  });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Ev Sahibi", sessionEpoch: 0 };
  return { conversationId: conversation.id, decisionId: decision.id };
}

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("(G2 11-19) karar 'Kapat' dalında int4'ü taşan sürüm — 500 / uyarı kovası YOK", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.length = 0;
    process.env.HOST_DECISIONS_ENABLED = "1";
  });
  afterEach(() => {
    delete process.env.HOST_DECISIONS_ENABLED;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: bayat ama sığan sürümle Kapat → 409, alarm yok", async () => {
    const s = await seed();
    const res = await POST(req({ action: "dismiss", version: 7 }), { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) });
    expect(res.status).toBe(409);
    expect(reported).not.toContain("api");
  });

  it("🚨 Kapat + version 2^31 → 400 gövde hatası (11-14 M-1 kalıbı), 500 / uyarı yok; sığan en büyük sürüm hâlâ gövdeden geçer", async () => {
    const s = await seed();
    const res = await POST(req({ action: "dismiss", version: 2 ** 31 }), { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) });
    expect({ status: res.status, reported }).toEqual({ status: 400, reported: [] });
    // KONTROL: sınırın kendisi (int4 en büyük) gövde doğrulamasından geçer → bayat sürüm kuralı (409), 400 değil.
    const edge = await POST(req({ action: "dismiss", version: 2_147_483_647 }), { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) });
    expect({ status: edge.status, reported }).toEqual({ status: 409, reported: [] });
  });
});
