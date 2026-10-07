import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Y1 (Codex 10-07, 15c8663): SİLİNEN MİSAFİRİN ÖZEL METNİ, TALEP EDİLMİŞ KUYRUK SATIRINDAN GİTMEZ.
//
// Talep bir partinin satırlarını gövdeleriyle belleğe alır; işçi onları SIRAYLA gönderir. Parti sürerken bir misafirin silme işlemi
// tamamlanırsa, o misafirin talep edilmiş (henüz POST'u başlamamış) satırının gövdesi `[ANON]` olur ama satır İPTAL EDİLMEZ (silme
// yalnız talepsiz satırları iptal eder). Eski işçi bellekteki ÖZEL metni gönderiyordu. Düzeltme: gövde POST'tan hemen önce talep
// altında yeniden okunur; silinmişse satır `erased` gerekçesiyle iptal edilir. Kanıt sağlayıcı casusuyla: hangi metin gitti.
// ---------------------------------------------------------------------------

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { eraseReservationData } from "@/lib/erasure";

async function seedGuest(orgId: string, propertyId: string, name: string, ref: string) {
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: name,
      arrivalDate: new Date(Date.now() + 86_400_000),
      departureDate: new Date(Date.now() + 3 * 86_400_000),
      status: "confirmed",
      sourceReference: ref,
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: name,
      status: "new",
      externalReservationId: ref,
      messages: { create: [{ direction: "inbound", senderName: name, body: "Merhaba" }] },
    },
  });
  return { reservationId: reservation.id, conversationId: conversation.id };
}

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const a = await seedGuest(orgId, propertyId, "Ayşe Yılmaz", "res-a");
  const b = await seedGuest(orgId, propertyId, "Bora Kaya", "res-b");
  const rowA = await enqueueOutbound({
    organizationId: orgId, conversationId: a.conversationId, channel: "airbnb", externalReservationId: "res-a",
    reservationId: a.reservationId, body: "Ayşe Hanım, kapı kodunuz 4821", senderName: "Host", authorType: "host",
    messageType: "manual", idempotencyKey: "ka",
  });
  // B'nin satırı A'dan SONRA kuyruklanır → aynı partide, A'nın POST'undan sonra işlenir.
  await new Promise((r) => setTimeout(r, 5));
  const rowB = await enqueueOutbound({
    organizationId: orgId, conversationId: b.conversationId, channel: "airbnb", externalReservationId: "res-b",
    reservationId: b.reservationId, body: "Bora Bey, kapı kodunuz 7730", senderName: "Host", authorType: "host",
    messageType: "manual", idempotencyKey: "kb",
  });
  return { orgId, a, b, rowA: rowA.outboxId, rowB: rowB.outboxId };
}

describe("Y1 — talep edilmiş satırın gövdesi POST'tan önce yeniden okunur", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 A gönderilirken B silinir → B'nin özel metni GİTMEZ, satır `erased` ile iptal", async () => {
    const s = await seed();
    const sent: string[] = [];
    const send = vi.fn<OutboxSendFn>(async (row) => {
      sent.push(row.body);
      if (row.id === s.rowA) await eraseReservationData(s.orgId, s.b.reservationId);
      return { ok: true, providerMessageId: `PROV-${row.id}` };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });

    expect(sent).toEqual(["Ayşe Hanım, kapı kodunuz 4821"]); // ⬅️ ARIZADA: "Bora Bey, kapı kodunuz 7730" de gidiyordu
    const b = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.rowB } });
    expect(b.status).toBe("canceled");
    expect(b.lastErrorCode).toBe("erased");
    expect(b.body).not.toContain("Bora");
  });

  it("KONTROL: silme yoksa iki satır da kendi metniyle gider", async () => {
    const s = await seed();
    const sent: string[] = [];
    const send = vi.fn<OutboxSendFn>(async (row) => {
      sent.push(row.body);
      return { ok: true, providerMessageId: `PROV-${row.id}` };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(sent.sort()).toEqual(["Ayşe Hanım, kapı kodunuz 4821", "Bora Bey, kapı kodunuz 7730"]);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.rowB } })).status).toBe("sent");
  });

  it("KONTROL: talepten önce silinen misafirin satırı zaten iptal (silme rotasının talepsiz dalı)", async () => {
    const s = await seed();
    await eraseReservationData(s.orgId, s.b.reservationId);
    const sent: string[] = [];
    const send = vi.fn<OutboxSendFn>(async (row) => {
      sent.push(row.body);
      return { ok: true, providerMessageId: `PROV-${row.id}` };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(sent).toEqual(["Ayşe Hanım, kapı kodunuz 4821"]);
  });
});
