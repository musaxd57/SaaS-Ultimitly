// ---------------------------------------------------------------------------
// QR konuşma kayıtları yükleyicisi (`loadConversationStateForConversation`): eskiden son 200 satırı okuyup toplamları ("misafire
// giden mesaj", "son cevaptan sonra misafirin yazdığı") YALNIZ o pencereden sayıyordu (Haiku 10-12). Artık kanalla aynı sınırlı
// okuyucu + kesit öncesi sayım. Kâhin: aynı konuşmada sonuç, BÜTÜN satırlar verilerek kurulan sonuçla birebir aynı — varsayılan
// sayfa (200) ve küçük sayfalar.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadConversationState, loadConversationStateForConversation, QR_STATE_MAX_ROWS } from "@/lib/ai/conversation-state-loader";
import { __setChannelThreadPageForTests } from "@/lib/channel-thread-window";

const reported = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async (where: string) => void reported.push(where)) };
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

describe("QR konuşma kayıtları — sınırlı okuma = bütün satırlar", () => {
  beforeEach(() => vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1"));
  afterEach(() => {
    vi.unstubAllEnvs();
    __setChannelThreadPageForTests(null);
  });
  afterAll(() => __setChannelThreadPageForTests(null));

  async function seed(seedN: number, n: number) {
    await resetDb();
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "chat", status: "new" } });
    const r = rng(seedN);
    const t0 = Date.now() - 5 * 86_400_000;
    const rows = Array.from({ length: n }, (_, i) => {
      const kind = pick(r, ["guest", "guest", "host", "ai", "ai", "system", "empty"]);
      const id = `q${String(i).padStart(4, "0")}`;
      const createdAt = new Date(t0 + i * 60_000);
      if (kind === "guest") return { id, createdAt, direction: "inbound", authorType: "guest", senderName: "G", body: `Soru ${i}`, systemEventType: null };
      if (kind === "host") return { id, createdAt, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: `Cevap ${i}`, systemEventType: null };
      if (kind === "ai") return { id, createdAt, direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: `Bot ${i}`, systemEventType: null };
      if (kind === "system") return { id, createdAt, direction: "outbound", authorType: "system", senderName: "__lixus_ai_resumed__", body: "", systemEventType: "guest_chat_ai_resumed" };
      return { id, createdAt, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "  ", systemEventType: null };
    });
    // Sonda uzun misafir dizisi bazen (kayıtların kesit koşulu bağlayıcı olsun).
    await prisma.message.createMany({ data: rows.map((m) => ({ ...m, conversationId: c.id })) });
    // Son misafir mesajlarının bir kısmına karar kaydı (konu satırı).
    const guests = rows.filter((m) => m.direction === "inbound").slice(-12);
    for (const [i, g] of guests.entries()) {
      if (i % 3 !== 0) continue;
      await prisma.riskEvent.create({
        data: {
          organizationId: orgId, propertyId, conversationId: c.id, surface: "guest_chat", triggerId: g.id,
          finalDecision: i % 2 === 0 ? "human_review" : "auto_sent", reason: "low_confidence_or_risky", riskType: "human_request",
        },
      });
    }
    return { orgId, conversationId: c.id };
  }

  async function expected(orgId: string, conversationId: string) {
    const all = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
    });
    return loadConversationState({ organizationId: orgId, messages: all, conversationId });
  }

  it.each([
    [11, 260],
    [12, 420],
    [13, 90],
  ])("🚨 tohum %i, %i satır: varsayılan sayfa ve küçük sayfalarla sonuç bütün satırlarla aynı", async (seedN, n) => {
    const { orgId, conversationId } = await seed(seedN, n);
    const full = await expected(orgId, conversationId);
    expect(full).toBeDefined();
    expect(await loadConversationStateForConversation({ organizationId: orgId, conversationId })).toEqual(full);
    for (const page of [3, 7, 50]) {
      __setChannelThreadPageForTests(page);
      expect(await loadConversationStateForConversation({ organizationId: orgId, conversationId }), `sayfa ${page}`).toEqual(full);
    }
  });

  it("🚨 eski 200 satır penceresinin gördüğü toplam EKSİKTİ (anti-vakumluk: 260 satırda ilk 60'taki cevaplar sayılır)", async () => {
    const { orgId, conversationId } = await seed(11, 260);
    const full = await expected(orgId, conversationId);
    const last200 = (
      await prisma.message.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
        select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
      })
    ).reverse();
    const old = await loadConversationState({ organizationId: orgId, messages: last200, conversationId });
    expect(old!.outbound).toBeLessThan(full!.outbound);
  });

  async function seedGuestOnly(n: number) {
    await resetDb();
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "chat", status: "new" } });
    const t0 = Date.now() - 5 * 86_400_000;
    await prisma.message.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        id: `g${String(i).padStart(5, "0")}`,
        conversationId: c.id,
        createdAt: new Date(t0 + i * 1_000),
        direction: "inbound",
        authorType: "guest",
        senderName: "G",
        body: `Mesaj ${i}`,
      })),
    });
    return { orgId, conversationId: c.id };
  }

  it("🚨 hiç cevap olmayan çok uzun konuşma: okuma sınırda DURUR, blok yazılmaz, hata kaydı düşer (her turda bütün konuşma okunmaz)", async () => {
    reported.length = 0;
    const { orgId, conversationId } = await seedGuestOnly(QR_STATE_MAX_ROWS + 1);
    const spy = vi.spyOn(prisma.message, "findMany");
    expect(await loadConversationStateForConversation({ organizationId: orgId, conversationId })).toBeUndefined();
    const read = (await Promise.all(spy.mock.results.map((r) => r.value as Promise<unknown[]>))).reduce((n, rows) => n + rows.length, 0);
    spy.mockRestore();
    expect(read).toBeLessThanOrEqual(QR_STATE_MAX_ROWS);
    expect(reported).toContain("conversation-state-qr-window-cap");
  });

  it("KONTROL: sınırın altındaki cevapsız konuşma eksiksiz okunur ve blok kurulur (sayılar bütün satırlarla aynı)", async () => {
    reported.length = 0;
    const { orgId, conversationId } = await seedGuestOnly(QR_STATE_MAX_ROWS - 10);
    const got = await loadConversationStateForConversation({ organizationId: orgId, conversationId });
    expect(got).toEqual(await expected(orgId, conversationId));
    expect(got!.unansweredGuest).toBe(QR_STATE_MAX_ROWS - 10);
    expect(reported).not.toContain("conversation-state-qr-window-cap");
  });

  it("🚨 başka işletmenin konuşması: saat dilimi verilse de aşama / son cevap süresi SIZMAZ (boş özet)", async () => {
    const { conversationId } = await seed(13, 90);
    const other = await prisma.organization.create({ data: { name: "B" } });
    const foreign = await loadConversationStateForConversation({
      organizationId: other.id,
      conversationId,
      timeZone: "Europe/Istanbul",
      reservationId: null,
    });
    expect(foreign).toEqual({ outbound: 0, hostOutbound: 0, unansweredGuest: 0, items: [], lifecycleSent: [] });
    expect(foreign).not.toHaveProperty("phase");
  });

  it("KONTROL: kendi konuşmasında saat dilimiyle aşama EKLENİR (yukarıdaki yokluk vakumlu değil)", async () => {
    const { orgId, conversationId } = await seed(13, 90);
    const own = await loadConversationStateForConversation({ organizationId: orgId, conversationId, timeZone: "Europe/Istanbul" });
    expect(own).toHaveProperty("phase");
  });
});
