import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR MESAJI TASLAĞI UCU (Sabah Kararları 62 h). Hiçbir şey GÖNDERMEZ / YAZMAZ; anahtar kapalıyken ya da model
// yoksa onaylı şablonu döndürür. Kiracı yalıtımı, personel, tür ve saat kontrolü. (Yapay zekâ yolu: `tests/unit/decision-ai-text`.)
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/conversations/[id]/decisions/[decisionId]/draft/route";
import { decisionMessageText, formatDecisionDay } from "@/lib/decisions/core";

const DAY = 86_400_000;
const arrival = (() => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 2));
})();
const dayKey = arrival.toISOString().slice(0, 10);

async function seed(kind = "early_checkin", role: "owner" | "staff" = "owner") {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 3 * DAY), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "res-1", status: "new" },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "13:00'te girebilir miyiz?", createdAt: new Date(Date.now() - 60_000) },
  });
  const decision = await prisma.decisionRequest.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: message.id, reservationId: reservation.id, kind, requestedTime: "13:00", dayKey, lang: "en" },
  });
  session = { userId: user.id, organizationId: org.id, role, email: user.email, name: "Ev Sahibi", sessionEpoch: 0 };
  return { conversationId: conversation.id, decisionId: decision.id };
}

function post(s: { conversationId: string; decisionId: string }, body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/conversations/${s.conversationId}/decisions/${s.decisionId}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) },
  );
}

describe("POST …/decisions/[decisionId]/draft", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("karar motoru kapalı → 404", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "");
    const s = await seed();
    expect((await post(s, { action: "approve", time: "13:00" })).status).toBe(404);
  });

  it("yapay zekâ metni kapalı → misafirin dilinde onaylı şablon; hiçbir satır yazılmaz", async () => {
    const s = await seed();
    const res = await post(s, { action: "approve", time: "13:00" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toBe("template");
    expect(json.text).toBe(
      decisionMessageText({ kind: "early_checkin", resolution: "approve", lang: "en", dayKey, time: "13:00", standardTime: "15:00" }),
    );
    expect(json.text).toContain(formatDecisionDay(dayKey, "en"));
    expect(await prisma.message.count({ where: { direction: "outbound" } })).toBe(0);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).version).toBe(0);
  });

  it("yapay zekâ metni açık ama model yapılandırılmamış → şablon (ev sahibi karar vermeye devam eder)", async () => {
    vi.stubEnv("HOST_DECISION_AI_TEXT_ENABLED", "1");
    const s = await seed();
    const json = await (await post(s, { action: "decline" })).json();
    expect(json.source).toBe("template");
    expect(json.text).toContain("15:00");
  });

  it("panelde seçilen dil ve ücret / not seçimi taslağa yansır", async () => {
    const s = await seed();
    const json = await (await post(s, { action: "approve", time: "13:00", lang: "de", includeFee: false, includeNote: false })).json();
    expect(json.text).toBe(
      decisionMessageText({ kind: "early_checkin", resolution: "approve", lang: "de", dayKey, time: "13:00", standardTime: "15:00" }),
    );
  });

  it("onayda saat yoksa 400", async () => {
    const s = await seed();
    expect((await post(s, { action: "approve" })).status).toBe(400);
  });

  it("metin desteklemeyen tür (uzatma) → 404", async () => {
    const s = await seed("extend_stay");
    expect((await post(s, { action: "decline" })).status).toBe(404);
  });

  it("başka kiracının kararı → 404", async () => {
    const s = await seed();
    await seed();
    expect((await post(s, { action: "decline" })).status).toBe(404);
  });

  it("personel → 403", async () => {
    const s = await seed("early_checkin", "staff");
    expect((await post(s, { action: "decline" })).status).toBe(403);
  });
});
