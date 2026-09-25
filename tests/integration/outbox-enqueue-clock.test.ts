import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import { __setOutboundAdapterForTest } from "@/lib/channels";
import { enqueueOutbound, enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { resetPrimaryOrgCache, setOrgHospitableToken } from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// KUYRUK VADE KAPISI TEK SAAT (ENQUEUE_CLOCK, CI #1170 09-25). Worker `availableAt <= now` kıyasını KENDİ (JS) saatiyle
// yapar; satır da aynı saatle damgalanmalı. Şema varsayılanı başka saattendir ve timestamp(3)'e YUVARLANIR, JS saati
// milisaniyeye TABANLANIR → aynı milisaniyedeki enqueue + drain satırı "vadesi gelmedi" gösterip teslim etmiyordu
// (`outbox-connection` rastgele kırmızı, Railway yayını atladı). Belirlenimci sınama: JS saati 5 sn GERİDE — şema
// varsayılanıyla damgalanan satır bu drain'de hiç alınmaz.
// ---------------------------------------------------------------------------
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));

const fake = new FakeOutboundProvider();
const RES = "res-clock-1";
const row = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ayşe",
      arrivalDate: new Date(Date.now() + 2 * 86_400_000),
      departureDate: new Date(Date.now() + 4 * 86_400_000),
      status: "confirmed",
      sourceReference: RES,
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ayşe", status: "waiting", externalReservationId: RES },
  });
  await setOrgHospitableToken(orgId, "PAT-A", null);
  fake.registerReservation(RES, "PAT-A");
  return { orgId, reservationId: reservation.id, conversationId: conversation.id };
}

/** JS saati veritabanının 5 sn gerisinde: yalnız `Date` sahte (Prisma'nın zamanlayıcılarına dokunulmaz). */
function jsClockBehind() {
  const real = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(real - 5_000));
}

describe("kuyruk vade kapısı — enqueue ile worker aynı saat", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    fake.reset();
    __setOutboundAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => {
    vi.useRealTimers();
    __setOutboundAdapterForTest("hospitable", null);
  });

  it("🚨 cevap satırı: aynı saatle hemen koşan drain teslim eder", async () => {
    const { orgId, conversationId } = await seed();
    jsClockBehind();
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: RES, reservationId: null,
      body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "k-clock",
    });
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
  });

  it("🚨 yaşam döngüsü satırı (karşılama): aynı saatle hemen koşan drain teslim eder", async () => {
    const { orgId, reservationId } = await seed();
    jsClockBehind();
    const { outboxId } = await enqueueProactive({
      organizationId: orgId, externalReservationId: RES, reservationId, channel: "airbnb", messageType: "welcome",
      body: "Hoş geldiniz", idempotencyKey: "w-clock",
    });
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
  });

  it("KONTROL: vade kapısı hâlâ çalışır — geleceğe ertelenmiş satır bu drain'de alınmaz", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: RES, reservationId: null,
      body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "k-later",
    });
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { availableAt: new Date(Date.now() + 60_000) } });
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(0);
    expect(await row(outboxId)).toMatchObject({ status: "pending" });
  });
});
