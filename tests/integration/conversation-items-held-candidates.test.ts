import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { URGENT_RISK_TYPES } from "@/lib/conversation-items/core";
import { LEGACY_AI_RESUME_SENDER, LEGACY_AI_SENDER_NAMES } from "@/lib/message-author";

// ---------------------------------------------------------------------------
// "Dikkat" bırakılan istekler — süzgeç SORGUDA, tavan yalnız ADAYLARDA (Codex 11-17 E3).
// Eski yol: hassas + açık öğelerin EN ESKİ 500'ü okunur, "ev sahibi sonradan yazdı" süzgeci SONRA uygulanırdı → ev sahibinin cevapladığı
// (DB'de hâlâ açık duran) eski öğeler pencereyi doldurunca arkadaki gerçekten açık, EN YENİ istek sessizce kaybolurdu.
// ---------------------------------------------------------------------------

const alertSpy = vi.fn(async (..._args: unknown[]) => "alerted" as const);
vi.mock("@/lib/alert-state", async (orig) => {
  const actual = await orig<typeof import("@/lib/alert-state")>();
  return { ...actual, alertOnTransition: (...a: unknown[]) => alertSpy(...a) };
});

import { heldRequestsByConversation, type HeldRequestSummary } from "@/lib/conversation-items/store";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function conversation(propertyId: string) {
  const c = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: `res-${Math.random()}`, status: "new" },
  });
  return c.id;
}
async function guestMessage(conversationId: string, at: Date) {
  return (
    await prisma.message.create({
      data: { conversationId, direction: "inbound", senderName: "Alex", authorType: "guest", body: "?", createdAt: at },
    })
  ).id;
}
async function hostMessage(conversationId: string, at: Date) {
  await prisma.message.create({
    data: { conversationId, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: "Bakıyorum.", createdAt: at },
  });
}
async function heldItem(orgId: string, conversationId: string, messageId: string, createdAt: Date, kind = "payment_invoice") {
  return prisma.conversationItem.create({
    data: { organizationId: orgId, conversationId, messageId, kind, sensitivity: "sensitive", sources: "lexical", status: "pending_host", createdAt },
  });
}

describe("bırakılan istekler — tavan cevaplanmış öğelerle dolmaz", () => {
  beforeEach(async () => {
    await resetDb();
    alertSpy.mockClear();
  });

  it("🚨 aynı konuşma: 2 eski (ev sahibi cevapladı) + 1 yeni istek, cap 2 → yeni istek görünür", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    const c = await conversation(propertyId);
    const m1 = await guestMessage(c, new Date(now - 300 * MIN));
    await heldItem(orgId, c, m1, new Date(now - 299 * MIN), "payment_invoice");
    await heldItem(orgId, c, m1, new Date(now - 298 * MIN), "complaint_issue");
    await hostMessage(c, new Date(now - 200 * MIN));
    const m2 = await guestMessage(c, new Date(now - 100 * MIN));
    await heldItem(orgId, c, m2, new Date(now - 99 * MIN), "payment_invoice");
    const held = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds: [propertyId], since: new Date(now - 30 * DAY), cap: 2 });
    expect(held.map((h) => [h.conversationId, h.count, h.kinds])).toEqual([[c, 1, ["payment_invoice"]]]);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("🚨 iki konuşma: biri tamamen cevaplanmış (eski), öteki açık (yeni), cap 2 → açık konuşma görünür", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    const answered = await conversation(propertyId);
    const ma = await guestMessage(answered, new Date(now - 500 * MIN));
    await heldItem(orgId, answered, ma, new Date(now - 499 * MIN), "payment_invoice");
    await heldItem(orgId, answered, ma, new Date(now - 498 * MIN), "complaint_issue");
    await hostMessage(answered, new Date(now - 400 * MIN));
    const open = await conversation(propertyId);
    const mo = await guestMessage(open, new Date(now - 60 * MIN));
    await heldItem(orgId, open, mo, new Date(now - 59 * MIN));
    const held = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds: [propertyId], since: new Date(now - 30 * DAY), cap: 2 });
    expect(held.map((h) => h.conversationId)).toEqual([open]);
  });

  it("saat kayması: öğe kaydı ev sahibi cevabından ÖNCE ama mesajı SONRA → açık (karar mesaj anına bakar; aday süzgeci bunu kesmez)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    const c = await conversation(propertyId);
    await hostMessage(c, new Date(now - 100 * MIN));
    const m = await guestMessage(c, new Date(now - 95 * MIN));
    await heldItem(orgId, c, m, new Date(now - 105 * MIN));
    const held = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds: [propertyId], since: new Date(now - 30 * DAY) });
    expect(held.map((h) => h.conversationId)).toEqual([c]);
  });

  it("🚨 gerçekten açık aday tavanı aşarsa sessiz değil: geçiş tabanlı alarm (işletme anahtarlı) + ilk `cap` aday yine döner", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    const convs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await conversation(propertyId);
      convs.push(c);
      const m = await guestMessage(c, new Date(now - (100 - i) * MIN));
      await heldItem(orgId, c, m, new Date(now - (99 - i) * MIN));
    }
    const held = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds: [propertyId], since: new Date(now - 30 * DAY), cap: 2 });
    expect(held.map((h) => h.conversationId)).toEqual(convs.slice(0, 2));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]![0]).toBe(`attention:held-request-cap:${orgId}`);
    expect(alertSpy.mock.calls[0]![2]).toBeInstanceOf(Error);
  });

  it("aşırı uygulama: aday sayısı TAM tavanda → alarm yok, hepsi döner", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
      const c = await conversation(propertyId);
      const m = await guestMessage(c, new Date(now - (100 - i) * MIN));
      await heldItem(orgId, c, m, new Date(now - (99 - i) * MIN));
    }
    const held = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds: [propertyId], since: new Date(now - 30 * DAY), cap: 2 });
    expect(held).toHaveLength(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KÂHİN: ESKİ mantık (tavana ulaşmayan veride) saf işlev olarak burada saklı. Rastgele kurulan veride yeni yolun döndürdüğü özet
// eskisiyle BİREBİR aynı olmalı (süzgeci sorguya indirmek doğruluğu değiştirmez).
// ---------------------------------------------------------------------------

type OracleItem = {
  id: string;
  organizationId: string;
  conversationId: string;
  propertyId: string;
  channel: string;
  messageId: string;
  requestIndex: number;
  kind: string;
  sensitivity: string;
  riskType: string | null;
  status: string;
  createdAt: Date;
};
type OracleMessage = {
  id: string;
  conversationId: string;
  organizationId: string;
  direction: string;
  authorType: string | null;
  senderName: string;
  createdAt: Date;
};

const AI_SENDERS = new Set([...LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER]);

/** Eski `heldRequestsByConversation` + `stillOpenForHost` (09-26 → 11-17), tavansız; kapsamlı / gitmemiş cevap istisnası verisiz (boş). */
function oldHeldRequests(input: {
  organizationId: string;
  propertyIds: readonly string[];
  since: Date;
  excludeItemIds: readonly string[];
  items: readonly OracleItem[];
  messages: readonly OracleMessage[];
  stats?: { droppedByHost: number };
}): HeldRequestSummary[] {
  const rows = input.items
    .filter(
      (i) =>
        i.organizationId === input.organizationId &&
        (i.status === "open" || i.status === "pending_host") &&
        (i.sensitivity === "sensitive" || i.sensitivity === "emergency") &&
        i.createdAt >= input.since &&
        input.propertyIds.includes(i.propertyId) &&
        !input.excludeItemIds.includes(i.id),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.requestIndex - b.requestIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const convIds = new Set(rows.map((r) => r.conversationId));
  const hostAt = new Map<string, Date>();
  for (const m of input.messages) {
    if (!convIds.has(m.conversationId) || m.organizationId !== input.organizationId || m.direction !== "outbound") continue;
    if (!(m.authorType === "host" || (m.authorType === null && !AI_SENDERS.has(m.senderName)))) continue;
    const cur = hostAt.get(m.conversationId);
    if (!cur || m.createdAt > cur) hostAt.set(m.conversationId, m.createdAt);
  }
  const messageAt = new Map(input.messages.filter((m) => convIds.has(m.conversationId)).map((m) => [m.id, m.createdAt]));
  const out = new Map<string, HeldRequestSummary>();
  for (const r of rows) {
    const at = messageAt.get(r.messageId) ?? r.createdAt;
    const h = hostAt.get(r.conversationId);
    if (h && at < h) {
      if (input.stats) input.stats.droppedByHost++;
      continue;
    }
    const urgent = r.sensitivity === "emergency" || (r.riskType !== null && URGENT_RISK_TYPES.has(r.riskType));
    const cur = out.get(r.conversationId);
    if (!cur) {
      out.set(r.conversationId, {
        conversationId: r.conversationId,
        propertyId: r.propertyId,
        channel: r.channel,
        kinds: [r.kind as HeldRequestSummary["kinds"][number]],
        count: 1,
        emergency: r.sensitivity === "emergency",
        urgent,
        oldestAt: at,
      });
      continue;
    }
    cur.count++;
    if (!cur.kinds.includes(r.kind as HeldRequestSummary["kinds"][number])) cur.kinds.push(r.kind as HeldRequestSummary["kinds"][number]);
    if (r.sensitivity === "emergency") cur.emergency = true;
    if (urgent) cur.urgent = true;
    if (at < cur.oldestAt) cur.oldestAt = at;
  }
  return [...out.values()];
}

/** Tohumlu, tekrarlanabilir rastgele sayı (mulberry32). */
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

const KINDS = ["payment_invoice", "complaint_issue", "early_checkin", "late_checkout", "parking", "wifi"] as const;
const OUTBOUND_AUTHORS: { authorType: string | null; senderName: string }[] = [
  { authorType: "host", senderName: "Ev sahibi" },
  { authorType: "ai", senderName: "GuestOps AI" },
  { authorType: null, senderName: "GuestOps AI" },
  { authorType: null, senderName: "Lixus AI" },
  { authorType: null, senderName: LEGACY_AI_RESUME_SENDER },
  { authorType: null, senderName: "Ev sahibi" },
];

async function seedRandom(seed: number, now: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const a = await makeOrgWithProperty();
  const a2 = await prisma.property.create({ data: { organizationId: a.orgId, name: "Lale 2" } });
  const aOut = await prisma.property.create({ data: { organizationId: a.orgId, name: "Lale 3" } });
  const b = await makeOrgWithProperty();
  const targets: { orgId: string; propertyId: string }[] = [
    { orgId: a.orgId, propertyId: a.propertyId },
    { orgId: a.orgId, propertyId: a2.id },
    { orgId: a.orgId, propertyId: aOut.id },
    { orgId: b.orgId, propertyId: b.propertyId },
  ];
  let tick = 0;
  const itemIds: string[] = [];
  for (let ci = 0; ci < 24; ci++) {
    const t = pick(targets);
    const c = await conversation(t.propertyId);
    const guestCount = 1 + Math.floor(r() * 4);
    for (let g = 0; g < guestCount; g++) {
      // Pencerenin (30 gün) iki yanına düşen mesajlar.
      const msgAt = new Date(now - Math.floor(r() * 36 * DAY));
      const missing = r() < 0.1;
      const mId = missing ? `missing-${seed}-${ci}-${g}` : await guestMessage(c, msgAt);
      const kinds = [...KINDS].sort(() => r() - 0.5).slice(0, Math.floor(r() * 4));
      for (const [ri, kind] of kinds.entries()) {
        // Çoğunlukla mesajdan biraz SONRA kaydedilir; bazen saat kayması (mesaj kayıttan sonra görünür).
        // Kayma 10 dk ile sınırlı: aday süzgecinin payı (15 dk) içinde — payın kendisi yukarıdaki belirlenimci testte.
        const skew = r() < 0.15 ? -Math.floor(r() * 10 * MIN) : Math.floor(r() * 10 * MIN);
        const createdAt = new Date(msgAt.getTime() + skew + ++tick);
        const it = await prisma.conversationItem.create({
          data: {
            organizationId: t.orgId,
            conversationId: c,
            messageId: mId,
            requestIndex: ri,
            kind,
            sensitivity: pick(["none", "sensitive", "sensitive", "emergency"]),
            riskType: pick([null, null, "access_security", "safety_emergency", "payment_request"]),
            sources: "lexical",
            status: pick(["open", "pending_host", "pending_host", "answered", "done", "withdrawn"]),
            createdAt,
          },
        });
        itemIds.push(it.id);
      }
    }
    const outCount = Math.floor(r() * 4);
    for (let o = 0; o < outCount; o++) {
      const who = pick(OUTBOUND_AUTHORS);
      await prisma.message.create({
        data: { conversationId: c, direction: "outbound", body: "…", createdAt: new Date(now - Math.floor(r() * 36 * DAY)), ...who },
      });
    }
  }
  const excludeItemIds = itemIds.filter(() => r() < 0.1);
  return { orgId: a.orgId, propertyIds: [a.propertyId, a2.id], excludeItemIds };
}

async function oracleSnapshot() {
  const items = await prisma.conversationItem.findMany({ include: { conversation: { select: { propertyId: true, channel: true } } } });
  const messages = await prisma.message.findMany({ include: { conversation: { select: { property: { select: { organizationId: true } } } } } });
  return {
    items: items.map(
      (i): OracleItem => ({
        id: i.id,
        organizationId: i.organizationId,
        conversationId: i.conversationId,
        propertyId: i.conversation.propertyId,
        channel: i.conversation.channel,
        messageId: i.messageId,
        requestIndex: i.requestIndex,
        kind: i.kind,
        sensitivity: i.sensitivity,
        riskType: i.riskType,
        status: i.status,
        createdAt: i.createdAt,
      }),
    ),
    messages: messages.map(
      (m): OracleMessage => ({
        id: m.id,
        conversationId: m.conversationId,
        organizationId: m.conversation.property.organizationId,
        direction: m.direction,
        authorType: m.authorType,
        senderName: m.senderName,
        createdAt: m.createdAt,
      }),
    ),
  };
}

const byConv = (xs: HeldRequestSummary[]) => [...xs].sort((a, b) => (a.conversationId < b.conversationId ? -1 : 1));

const oracleStats = { droppedByHost: 0 };

describe("kâhin — yeni yol eski yolla aynı kümeyi döndürür", () => {
  beforeEach(async () => {
    await resetDb();
    alertSpy.mockClear();
  });

  for (const seed of [1, 7, 42, 2026, 31337]) {
    it(`tohum ${seed}`, async () => {
      const now = Date.now();
      const { orgId, propertyIds, excludeItemIds } = await seedRandom(seed, now);
      const since = new Date(now - 30 * DAY);
      const snap = await oracleSnapshot();
      const expected = oldHeldRequests({ organizationId: orgId, propertyIds, since, excludeItemIds, ...snap, stats: oracleStats });
      const actual = await heldRequestsByConversation(prisma, { organizationId: orgId, propertyIds, since, excludeItemIds });
      // Kâhin boş olmamalı (vakum değil): her tohum en az bir açık istek üretir.
      expect(expected.length).toBeGreaterThan(0);
      expect(byConv(actual)).toEqual(byConv(expected));
      expect(alertSpy).not.toHaveBeenCalled();
    });
  }

  it("vakum değil: tohumlar 'ev sahibi sonradan yazdı' ile düşen istek de üretti", () => {
    expect(oracleStats.droppedByHost).toBeGreaterThan(0);
  });
});
