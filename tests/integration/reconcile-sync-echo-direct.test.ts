import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { stayDay } from "../helpers/stay-dates";
import type { SessionPayload } from "@/lib/auth";
import type { CanonicalReservation } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// G1 YENİDEN ÜRETME (B1'in komşusu, doğrudan yol) — ANAHTAR AÇILINCA (`CHANNEL_SEND_RECONCILE_ENABLED`).
// Ev sahibinin cevabı doğrudan yoldan gider; kanal kabul eder, yanıt kaybolur (zaman aşımı). İstek yoldayken olağan senkron (2 dk) kanaldaki
// mesajı içe alır: yerelde henüz cevap satırı yok (doğrudan yol satırı teslimden SONRA yazar) → senkron YENİ bir yerel mesaj açar. Hemen
// ardından uzlaştırma bakışı bu kimliği "başka kayda ait" sayar → ev sahibine 502 "doğrulanamadı" döner; oysa mesaj kanalda ve konuşmada.
// ---------------------------------------------------------------------------

const { tokenFor } = vi.hoisted(() => ({
  tokenFor: vi.fn<(orgId: string) => Promise<string | null>>(async () => "tok-A"),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: tokenFor,
  handleProviderAuthFailure: vi.fn(async () => {}),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { __setOutboundAdapterForTest } from "@/lib/channels";
import { __resetRateLimit } from "@/lib/rate-limit";
import { importCanonicalThread } from "@/lib/ingest/write-service";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";

const fake = new FakeOutboundProvider();
const RES = "res-g1-direct-1";
const BODY = "Havluları getiriyoruz.";

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES },
  });
  fake.registerReservation(RES, "tok-A");
  return { orgId, propertyId, conversationId: conversation.id };
}

const reply = (conversationId: string) =>
  replyRoute(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: BODY, senderName: "Owner" }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );

function canonical(): CanonicalReservation {
  return {
    externalId: RES,
    code: "G1D",
    channel: "airbnb",
    status: "confirmed",
    arrivalDate: stayDay(1),
    departureDate: stayDay(4),
    guest: { externalId: "g-d", name: "Alex", givenName: "Alex", email: null, phone: null },
    totalAmount: null,
    currency: null,
    conversationExternalId: "conv-d",
    conversationLanguage: null,
    lastMessageAt: new Date(),
    terminal: false,
  };
}

describe("(G1 11-19) doğrudan yol: istek yoldayken senkronun içe aldığı kendi kopyası kanal doğrulamasını engellemez (anahtar açılınca)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "1");
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("KONTROL (bugün yeşil): senkron araya girmezse 201 'gönderildi'", async () => {
    const { conversationId } = await seed();
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    fake.behave({ mode: "timeout", delivered: true });
    expect((await reply(conversationId)).status).toBe(201);
  });

  it("🚨 istek yoldayken senkron mesajı içe alır → 201 'gönderildi'; konuşmada TEK satır (senkronun satırı benimsenir), ikinci istek yok", async () => {
    const { orgId, propertyId, conversationId } = await seed();
    const real = fake.adapter();
    __setOutboundAdapterForTest("hospitable", {
      ...real,
      send: async (destination, body, credential) => {
        const out = await real.send(destination, body, credential); // kanal kabul etti, yanıt kayboldu (ambiguous)
        // Yanıt beklenirken olağan senkron koştu: kanaldaki mesaj içe alındı (gerçek yazma servisi).
        const d = fake.deliveries[0]!;
        await prisma.$transaction((tx) =>
          importCanonicalThread(
            tx,
            propertyId,
            canonical(),
            [{ externalId: d.providerMessageId, direction: "outbound", senderName: "Owner", body: d.body, createdAt: d.at }],
            null,
            { organizationId: orgId, provider: "hospitable", connectionId: null },
          ),
        );
        return out;
      },
    });
    fake.behave({ mode: "timeout", delivered: true });
    const res = await reply(conversationId);
    const inThread = await prisma.message.count({ where: { conversationId, direction: "outbound", externalId: fake.deliveries[0]!.providerMessageId } });
    expect(inThread).toBe(1); // mesaj konuşmada (senkronun satırı)
    expect(fake.attempts).toHaveLength(1);
    expect(res.status).toBe(201); // eski davranış: 502 "doğrulanamadı" (yankı "başka kayıt" sayılıyordu)
  });
});
