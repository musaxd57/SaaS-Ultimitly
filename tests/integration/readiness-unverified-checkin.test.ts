import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import { encryptSecret } from "@/lib/crypto-core";

// ---------------------------------------------------------------------------
// GİRİŞLER — KUYRUKTA GÖNDERİMİ DOĞRULANAMAYAN GİRİŞ MESAJI (G1 tur 5 T5-B2, 11-20; düzeltildi): T4-B2 düzeltmesinin (`2ae4ed4f`) kalan yanı.
//
// Düzeltme yalnız `failed` satırı "gitmez" yaptı. Gönderimi zaman aşımına uğrayıp uzlaştırmada görülemeyen satır `review` olur (mesaj misafire
// ulaşmış OLABİLİR); gönderici o rezervasyonu bir daha kuyruğa almaz (bekleyen olmayan satır = sahipli) ve elle gönderim düğmesi bilerek
// yoktur (çift gönderim riski). Girişler bu durumda yine "Otomatik giriş mesajı hazır" der — mesaj ne gönderilmeyi bekliyor ne de gönderildiği
// biliniyor. İşçi yorumu da `review` = "gönderilmiş OLABİLİR, kontrol edin" (`worker.ts` `applyFailureEffect(row, "ambiguous")`).
// Düzeltme: ayrı durum `unverified` — "gönderimi doğrulanamadı · konuşmayı kontrol edin", konuşmaya bağlantı, elle gönderim düğmesi YOK.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueCheckins } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";

describe("G1 tur 5 repro — kuyrukta sonucu belirsiz giriş mesajı, Girişler", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 satır `review` (gitmiş olabilir) → ekran 'hazır' DEMEZ: 'doğrulanamadı · konuşmayı kontrol edin', düğme yok", async () => {
    const org = await prisma.organization.create({
      data: {
        name: "Org", timezone: "UTC", autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 30 * 86_400_000), aiSignature: "Lale",
        autoReplyHospitable: true, hospitableTokenEnc: encryptSecret("tok-readiness"),
      },
    });
    const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" } });
    await seedAutoMessage(property.id, "checkin", "Merhaba {isim}, giriş bilgileriniz: kapı kodu 4821.");
    const r = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(1), departureDate: stayDay(3), channel: "airbnb", status: "confirmed", sourceReference: "res-review-1" },
    });
    expect((await sendDueCheckins(org.id)).sent).toBe(1);
    const timeout: OutboxSendFn = async () => ({ ok: false, error: "network_or_timeout: The operation was aborted" });
    const notSeen = async () => ({ found: false as const, evidence: "not_seen" as const });
    for (let i = 0; i < 10; i++) {
      await prisma.messageOutbox.updateMany({ where: { organizationId: org.id, status: { in: ["pending", "ambiguous"] } }, data: { availableAt: new Date(Date.now() - 1000) } });
      await drainOutboxOnce({ send: timeout, tokenFor: async () => "t", reconcile: notSeen });
    }
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("review");

    const list = await loadArrivalReadiness(org.id, new Date());
    const access = list.rows.find((x) => x.reservationId === r.id)?.readiness.factors.find((f) => f.key === "access") as
      | { label: string; sendCheckin?: true; link?: { to: string } }
      | undefined;
    // Gönderimi doğrulanamamış mesaj için ekran "hazır" (= gönderilecek) demez; gitmiş olabileceği için elle gönderim düğmesi de yok.
    expect(access?.label ?? "", `Girişler etiketi: "${access?.label}"`).not.toMatch(/^Otomatik giriş mesajı hazır/);
    expect(access?.label).toBe("Otomatik giriş mesajının gönderimi doğrulanamadı · konuşmayı kontrol edin");
    expect(access?.sendCheckin).toBeUndefined();
    expect(access?.link).toEqual({ to: "conversation" });
  });
});
