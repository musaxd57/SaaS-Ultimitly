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
    expect(list.filter((s) => s.kind === "commitment").map((s) => s.title).sort()).toEqual([
      `Söz kaydet: Arıza / bakım · klima — ${WHEN}`,
      `Söz kaydet: Arıza / bakım · musluk — ${WHEN}`,
    ]);
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
    expect((await getConversationSuggestions(orgId, conv)).map((s) => s.title)).toEqual([`Söz kaydet: Arıza / bakım · musluk — ${WHEN}`]);
  });

  it("aynı konu iki mesajda → TEK söz (birleştirme amacı korunur); konusuz öneri mevcut konulu söze katılır, yeni görev YOK", async () => {
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
