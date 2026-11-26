import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Q2 yarışı (Haiku 10-17, P1 olası) — gerçek PostgreSQL. Bizim gönderdiğimiz cevap (ev sahibi / yapay zekâ) sağlayıcıya ulaştıktan SONRA
// ama yerel satır yazılmadan ÖNCE senkron aynı mesajı içeri alırsa ve kanal onu "otomasyon" diye etiketlerse satır otomatik mesaj olurdu:
// cevap "cevap değil" sayılır, konuşma yeniden açılır, yapay zekâ ikinci cevap üretebilirdi. Gönderen yol, kendi teslim kimliğiyle satırı
// gerçek yazarına düzeltir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  resolveOrgChannelCredential: vi.fn(async () => ({ token: "t" })),
}));

import { sendOnChannel } from "@/lib/messaging";
import { sendHostMessage } from "@/lib/host-send";

const mockSend = vi.mocked(sendOnChannel);

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Deniz",
      status: "new",
      externalReservationId: "res-race",
      messages: { create: [{ direction: "inbound", authorType: "guest", senderName: "Deniz", body: "Otopark var mı?", externalId: "g-1" }] },
    },
  });
  return { orgId, conv };
}

/** Senkronun aynı mesajı ÖNCE içeri aldığı an: kanal rolü otomasyon → yazar otomatik mesaj (Q2 kuralı). */
async function syncWins(conversationId: string, body: string, role: "automation" | null = "automation") {
  await prisma.message.create({
    data: {
      conversationId,
      direction: "outbound",
      authorType: role === "automation" ? "automation" : "host",
      senderName: "Ev sahibi",
      body,
      externalId: "pm-1",
      channelSenderRole: role,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  mockSend.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Q2 yarışı — ev sahibi cevabı", () => {
  it("🚨 senkron cevabı 'otomasyon' diye önce yazdı → gönderim satırı EV SAHİBİNE düzeltir; tek satır; konuşma cevaplı", async () => {
    const { orgId, conv } = await seed();
    mockSend.mockImplementation(async () => {
      await syncWins(conv.id, "Binanın arkasında ücretsiz otopark var.");
      return { ok: true, providerMessageId: "pm-1" } as never;
    });
    const r = await sendHostMessage({
      organizationId: orgId,
      conversation: { id: conv.id, channel: "airbnb", guestIdentifier: "Deniz", externalReservationId: "res-race" },
      body: "Binanın arkasında ücretsiz otopark var.",
      claimBody: "Binanın arkasında ücretsiz otopark var.",
      senderName: "Ayşe",
      aiAssisted: true,
      idempotencyKey: "k1",
      strictIdempotency: false,
    });
    expect(r.status).toBe("sent");
    const rows = await prisma.message.findMany({ where: { conversationId: conv.id, direction: "outbound" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorType: "host", channelSenderRole: null, senderName: "Ayşe", aiAssisted: true, externalId: "pm-1" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("answered");
  });

  it("KONTROL: senkronun yazdığı satır otomasyon DEĞİLSE (rolsüz → ev sahibi) yazar alanına dokunulmaz", async () => {
    const { orgId, conv } = await seed();
    mockSend.mockImplementation(async () => {
      await syncWins(conv.id, "Tamam.", null);
      return { ok: true, providerMessageId: "pm-1" } as never;
    });
    await sendHostMessage({
      organizationId: orgId,
      conversation: { id: conv.id, channel: "airbnb", guestIdentifier: "Deniz", externalReservationId: "res-race" },
      body: "Tamam.",
      claimBody: "Tamam.",
      senderName: "Ayşe",
      aiAssisted: false,
      idempotencyKey: "k2",
      strictIdempotency: false,
    });
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "pm-1" } })).toMatchObject({ authorType: "host", senderName: "Ev sahibi" });
  });
});
