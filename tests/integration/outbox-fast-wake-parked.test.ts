import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetOutboxKick, __setOutboxKickFollowUpMs, kickOutboxDrain } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Tur 7 T7-OB-3 (kurucu 11-05 "tamamını yap") — hızlı uyandırmanın boş tur tavanı (3) TALEBİ sayıyordu: alınıp hemen park edilen satır
// (bağlantı kopuk / anahtar reddedildi) her takip turunda sayacı sıfırlıyor, bağlantı kopukken dakikada bir SONSUZ uyanma oluyordu
// (çürütücü: 400 ms'de 77 tur, gecikme 5 ms). Artık ilerleme (gönderildi / düştü / iptal / engellendi / belirsiz …) sayılır.
// ---------------------------------------------------------------------------

describe("hızlı uyandırma — alınıp park edilen satır sonsuz tur doğurmaz (T7-OB-3)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetOutboxKick();
    vi.stubEnv("OUTBOX_FAST_WAKE", "1");
    __setOutboxKickFollowUpMs(5);
  });
  afterEach(() => {
    __resetOutboxKick();
    vi.unstubAllEnvs();
  });

  async function dueManualRow() {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Ayşe", channel: "airbnb", externalReservationId: "res-k" } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: c.id, channel: "airbnb", externalReservationId: "res-k", messageType: "manual", body: "x", idempotencyKey: "k-1", status: "pending", availableAt: new Date(Date.now() - 1000) },
    });
  }

  it("🚨 her turda 'alındı + park' dönen satır: tur sayısı tavanla sınırlı (1 + 3 boş takip)", async () => {
    await dueManualRow();
    let drains = 0;
    kickOutboxDrain(async () => {
      drains++;
      return { claimed: 1, sent: 0, failed: 0, ambiguous: 0, reconciled: 0, review: 0, retried: 1, canceled: 0, rateLimited: 0, blocked: 0 };
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(drains).toBeLessThanOrEqual(4);
  });

  it("KONTROL — gerçek ilerleme (gönderim) olan turlar takip zincirini sürdürür", async () => {
    await dueManualRow();
    let drains = 0;
    kickOutboxDrain(async () => {
      drains++;
      return { claimed: 1, sent: drains <= 6 ? 1 : 0, failed: 0, ambiguous: 0, reconciled: 0, review: 0, retried: 0, canceled: 0, rateLimited: 0, blocked: 0 };
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(drains).toBeGreaterThanOrEqual(7); // 6 ilerlemeli tur + boş takipler
  });
});
