import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// I1 (kurucu 10-17 "A", migration 73) — gerçek PostgreSQL: sözün KONUSU. Aynı saatte "klima" ve "musluk" sözü iki ayrı söz + iki görev; aynı
// konu iki mesajda tek söz; konusuz öneri mevcut söze katılır; konusuz ELLE söz + konulu öneri bugünkü gibi birleşir (sahiplenme kurucu sorusu Q1).
// Öneri listesi ile onay AYNI yüklemi kullanır (görünen öneri onayda "gone" dönmez).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/ai-suggestions/route";
import { getConversationSuggestions } from "@/lib/ai-suggestions/load";
import { createGuestCommitment } from "@/lib/guest-commitments";
import { commitmentDueAt } from "@/lib/guest-commitments-core";
import { orgTimezone } from "@/lib/timezone";

const decide = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  } as never);

let seq = 0;
async function asOwner(orgId: string) {
  const u = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u${++seq}-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "U", sessionEpoch: 0 } as SessionPayload;
  return u;
}

async function conversationWith(propertyId: string, hostBodies: string[]) {
  const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
  for (const [i, body] of hostBodies.entries()) {
    await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, createdAt: new Date(Date.now() - (10 - i) * 60_000) },
    });
  }
  return c.id;
}

/** "Yarın 10:00" — her test anında ileride (sabit "bugün" saati gece koşusunda geçmiş olurdu — zaman bombası dersi). */
const WHEN = "yarın 10:00";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("söz konusu", () => {
  it("🚨 aynı saatte 'klima' ve 'musluk' sözü → İKİ öneri, İKİ söz, İKİ görev (ESKİDE: tek söz, ikinci onay 'gone')", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const list = await getConversationSuggestions(orgId, conv);
    // Gün sözcüğü mesajın gününe göre ("yarın" ya da gece yarısını geçen koşuda "bugün") — Haiku 10-17 zaman bombası: saat ve konu sınanır.
    const titles = list.filter((s) => s.kind === "commitment").map((s) => s.title).sort();
    expect(titles).toHaveLength(2);
    expect(titles[0]).toMatch(/^Söz kaydet: Arıza \/ bakım · klima — (?:bugün|yarın) 10:00$/u);
    expect(titles[1]).toMatch(/^Söz kaydet: Arıza \/ bakım · musluk — (?:bugün|yarın) 10:00$/u);
    for (const s of list) expect((await decide({ key: s.key, decision: "approve" })).status).toBe(200);
    const rows = await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { topic: "asc" } });
    expect(rows.map((r) => r.topic)).toEqual(["ac", "faucet"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
    expect((await prisma.task.findMany({ where: { propertyId }, orderBy: { title: "asc" } })).map((t) => t.title)).toEqual([
      "Misafire söz: Arıza / bakım · klima",
      "Misafire söz: Arıza / bakım · musluk",
    ]);
  });

  it("🚨 klima sözü onaylandıktan sonra musluk önerisi listede KALIR (eskiden aynı tür + saat diye gizleniyordu)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const ac = (await getConversationSuggestions(orgId, conv)).find((s) => s.title.includes("klima"))!;
    expect((await decide({ key: ac.key, decision: "approve" })).status).toBe(200);
    const after = (await getConversationSuggestions(orgId, conv)).map((s) => s.title);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(/· musluk — /u);
  });

  it("aynı konu iki mesajda ve konusuz söz ('Teknisyen ... gelecek') mevcut konulu söze denk → listede görünmez (onayda aynı söze döneceği için); yeni söz / görev YOK", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const [first] = await getConversationSuggestions(orgId, conv);
    expect((await decide({ key: first!.key, decision: "approve" })).status).toBe(200);
    // Aynı konu tekrar + konusuz söz: ikisi de listede görünmez (onayda aynı söz döneceği için — ölü düğme yok).
    await prisma.message.create({
      data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: `Klimayı ${WHEN}'da teknisyen tamir edecek.` },
    });
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: `Teknisyen ${WHEN}'da gelecek.` } });
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("Q1 bekleniyor (bugünkü davranış pinli): konusuz ELLE söz + konulu öneri → birleşir, elle söze konu YAZILMAZ, öneri listede görünmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, tz, new Date())!;
    const manual = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "elle-1" });
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ topic: null });
  });

  it("🚨 eşzamanlı klima + musluk onayı → İKİ söz; aynı önerinin iki eşzamanlı onayı → TEK söz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const list = await getConversationSuggestions(orgId, conv);
    const statuses = (await Promise.all(list.map((s) => decide({ key: s.key, decision: "approve" })))).map((r) => r.status);
    expect(statuses).toEqual([200, 200]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(2);
    const conv2 = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const [only] = await getConversationSuggestions(orgId, conv2);
    const twice = (await Promise.all([decide({ key: only!.key, decision: "approve" }), decide({ key: only!.key, decision: "approve" })])).map((r) => r.status).sort();
    expect(twice).toEqual([200, 409]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv2 } })).toBe(1);
  });

  it("🚨 AYNI konunun iki ayrı mesajdaki önerisi EŞZAMANLI onaylanırsa → TEK söz, TEK görev; ikinci onay karar yazmaz (409) ve öneri listeden kalkar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Klimayı ${WHEN}'da teknisyen tamir edecek.`]);
    const list = (await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment");
    expect(list).toHaveLength(2);
    const statuses = (await Promise.all(list.map((s) => decide({ key: s.key, decision: "approve" })))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "ai_suggestion.approved" } })).toBe(1);
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
  });

  it("🚨 Haiku 10-17: ev sahibi saati DÜZENLEYİP mevcut uyumlu söze denk getirirse → onay mevcut söze bağlanır (200, yeni söz yok); öneri listeden kalkar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const elevenTomorrow = commitmentDueAt({ day: "tomorrow", time: "11:00" }, tz, new Date())!;
    const existing = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "ac", dueAt: elevenTomorrow, actorUserId: owner.id, clientRequestId: "x" });
    // Söz mesajdan ÖNCE kaydedilmiş olsun (liste kapısı 1 — "mesajdan sonra kaydedilen söz" — devreye girmesin; yalnız an farkı sınanır).
    await prisma.guestCommitment.update({ where: { id: existing.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    const [s] = (await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment");
    expect(s).toBeDefined(); // 10:00 önerisi 11:00 sözünden farklı an → görünür
    const res = await decide({ key: s!.key, decision: "approve", day: "tomorrow", time: "11:00" });
    expect(res.status).toBe(200); // ⬅️ ESKİDE 409 ve öneri kalıcı (her tık aynı ret)
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    const decision = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "ai_suggestion.approved" } });
    expect(decision.metadataJson).toContain('"merged":true');
    expect((await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("liste kapısı 1 (mesajdan SONRA kaydedilmiş söz) konu uyumuna bakar: klima sözü musluk önerisini GİZLEMEZ, klima önerisini gizler", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Musluk için usta ${WHEN}'da gelecek.`]);
    // Mesajdan SONRA, FARKLI saatte, klima konulu söz (öneri yolundan gelmiş gibi).
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "ac", dueAt: new Date(Date.now() + 30 * 3_600_000), actorUserId: owner.id, clientRequestId: "k1" });
    expect((await getConversationSuggestions(orgId, conv)).map((x) => x.title)).toEqual([expect.stringMatching(/· musluk — /u)]);
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "faucet", dueAt: new Date(Date.now() + 31 * 3_600_000), actorUserId: owner.id, clientRequestId: "k2" });
    expect((await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("KONTROL: elle form konusuz söz yazar (iki elle söz aynı saatte iki ayrı söz — kurucu D3 aynen)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const dueAt = new Date(Date.now() + 3 * 3_600_000);
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "a" });
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "b" });
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv } })).map((c) => c.topic)).toEqual([null, null]);
  });
});
