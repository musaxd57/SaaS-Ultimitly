import { describe, it, expect, beforeEach } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { minimizeOldPaddleWebhooks, PADDLE_WEBHOOK_RAW_RETENTION_MONTHS } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// G6 (kurucu kararı 10-13 "1 yıl"; ACIK-ISLER 08-08 §15): Paddle olay kayıtlarının ham yükü (müşteri adı / e-postası / fatura adresi)
// yalnız hesap silinince küçülüyordu → silinmeyen müşterinin her ödeme olayı süresiz ham kalıyordu. Artık işlenmiş ve 12 aydan eski
// satır küçülür; olay kimliği, tür, durum, tarih ve finansal iskelet kalır. Hata / alınmış satırlara dokunulmaz.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-13T12:00:00Z");

function rawPayload(eventId: string) {
  return JSON.stringify({
    event_id: eventId,
    event_type: "subscription.updated",
    occurred_at: "2025-01-01T00:00:00Z",
    data: {
      id: "sub_01",
      status: "active",
      customer_id: "ctm_01",
      currency_code: "TRY",
      details: { totals: { grand_total: "89900" } },
      custom_data: { organizationId: "org_x" },
      customer: { name: "Ayse Yilmaz", email: "ayse@example.com" },
      address: { first_line: "Lale Sokak 5", city: "Istanbul", postal_code: "34000" },
      billing_details: { additional_information: "Vergi no 1234567890" },
    },
  });
}

async function row(eventId: string, opts: { monthsAgo: number; status?: string; provider?: string; payload?: string }) {
  return prisma.webhookEvent.create({
    data: {
      provider: opts.provider ?? "paddle",
      eventType: "subscription.updated",
      providerEventId: eventId,
      payloadJson: opts.payload ?? rawPayload(eventId),
      status: opts.status ?? "processed",
      createdAt: subMonths(NOW, opts.monthsAgo),
    },
  });
}

describe("minimizeOldPaddleWebhooks (G6)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("işlenmiş + 13 aylık satır küçülür: kişisel alanlar gider, iskelet kalır", async () => {
    const before = await row("evt_old", { monthsAgo: 13 });
    const r = await minimizeOldPaddleWebhooks(NOW);
    expect(r.minimized).toBe(1);

    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: before.id } });
    for (const pii of ["Ayse", "ayse@example.com", "Lale Sokak", "34000", "1234567890"]) {
      expect(after.payloadJson).not.toContain(pii);
    }
    // Kalanlar: tekrar koruması anahtarı, tür, durum, tarih (kolonlar) + finansal iskelet (yük).
    expect(after.providerEventId).toBe("evt_old");
    expect(after.eventType).toBe("subscription.updated");
    expect(after.status).toBe("processed");
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    const p = JSON.parse(after.payloadJson);
    expect(p).toMatchObject({
      event_id: "evt_old",
      event_type: "subscription.updated",
      data: { id: "sub_01", details: { totals: { grand_total: "89900" } }, custom_data: { organizationId: "org_x" } },
      note: "retention-1y",
    });
    expect(typeof p.redactedAt).toBe("string");
  });

  it("KONTROL: 11 aylık işlenmiş satır HENÜZ küçülmez (sınır kurucunun 12 ayı)", async () => {
    expect(PADDLE_WEBHOOK_RAW_RETENTION_MONTHS).toBe(12);
    const fresh = await row("evt_fresh", { monthsAgo: 11 });
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: fresh.id } })).payloadJson).toBe(rawPayload("evt_fresh"));
  });

  it("hata ve alınmış (işlenmemiş) satırlara DOKUNULMAZ — inceleme için ham kalır", async () => {
    const err = await row("evt_err", { monthsAgo: 24, status: "error" });
    const rec = await row("evt_rec", { monthsAgo: 24, status: "received" });
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: err.id } })).payloadJson).toBe(rawPayload("evt_err"));
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: rec.id } })).payloadJson).toBe(rawPayload("evt_rec"));
  });

  it("başka sağlayıcının satırı ve zaten küçültülmüş satır değişmez", async () => {
    const other = await row("evt_iyzico", { monthsAgo: 24, provider: "iyzico" });
    const already = JSON.stringify({ event_id: "evt_done", redactedAt: "2026-01-01T00:00:00.000Z", note: "kvkk-erasure" });
    const done = await row("evt_done", { monthsAgo: 24, payload: already });
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: other.id } })).payloadJson).toBe(rawPayload("evt_iyzico"));
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: done.id } })).payloadJson).toBe(already);
  });

  it("tekrar koşmak etkisiz; birikmiş geçmiş partiler hâlinde erir (500 + kalan)", async () => {
    await prisma.webhookEvent.createMany({
      data: Array.from({ length: 503 }, (_, i) => ({
        provider: "paddle",
        eventType: "transaction.completed",
        providerEventId: `evt_bulk_${i}`,
        payloadJson: rawPayload(`evt_bulk_${i}`),
        status: "processed",
        createdAt: subMonths(NOW, 14),
      })),
    });
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(500);
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(3);
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(0);
    expect(await prisma.webhookEvent.count({ where: { payloadJson: { contains: "ayse@example.com" } } })).toBe(0);
  });

  it("çözülemeyen yük de küçülür (ham metin kalmaz)", async () => {
    const bad = await row("evt_bad", { monthsAgo: 13, payload: "not json ayse@example.com" });
    expect((await minimizeOldPaddleWebhooks(NOW)).minimized).toBe(1);
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: bad.id } });
    expect(after.payloadJson).not.toContain("ayse@example.com");
    expect(JSON.parse(after.payloadJson)).toMatchObject({ note: "retention-1y", raw: "unparseable" });
  });
});
