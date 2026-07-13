import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getHostPerformanceScore } from "@/lib/reports";

// Codex #33 red-first pins against the OLD conversation-level metric:
//  A) an OLD conversation the guest just wrote to again was EXCLUDED entirely
//     (the filter was conversation.createdAt >= 30d, not activity);
//  B) only the FIRST inbound/outbound pair was measured — later slow/unanswered
//     episodes in the same thread were invisible (rate stuck at 100%).

const H = 60 * 60 * 1000;

describe("responseRate — episode-based over ACTIVE conversations", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedConversation(createdAt: Date, msgs: { dir: "inbound" | "outbound"; at: Date }[]) {
    const conv = await prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: "airbnb",
        createdAt,
        lastMessageAt: msgs[msgs.length - 1]?.at ?? createdAt,
      },
    });
    for (const m of msgs) {
      await prisma.message.create({
        data: { conversationId: conv.id, direction: m.dir, senderName: "x", body: "b", createdAt: m.at },
      });
    }
  }

  it("A) an old-but-ACTIVE conversation counts (old code excluded it → rate was null)", async () => {
    const now = Date.now();
    const created = new Date(now - 60 * 24 * H); // conversation opened 60 days ago
    await seedConversation(created, [
      { dir: "inbound", at: new Date(now - 5 * H) }, // guest wrote AGAIN yesterday-ish
      { dir: "outbound", at: new Date(now - 4 * H) }, // answered in 1h
    ]);
    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.responseRate).toBe(100); // old code: null (thread invisible)
  });

  it("B) later slow episodes in the SAME thread drag the rate down (old code: stuck at 100)", async () => {
    const now = Date.now();
    const created = new Date(now - 10 * 24 * H);
    await seedConversation(created, [
      // ep1: answered fast (this is ALL the old metric ever saw)
      { dir: "inbound", at: new Date(now - 9 * 24 * H) },
      { dir: "outbound", at: new Date(now - 9 * 24 * H + 1 * H) },
      // ep2: answered after 30h — too slow
      { dir: "inbound", at: new Date(now - 5 * 24 * H) },
      { dir: "outbound", at: new Date(now - 5 * 24 * H + 30 * H) },
      // ep3: still unanswered
      { dir: "inbound", at: new Date(now - 2 * H) },
    ]);
    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.responseRate).toBe(33); // 1 of 3 episodes within 24h
  });
});
