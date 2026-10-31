import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue("reported") };
});

import { POST } from "@/app/api/webhooks/host-channel/whatsapp/route";
import { recordHostDeliveryStatuses, statusInstant } from "@/lib/host-channel/delivery-status";
import type { HostDeliveryStatus } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// TESLİM / OKUNDU DURUMU (tasarım §3.12, kurucu 10-31 hibrit acil akış). Gerçek veritabanı. Pinlenen: okundu / iletildi yazılır, EN ERKEN an
// kazanır (sıra / tekrar bağımsız), okundu önce gelirse iletildi de dolar, gönderimden önceki an gönderime kırpılır, 1970 / gelecek an şimdiye
// kırpılır, `updatedAt` / durum / sürüm DEĞİŞMEZ (düz mesaj kuralı updatedAt'e bakıyor), "failed" ayrı döner, yalnız durum taşıyan imzalı
// teslimat da işlenir (eskiden erken dönüşte atılıyordu).
// ---------------------------------------------------------------------------

const T0 = new Date("2026-10-31T08:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const st = (id: string, status: string, when: Date): HostDeliveryStatus => ({ providerMessageId: id, status, recipient: "905321112233", at: when, errorCode: null });

async function seedRow(providerMessageId = "wamid.A1") {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: `r-${property.id}`, status: "new" },
  });
  const row = await prisma.hostQuestion.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      kind: "alert",
      turnMessageId: "m1",
      status: "alerted",
      idempotencyKey: `alert:${providerMessageId}`,
      providerMessageId,
      sentAt: at(0),
      expiresAt: at(24 * 60),
    },
  });
  const old = new Date("2026-10-31T07:00:00.000Z");
  await prisma.$executeRaw`UPDATE "HostQuestion" SET "updatedAt" = ${old} WHERE id = ${row.id}`;
  return { id: row.id, old };
}
const row = (id: string) => prisma.hostQuestion.findUniqueOrThrow({ where: { id } });

describe("teslim / okundu durumu", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("statusInstant: geçersiz / 1970 / gelecek an ŞİMDİ olur; geçerli an aynen", () => {
    const now = at(10);
    expect(statusInstant(new Date(0), now)).toEqual(now);
    expect(statusInstant(new Date(Number.NaN), now)).toEqual(now);
    expect(statusInstant(at(30), now)).toEqual(now);
    expect(statusInstant(at(5), now)).toEqual(at(5));
  });

  it("iletildi → okundu yazılır; updatedAt / durum / sürüm DEĞİŞMEZ", async () => {
    const r = await seedRow();
    const before = await row(r.id);
    const out = await recordHostDeliveryStatuses([st("wamid.A1", "delivered", at(1)), st("wamid.A1", "read", at(3))], at(10));
    expect(out).toMatchObject({ recorded: 2, unmatched: 0, ignored: 0, failedIds: [] });
    const after = await row(r.id);
    expect(after.deliveredAt).toEqual(at(1));
    expect(after.readAt).toEqual(at(3));
    expect(after.updatedAt).toEqual(r.old);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });

  it("okundu önce gelirse iletildi de o anla dolar; sonra gelen daha GEÇ iletildi bir şeyi değiştirmez", async () => {
    const r = await seedRow();
    await recordHostDeliveryStatuses([st("wamid.A1", "read", at(2))], at(10));
    expect(await row(r.id)).toMatchObject({ readAt: at(2), deliveredAt: at(2) });
    const late = await recordHostDeliveryStatuses([st("wamid.A1", "delivered", at(4))], at(10));
    expect(late).toMatchObject({ recorded: 0, unmatched: 1 });
    expect(await row(r.id)).toMatchObject({ readAt: at(2), deliveredAt: at(2) });
  });

  it("en ERKEN an kazanır (tekrar / ters sıra), gönderimden önceki an gönderime kırpılır", async () => {
    const r = await seedRow();
    await recordHostDeliveryStatuses([st("wamid.A1", "read", at(5))], at(10));
    await recordHostDeliveryStatuses([st("wamid.A1", "read", at(3)), st("wamid.A1", "read", at(7))], at(10));
    expect((await row(r.id)).readAt).toEqual(at(3));
    await recordHostDeliveryStatuses([st("wamid.A1", "read", at(-30))], at(10));
    expect((await row(r.id)).readAt).toEqual(at(0));
  });

  it("🚨 1970 zaman damgası (eksik timestamp) 'zamanında okundu' yazmaz — şimdiye kırpılır", async () => {
    const r = await seedRow();
    await recordHostDeliveryStatuses([st("wamid.A1", "read", new Date(0))], at(12));
    expect((await row(r.id)).readAt).toEqual(at(12));
  });

  it("bilinmeyen kimlik eşleşmez; 'sent' yok sayılır; 'failed' ayrı döner ve satıra yazılmaz", async () => {
    const r = await seedRow();
    const out = await recordHostDeliveryStatuses(
      [st("wamid.YOK", "read", at(1)), st("wamid.A1", "sent", at(1)), st("wamid.A1", "failed", at(2))],
      at(10),
    );
    expect(out).toEqual({ recorded: 0, unmatched: 1, ignored: 1, failedIds: ["wamid.A1"] });
    expect(await row(r.id)).toMatchObject({ readAt: null, deliveredAt: null, status: "alerted" });
  });

  it("🚨 yalnız DURUM taşıyan imzalı teslimat rotada işlenir (eskiden 'mesaj yok' erken dönüşünde atılıyordu)", async () => {
    const APP_SECRET = "test-whatsapp-app-secret-0123456789";
    const PNID = "109876543210987";
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
    const r = await seedRow("wamid.R1");
    const ts = Math.floor(Date.now() / 1000) - 60;
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "905550000000", phone_number_id: PNID },
                statuses: [{ id: "wamid.R1", status: "read", timestamp: String(ts), recipient_id: "905321112233" }],
              },
            },
          ],
        },
      ],
    });
    const sig = `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
    const res = await POST(
      new NextRequest("https://www.lixusai.com/api/webhooks/host-channel/whatsapp", {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      }),
    );
    expect(res.status).toBe(200);
    const after = await row(r.id);
    expect(after.readAt?.getTime()).toBe(Math.max(ts * 1000, at(0).getTime()));
    expect(after.updatedAt).toEqual(r.old);
  });
});
