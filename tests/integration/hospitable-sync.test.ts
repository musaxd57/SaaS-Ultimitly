import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// Mock the Hospitable API client so the sync runs against fixed fixtures.
vi.mock("@/lib/hospitable", () => ({
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));

import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);

describe("syncHospitable", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([]);
    mockMessages.mockResolvedValue([]);
  });

  it("imports a thread, maps direction/channel/language, and is idempotent", async () => {
    const { orgId } = await makeOrgWithProperty(); // creates "Test Property"
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-1",
        code: "HMABC",
        platform: "airbnb",
        conversation_id: "conv-1",
        conversation_language: "en",
        last_message_at: "2026-05-30T10:00:00Z",
      },
    ]);
    mockMessages.mockResolvedValue([
      {
        id: 1001,
        body: "What time is check-in?",
        sender_type: "guest",
        sender_role: "guest",
        sender: { full_name: "Alex Guest" },
        created_at: "2026-05-30T09:00:00Z",
      },
      {
        id: 1002,
        body: "Check-in is at 15:00.",
        sender_type: "host",
        sender_role: "host",
        sender: { full_name: "Ev Sahibi" },
        created_at: "2026-05-30T10:00:00Z",
      },
    ]);

    const result = await syncHospitable(orgId);

    expect(result).toEqual({ properties: 1, conversations: 1, messages: 2 });

    // Adopted the existing property by name — no duplicate.
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(1);
    const prop = await prisma.property.findFirst({ where: { organizationId: orgId } });
    expect(prop?.hospitableId).toBe("hosp-prop-1");

    const conversation = await prisma.conversation.findFirst({
      where: { externalReservationId: "res-1" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(conversation?.channel).toBe("airbnb");
    expect(conversation?.guestIdentifier).toBe("Alex Guest");
    expect(conversation?.externalConversationId).toBe("conv-1");
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]).toMatchObject({
      direction: "inbound",
      externalId: "1001",
      language: "en",
    });
    expect(conversation?.messages[1].direction).toBe("outbound");

    // Second sync imports nothing new (dedup by external id).
    const second = await syncHospitable(orgId);
    expect(second.messages).toBe(0);
    expect(await prisma.message.count()).toBe(2);
  });

  it("skips reservations that have no message thread", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-empty", platform: "airbnb", last_message_at: null },
    ]);

    const result = await syncHospitable(orgId);

    expect(result.conversations).toBe(0);
    expect(result.messages).toBe(0);
    expect(mockMessages).not.toHaveBeenCalled();
  });

  it("creates a new property when none matches by name", async () => {
    const { orgId } = await makeOrgWithProperty(); // "Test Property"
    mockProperties.mockResolvedValue([{ id: "hosp-prop-9", name: "Deniz Manzaralı Daire" }]);

    await syncHospitable(orgId);

    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(2);
    const created = await prisma.property.findFirst({ where: { hospitableId: "hosp-prop-9" } });
    expect(created?.name).toBe("Deniz Manzaralı Daire");
  });
});
