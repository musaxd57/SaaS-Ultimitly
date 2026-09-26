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
    const ids: string[] = [];
    for (const m of msgs) {
      const row = await prisma.message.create({
        data: { conversationId: conv.id, direction: m.dir, senderName: "x", body: "b", createdAt: m.at },
      });
      ids.push(row.id);
    }
    return { conversationId: conv.id, ids };
  }

  it("🚨 kapanışa sessizlik (09-25): karar kaydı `no_reply` olan son teşekkür kaçırılmış cevap SAYILMAZ; başka org'un kaydı sayılmaz", async () => {
    const now = Date.now();
    const created = new Date(now - 10 * 24 * H);
    const { conversationId, ids } = await seedConversation(created, [
      { dir: "inbound", at: new Date(now - 5 * 24 * H) },
      { dir: "outbound", at: new Date(now - 5 * 24 * H + H) }, // 1 saatte cevap
      { dir: "inbound", at: new Date(now - 4 * 24 * H) }, //      "Teşekkürler" — bilerek cevapsız
    ]);
    // KONTROL: kayıt yokken son mesaj süresi geçmiş cevapsız bir bekleyiştir → %50.
    expect((await getHostPerformanceScore(orgId)).breakdown.responseRate).toBe(50);
    // Kiracı izolasyonu: başka org'un aynı tetikleyicili kaydı hiçbir şey değiştirmez.
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    await prisma.riskEvent.create({
      data: { organizationId: other.id, surface: "auto_reply", triggerId: ids[2], finalDecision: "no_reply", reason: "closing_ack" },
    });
    expect((await getHostPerformanceScore(orgId)).breakdown.responseRate).toBe(50);
    await prisma.riskEvent.create({
      data: { organizationId: orgId, conversationId, surface: "auto_reply", triggerId: ids[2], finalDecision: "no_reply", reason: "closing_ack" },
    });
    expect((await getHostPerformanceScore(orgId)).breakdown.responseRate).toBe(100);
  });

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

  it("B) later slow/expired episodes drag the rate down; a FRESH question is PENDING (out of the denominator)", async () => {
    const now = Date.now();
    const created = new Date(now - 10 * 24 * H);
    await seedConversation(created, [
      // ep1: answered fast (this is ALL the old metric ever saw)
      { dir: "inbound", at: new Date(now - 9 * 24 * H) },
      { dir: "outbound", at: new Date(now - 9 * 24 * H + 1 * H) },
      // ep2: answered after 30h — late stays late
      { dir: "inbound", at: new Date(now - 5 * 24 * H) },
      { dir: "outbound", at: new Date(now - 5 * 24 * H + 30 * H) },
      // ep3: unanswered for 30h — SLA expired → failed
      { dir: "inbound", at: new Date(now - 30 * H) },
    ]);
    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.responseRate).toBe(33); // 1 of 3 (fast / late / expired)

    // ep4: guest wrote 5 minutes ago — PENDING, must NOT move the denominator
    // (Codex: instantly counting it as a miss unfairly tanks the report).
    await prisma.message.create({
      data: {
        conversationId: (await prisma.conversation.findFirstOrThrow()).id,
        direction: "inbound", senderName: "G", body: "b",
        createdAt: new Date(now - 5 * 60 * 1000),
      },
    });
    const score2 = await getHostPerformanceScore(orgId);
    expect(score2.breakdown.responseRate).toBe(33); // unchanged — still 1 of 3
  });

  it("D) SÜREKLİ İHMAL artık görünür: 30 günden önce sorulup hâlâ yanıtlanmamış koşu sayılır", async () => {
    // ÖLÇÜLDÜ (08-08): episode YALNIZ başlangıcına göre pencerelendiği için,
    // misafiri ne kadar uzun bekletirsen koşu sınırı o kadar kesin aşıyor ve
    // episode denklemden TAMAMEN düşüyordu → iki thread'in biri baştan sona
    // ihmal edilmişken kart "%100" basıyordu.
    const now = Date.now();
    // A: pencere içinde soruldu, 1 saatte yanıtlandı.
    await seedConversation(new Date(now - 3 * 24 * H), [
      { dir: "inbound", at: new Date(now - 2 * 24 * H) },
      { dir: "outbound", at: new Date(now - 2 * 24 * H + H) },
    ]);
    // B: misafir 40 gün önce sordu, yanıt YOK; 2 gün önce tekrar yazdı (araya
    // outbound girmediği için TEK koşu, çapa 40 gün önce). Thread `lastMessageAt`
    // ile hâlâ aktif → popülasyona giriyor ama eski kodda episode'u yok sayılıyordu.
    await seedConversation(new Date(now - 45 * 24 * H), [
      { dir: "inbound", at: new Date(now - 40 * 24 * H) },
      { dir: "inbound", at: new Date(now - 2 * 24 * H) },
    ]);

    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.responseRate).toBe(50); // 1 / 2 — eski kod: 100
  });

  it("C) NO eligible episode (only a pending one) → responseRate is NULL — never 0, NaN or Infinity", async () => {
    const now = Date.now();
    // The org's ONLY activity: a guest question from 5 minutes ago (pending).
    await seedConversation(new Date(now - 2 * H), [
      { dir: "inbound", at: new Date(now - 5 * 60 * 1000) },
    ]);
    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.responseRate).toBeNull(); // excluded metric, not a fake score
    expect(Number.isNaN(score.score)).toBe(false); // composite never poisoned
    expect(Number.isFinite(score.score)).toBe(true);
  });
});
