import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, enableAutoMessages } from "../helpers/db";

// ---------------------------------------------------------------------------
// Gönderim öncesi okuma (silme kapısı / kardeş satır) DB hatası verirse satır POST'suz GERİ bırakılır (Haiku 10-14). Eskiden satır
// "sending"de kalıyor, talep süresi dolunca "misafire ulaşmış olabilir" incelemesine düşüyordu — hiç gönderilmemiş mesaj için yanıltıcı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/erasure", async (orig) => {
  const actual = await orig<typeof import("@/lib/erasure")>();
  return { ...actual, loadErasureGuard: vi.fn(actual.loadErasureGuard) };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { loadErasureGuard } from "@/lib/erasure";
import { enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

describe("gönderim öncesi okuma hatası → satır geri bırakılır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 silme kapısı okunamadı → POST yok, satır 'pending' (deneme sayılmaz, inceleme yok); sonraki koşu gönderir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await enableAutoMessages(orgId);
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Burak",
        arrivalDate: new Date(Date.now() + 86_400_000),
        departureDate: new Date(Date.now() + 3 * 86_400_000),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-err",
      },
    });
    await enqueueProactive({
      organizationId: orgId,
      reservationId: reservation.id,
      externalReservationId: "res-err",
      channel: "airbnb",
      messageType: "welcome",
      body: "Hoş geldiniz",
      idempotencyKey: "welcome-err",
    });
    vi.mocked(loadErasureGuard).mockRejectedValueOnce(new Error("db down"));
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(0);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(0);
    expect(row.claimedBy).toBeNull();

    // Geri çekilme süresi geçince normal gider.
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { availableAt: new Date() } });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(1);
  });
});
