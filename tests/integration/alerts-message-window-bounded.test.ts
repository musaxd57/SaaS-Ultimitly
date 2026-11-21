import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// `sendDueAlerts` — ADAY KONUŞMALARIN MESAJ PENCERESİ SINIRLI OKUNUR (O1 optimizasyonu, 11-19).
//
// Uyarı geçişi her 2 dakikada işletme başına 100'e kadar aday konuşmanın son `HISTORY_MESSAGE_CAP` (25) mesajına bakar. Bu pencere
// `findMany({ select: { messages: { take: 25 } } })` ile okunuyordu ve Prisma iç içe `take`i BİRDEN ÇOK ebeveynde SQL'e İNDİRMEZ: aday
// konuşmaların BÜTÜN mesajları bütün kolonlarıyla okunup bellekte kesiliyordu (ölçüldü: `… IN ($1,$2,$3) ORDER BY "createdAt" DESC
// OFFSET $4` — LIMIT yok). Uzun thread'de her geçişte sınırsız okuma. Artık konuşma başına `LIMIT` (tek sorgu, `(conversationId,
// createdAt)` dizini), yalnız kararın okuduğu kolonlar.
//
// Eşdeğerlik: eski okuma (Prisma iç içe seçim) bu dosyada KÂHİN olarak durur; her konuşmanın penceresi (sıra + alanlar) birebir aynı.
// Eşit `createdAt` arasında sıra iki yolda da TANIMSIZDIR (ikinci sıralama anahtarı yok — eski davranış); fikstür eşitsiz anlar kullanır.
// ---------------------------------------------------------------------------

const counter = vi.hoisted(() => ({ on: false, rows: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on(e: string, cb: (e: { query: string }) => void): void }).$on("query", (e) => {
    if (counter.on) counter.rows.push(e.query);
  });
  return { prisma: client };
});
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { prisma, resetDb, makeOrgWithProperty, makeUser } from "../helpers/db";
import { flushQueryEvents } from "../helpers/query-event-barrier";
import { latestMessagesByConversation, sendDueAlerts } from "@/lib/automation";
import { HISTORY_MESSAGE_CAP } from "@/lib/ai/limits";

const MIN = 60_000;

/** KÂHİN: değişiklikten önceki okuma — aynı iç içe seçim (yalnız mesaj alanı). */
async function oracleWindows(ids: string[]) {
  const rows = await prisma.conversation.findMany({
    where: { id: { in: ids } },
    select: { id: true, messages: { orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGE_CAP } },
  });
  return new Map(rows.map((r) => [r.id, r.messages]));
}

const pick = (m: { id: string; direction: string; body: string; createdAt: Date; authorType: string | null; ingestedAt: Date | null }) => ({
  id: m.id,
  direction: m.direction,
  body: m.body,
  createdAt: m.createdAt,
  authorType: m.authorType,
  ingestedAt: m.ingestedAt,
});

async function seedConversation(propertyId: string, n: number, opts: { lastAt: Date; tag: string; lastDirection?: "inbound" | "outbound" }) {
  const conv = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: `Misafir ${opts.tag}`, status: "new", priority: "standard", lastMessageAt: opts.lastAt },
  });
  if (n > 0) {
    await prisma.message.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const newest = i === n - 1;
        const inbound = newest ? opts.lastDirection !== "outbound" : i % 3 !== 1;
        return {
          conversationId: conv.id,
          direction: inbound ? "inbound" : "outbound",
          authorType: inbound ? "guest" : i % 3 === 1 && i % 2 === 0 ? "automation" : "host",
          senderName: inbound ? "Misafir" : "Ev sahibi",
          body: `${opts.tag} mesaj ${i}`,
          aiSuggestedReply: inbound ? "taslak" : null,
          createdAt: new Date(opts.lastAt.getTime() - (n - 1 - i) * MIN),
          ingestedAt: i % 4 === 0 ? null : new Date(opts.lastAt.getTime() - (n - 1 - i) * MIN + 500),
        };
      }),
    });
  }
  return conv.id;
}

describe("latestMessagesByConversation — eski iç içe okumayla birebir pencere", () => {
  beforeEach(resetDb);

  it("🚨 0 / 1 / 24 / 25 / 26 / 80 / 300 mesajlı konuşmalar: her pencere (sıra + alanlar) kâhinle aynı", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const now = Date.now();
    const sizes = [0, 1, 24, 25, 26, 80, 300];
    const ids: string[] = [];
    for (const [i, n] of sizes.entries()) ids.push(await seedConversation(propertyId, n, { lastAt: new Date(now - i * 7 * MIN), tag: `k${i}` }));
    const oracle = await oracleWindows(ids);
    const got = await latestMessagesByConversation(ids, HISTORY_MESSAGE_CAP);
    for (const id of ids) {
      expect((got.get(id) ?? []).map(pick)).toEqual((oracle.get(id) ?? []).map(pick));
    }
    // Anti-vakum: uzun thread'ler gerçekten kesildi, kısa olanlar olduğu gibi.
    expect(got.get(ids[6])).toHaveLength(HISTORY_MESSAGE_CAP);
    expect(got.get(ids[2])).toHaveLength(24);
    expect(got.has(ids[0])).toBe(false);
  });

  it("tek konuşma (Prisma'nın LIMIT indirdiği yol) ve tekrarlanan kimlik: pencere aynı, satır çiftlenmez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const id = await seedConversation(propertyId, 40, { lastAt: new Date(), tag: "tek" });
    const oracle = await oracleWindows([id]);
    const got = await latestMessagesByConversation([id, id], HISTORY_MESSAGE_CAP);
    expect((got.get(id) ?? []).map(pick)).toEqual((oracle.get(id) ?? []).map(pick));
  });

  it("boş liste: sorgu atılmaz", async () => {
    counter.rows = [];
    counter.on = true;
    const got = await latestMessagesByConversation([], HISTORY_MESSAGE_CAP);
    await flushQueryEvents(prisma, counter); // geç gelen olay da sayılsın ("sorgu yok" iddiası boş kalmasın)
    counter.on = false;
    expect(got.size).toBe(0);
    expect(counter.rows).toHaveLength(0);
  });
});

describe("sendDueAlerts — mesaj okuması sınırlı", () => {
  beforeEach(resetDb);

  it("🚨 birden çok aday konuşmada her Message okuması konuşma başına LIMIT taşır (eskiden: bütün thread'ler, LIMIT yok); sorgu sayısı aynı", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeUser({ data: { organizationId: orgId, email: "sahip@example.test", name: "Sahip", passwordHash: "x" } });
    const now = Date.now();
    // Son mesajı ev sahibinden olan uzun thread'ler (uyarı yok — yalnız okuma sınanır) + bir Sorunlu (işaretli) konuşma.
    for (let i = 0; i < 3; i++) await seedConversation(propertyId, 60, { lastAt: new Date(now - i * MIN), tag: `a${i}`, lastDirection: "outbound" });
    const flaggedId = await seedConversation(propertyId, 60, { lastAt: new Date(now - 9 * MIN), tag: "f", lastDirection: "outbound" });
    await prisma.conversation.update({ where: { id: flaggedId }, data: { status: "problem", skippedReason: "complaint" } });

    counter.rows = [];
    counter.on = true;
    const res = await sendDueAlerts(orgId);
    await flushQueryEvents(prisma, counter); // son sorgunun olayı sonuçtan sonra gelebilir (CI 1841)
    counter.on = false;
    expect(res.alerted).toBe(0);
    const messageReads = counter.rows.filter((q) => /FROM\s+"(?:public"\.")?Message"/i.test(q) && /^\s*SELECT/i.test(q));
    expect(messageReads.length).toBe(2); // aday + işaretli küme (eskisi gibi iki okuma)
    for (const q of messageReads) expect(q).toMatch(/LIMIT/i);
    // Toplam sorgu: org · kullanıcı · (konuşma · mülk · mesaj) × 2 — eskiyle aynı.
    expect(counter.rows).toHaveLength(8);
  });

  it("davranış aynı: uzun thread'in 25'lik penceresindeki cevapsız şikâyet uyarılır, pencerenin dışındaki eski şikâyet uyarılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeUser({ data: { organizationId: orgId, email: "sahip@example.test", name: "Sahip", passwordHash: "x" } });
    const now = Date.now();
    // A: 40 mesaj, en yenisi cevapsız şikâyet → uyarılır.
    const a = await seedConversation(propertyId, 40, { lastAt: new Date(now - MIN), tag: "A" });
    await prisma.message.updateMany({ where: { conversationId: a, body: "A mesaj 39" }, data: { body: "Daire çok kirli, kabul edilemez!" } });
    // B: 40 mesaj; şikâyet 30. sırada (pencerenin dışında), sonrası zararsız misafir mesajları ve EN YENİSİ ev sahibi cevabı → uyarı yok.
    const b = await seedConversation(propertyId, 40, { lastAt: new Date(now - 2 * MIN), tag: "B", lastDirection: "outbound" });
    await prisma.message.updateMany({ where: { conversationId: b, body: "B mesaj 5" }, data: { body: "Daire çok kirli, kabul edilemez!" } });
    const res = await sendDueAlerts(orgId);
    expect(res.alerted).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: a } })).status).toBe("problem");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: b } })).status).toBe("new");
  });
});
