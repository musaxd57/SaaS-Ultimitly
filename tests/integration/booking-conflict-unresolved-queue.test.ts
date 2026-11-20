import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// SERT KONTROL 11-20 A1 (düzeltildi): "Otomatik gönderim durduruldu" yüklemi kuyruk sahipliğini okur (kuyruk AÇIK) — göndericinin kendi
// ön elemesi `lifecycleUnusableIds`. Repro inceleyicinin, kırmızısı `scratchpad/codex-1117/sert-kontrol-1120/repro-kirmizi.txt`.
// Giriş mesajı kuyrukta gönderilmiş ama kanalda doğrulanamamış (`review` — misafire GİTMİŞ OLABİLİR); sonra elle kopya eklenince
// rezervasyon iki dairede görünür. Yüklem "durduruldu" der; oysa tutma kalksa da gönderici bu rezervasyonu kuyruğa yeniden vermez
// (`lifecycleUnusableIds` owned), işçi de `review` satırını göndermez → tutma hiçbir şeyi durdurmuyor.

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
  getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
}));

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { sendDueCheckins } from "@/lib/automation";
import { getConnectionInfo } from "@/lib/hospitable-credentials";

describe("A1 — kuyruk açıkken doğrulanamayan (review) giriş mesajı + sonradan kopya", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("yüklem 'durduruldu' DEMEZ (tutma kalkınca da gönderici hiçbir şey kuyruğa vermez)", async () => {
    const org = await prisma.organization.create({
      data: { name: "Org", timezone: "Europe/Istanbul", aiSignature: "Lale", autoCheckin: true, autoCheckinEnabledAt: new Date(0) },
    });
    const lale3 = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3", createdAt: PROPERTY_EXISTED_BEFORE } });
    const lale5 = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 5", createdAt: PROPERTY_EXISTED_BEFORE } });
    await seedAutoMessage(lale3.id, "checkin", "Merhaba {isim}, giriş metni.");
    const row = await prisma.reservation.create({
      data: {
        propertyId: lale3.id, guestName: "Ada Lale", arrivalDate: stayDay(2), departureDate: stayDay(5), status: "confirmed",
        sourceReference: "HM-1", channel: "airbnb", guestNameSource: "channel",
      },
    });
    // 1) Tek daire: gönderici kuyruğa verir.
    expect((await sendDueCheckins(org.id)).sent).toBe(1);
    const ob = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id, messageType: "checkin" } });
    // 2) İşçi gönderdi, zaman aşımı, kanalda doğrulanamadı → `review` (damga YOK — sahte "gönderildi" yazılmaz).
    await prisma.messageOutbox.update({ where: { id: ob.id }, data: { status: "review", lastErrorKind: "ambiguous" } });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).checkinSentAt).toBeNull();
    // 3) Ev sahibi aynı rezervasyonu yanlışlıkla Lale 5'e elle ekledi → iki dairede.
    const copy = await prisma.reservation.create({
      data: {
        propertyId: lale5.id, guestName: "Ada Lale", arrivalDate: stayDay(2), departureDate: stayDay(5), status: "confirmed",
        sourceReference: "HM-1", channel: "manual", guestNameSource: "host",
      },
    });
    const said = (await autoSendStoppedByConflict({ organizationId: org.id, refs: ["HM-1"], now: new Date() })).has("HM-1");
    // 4) Tutma kalksa: gönderici yeni satır açmaz / var olanı canlandırmaz, kuyrukta gönderilecek satır yok.
    await prisma.reservation.delete({ where: { id: copy.id } });
    await sendDueCheckins(org.id);
    const pending = await prisma.messageOutbox.count({ where: { organizationId: org.id, messageType: "checkin", status: "pending" } });
    const wouldSend = pending > 0;
    expect({ said, wouldSend }).toEqual({ said: wouldSend, wouldSend });
  });
});

// A1-b (düzeltildi): Girişler — `review` (gitmiş olabilir) satırı olan rezervasyon iki dairede görünse de "doğrulanamadı" kalır; eskiden
// "iki dairede kayıtlı, otomatik mesaj gitmez · giriş bilgisini siz gönderin" yazılır (sıra: two_properties, unverified'dan ÖNCE).
// A1-c: `ambiguous` (uzlaştırma bekliyor, gitmiş olabilir) satırında ekran "hazır" der.
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { encryptSecret } from "@/lib/crypto-core";

describe("A1-b/c — Girişler, gitmiş olabilecek giriş mesajı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function setup() {
    const org = await prisma.organization.create({
      data: {
        name: "Org", timezone: "UTC", autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 30 * 86_400_000), aiSignature: "Lale",
        autoReplyHospitable: true, hospitableTokenEnc: encryptSecret("tok-readiness"),
      },
    });
    const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" } });
    const other = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 5", checkInTime: "15:00", checkOutTime: "11:00" } });
    await seedAutoMessage(property.id, "checkin", "Merhaba {isim}, giriş bilgileriniz: kapı kodu 4821.");
    const r = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(1), departureDate: stayDay(3), channel: "airbnb", status: "confirmed", sourceReference: "res-review-1" },
    });
    expect((await sendDueCheckins(org.id)).sent).toBe(1);
    return { org, property, other, r };
  }
  const timeout: OutboxSendFn = async () => ({ ok: false, error: "network_or_timeout: The operation was aborted" });
  const notSeen = async () => ({ found: false as const, evidence: "not_seen" as const });
  const accessOf = async (orgId: string, rid: string) =>
    (await loadArrivalReadiness(orgId, new Date())).rows.find((x) => x.reservationId === rid)?.readiness.factors.find((f) => f.key === "access") as
      | { label: string; sendCheckin?: true }
      | undefined;

  it("A1-b: review + sonradan elle kopya → 'siz gönderin' DENMEZ (gitmiş olabilir)", async () => {
    const { org, other, r } = await setup();
    for (let i = 0; i < 10; i++) {
      await prisma.messageOutbox.updateMany({ where: { organizationId: org.id, status: { in: ["pending", "ambiguous"] } }, data: { availableAt: new Date(Date.now() - 1000) } });
      await drainOutboxOnce({ send: timeout, tokenFor: async () => "t", reconcile: notSeen });
    }
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("review");
    await prisma.reservation.create({
      data: { propertyId: other.id, guestName: "Bircan", arrivalDate: stayDay(1), departureDate: stayDay(3), channel: "manual", status: "confirmed", sourceReference: "res-review-1" },
    });
    const access = await accessOf(org.id, r.id);
    expect(access?.label).toBe("Otomatik giriş mesajının gönderimi doğrulanamadı · konuşmayı kontrol edin");
  });

  it("A1-c: ilk zaman aşımından sonra (ambiguous, uzlaştırma bekliyor) → ekran 'hazır' DEMEZ", async () => {
    const { org, r } = await setup();
    await prisma.messageOutbox.updateMany({ where: { organizationId: org.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await drainOutboxOnce({ send: timeout, tokenFor: async () => "t", reconcile: notSeen });
    const st = (await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } })).status;
    const access = await accessOf(org.id, r.id);
    expect({ st, label: access?.label }).toEqual({ st, label: expect.not.stringMatching(/^Otomatik giriş mesajı hazır/) });
  });
});
