import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  resetDb,
  makeOrgWithProperty,
  dropConversationIdentityUnique,
  restoreConversationIdentityUnique,
} from "../helpers/db";
import { cleanupDuplicateConversations } from "@/lib/conversations-cleanup";

// ---------------------------------------------------------------------------
// Y2 (Codex 10-07, 15c8663): ÇİFT KONUŞMA TEMİZLİĞİ, OKUMADAN SONRA GELEN ÖZGÜN MESAJI SİLMEZ — GERÇEK POSTGRESQL EŞZAMANLILIĞI.
//
// Temizlik kararını işlem dışı bir anlık görüntüyle veriyordu ("çift, tutulanın kapsamında"). Senkron o arada çift konuşmaya yeni bir
// misafir mesajı yazarsa eski kod mesajları silip konuşmayı siliyordu; Cascade yeni mesajı da götürüyordu ve sonuç `needsReview: 0`.
// Burada yarış GERÇEK bağlantılarla kurulur: ayrı bir işlem çift konuşmaya mesaj ekler ve COMMIT ETMEDEN bekler (yabancı anahtar
// denetimi konuşma satırında `FOR KEY SHARE` tutar); temizlik başlar ve kilitte beklediği `pg_stat_activity`den görülür; sonra ekleme
// commit edilir. Doğru sonuç: yeni mesaj YERİNDE, çift konuşma silinmez, incelemeye kalır.
// ---------------------------------------------------------------------------

beforeAll(dropConversationIdentityUnique);
afterAll(restoreConversationIdentityUnique);

async function makeConv(propertyId: string, bodies: string[], ids: string[]) {
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Emre",
      status: "new",
      externalReservationId: "res-SAME",
      lastMessageAt: new Date(),
      messages: {
        create: bodies.map((body, i) => ({
          direction: "inbound",
          senderName: "Emre",
          body,
          externalId: ids[i],
          createdAt: new Date(Date.now() + i * 1000),
        })),
      },
    },
    select: { id: true },
  });
}

async function waitForLockWaiter(timeoutMs = 8_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    if (Number(rows[0]?.n ?? 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("Y2 — çift konuşma temizliği ↔ eşzamanlı yeni mesaj (gerçek PG)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 okuma ile silme arasına giren özgün misafir mesajı KAYBOLMAZ; çift incelemeye kalır", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const dup = await makeConv(propertyId, ["Merhaba"], ["m-1"]);
    await makeConv(propertyId, ["Merhaba", "Anahtar?"], ["m-1", "m-2"]);

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let inserted: () => void = () => {};
    const insertedP = new Promise<void>((r) => (inserted = r));
    const inserter = prisma.$transaction(
      async (tx) => {
        await tx.message.create({
          data: { conversationId: dup.id, direction: "inbound", senderName: "Emre", body: "Otopark var mı?", externalId: "m-3" },
        });
        inserted();
        await gate;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await insertedP;

    const cleanup = cleanupDuplicateConversations(orgId);
    expect(await waitForLockWaiter()).toBe(true); // temizlik konuşma satırının kilidinde bekliyor
    release();
    await inserter;
    const res = await cleanup;

    expect(await prisma.message.count({ where: { externalId: "m-3" } })).toBe(1); // ⬅️ ARIZADA: Cascade ile silinmişti
    expect(await prisma.conversation.count({ where: { id: dup.id } })).toBe(1);
    expect(res).toMatchObject({ removed: 0, needsReview: 1 });
  });

  it("KONTROL: araya mesaj girmezse çift kopya yine silinir", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    const dup = await makeConv(propertyId, ["Merhaba"], ["m-1"]);
    await makeConv(propertyId, ["Merhaba", "Anahtar?"], ["m-1", "m-2"]);
    const res = await cleanupDuplicateConversations(orgId);
    expect(res).toMatchObject({ removed: 1, needsReview: 0 });
    expect(await prisma.conversation.count({ where: { id: dup.id } })).toBe(0);
  });
});
