import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import { encryptSecret } from "@/lib/crypto-core";

// ---------------------------------------------------------------------------
// GİRİŞLER EKRANI × KUYRUKTA BAŞARISIZ GİRİŞ MESAJI (G1 tur 4 T4-B2, düzeltildi 11-20: `readiness-list` "queue_failed") — kalıcı kuyruk açık (`DURABLE_OUTBOX_ENABLED=1`) × Girişler ekranı (konu 1).
//
// Girişler'in "otomatik giriş mesajı" satırı gönderici GERÇEKTEN gönderecek mi diye bakar (Opus 11-06 N2), ama kuyruk satırının DURUMUNU
// okumaz (`readiness-list/load.ts` `autoCheckinStateOf`). Kuyrukta giriş mesajı kanal tarafından 6 kez kesin reddedilip `failed` olduktan
// sonra gönderici o rezervasyonu bir daha ASLA kuyruğa almaz (ön eleme: aynı anahtarlı, bekleyen OLMAYAN satır "sahipli",
// `automation.ts lifecycleUnusableIds`) — oysa ekran "Otomatik giriş mesajı hazır" der ve elle gönderim düğmesi SUNMAZ (düğme yalnız "gitmez"
// sebeplerinde çıkar). İşçinin yorumu da açık: yaşam döngüsü satırının hatası "hiçbir ev sahibi panelinde görünmez" (`signalOutboxStuck`,
// yalnız operatör kırıntısı). Sonuç: kapı kodu misafire hiç gitmez, ev sahibinin ekranı "hazır" der.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueCheckins } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";

describe("Girişler — kuyrukta başarısız kalan giriş mesajı 'hazır' görünmez, elle gönderim sunulur", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 satır `failed` → gönderici bir daha almaz; ekran 'gitmez' der ve elle gönderim düğmesi sunar", async () => {
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        timezone: "UTC",
        autoCheckin: true,
        autoCheckinEnabledAt: new Date(Date.now() - 30 * 86_400_000),
        aiSignature: "Lale",
        autoReplyHospitable: true,
        hospitableTokenEnc: encryptSecret("tok-readiness"),
      },
    });
    const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" } });
    await seedAutoMessage(property.id, "checkin", "Merhaba {isim}, giriş bilgileriniz: kapı kodu 4821.");
    const r = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(1), departureDate: stayDay(3), channel: "airbnb", status: "confirmed", sourceReference: "res-failed-1" },
    });

    expect((await sendDueCheckins(org.id)).sent).toBe(1);
    let attempts = 0;
    const reject: OutboxSendFn = async () => {
      attempts++;
      return { ok: false, error: "Hospitable API hatası (HTTP 400)" };
    };
    // Kanal her denemede kesin reddeder; geri çekilme beklemesi her turda "geçmiş" sayılır (deneme tavanına ulaşılır).
    for (let i = 0; i < 10; i++) {
      await prisma.messageOutbox.updateMany({ where: { organizationId: org.id, status: "pending" }, data: { availableAt: new Date(Date.now() - 1000) } });
      await drainOutboxOnce({ send: reject, tokenFor: async () => "t" });
    }
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(row.status).toBe("failed");

    // Sonraki gönderici + işçi geçişleri: hiç yeni deneme yok (satır "sahipli").
    const before = attempts;
    let sentLater = 0;
    for (let i = 0; i < 3; i++) {
      await sendDueCheckins(org.id);
      await drainOutboxOnce({ send: async () => (sentLater++, { ok: true, providerMessageId: "p" }), tokenFor: async () => "t" });
    }
    expect({ newAttempts: attempts - before, sentLater }).toEqual({ newAttempts: 0, sentLater: 0 });

    const list = await loadArrivalReadiness(org.id, new Date());
    const access = list.rows.find((x) => x.reservationId === r.id)?.readiness.factors.find((f) => f.key === "access") as
      | { label: string; sendCheckin?: true }
      | undefined;
    // Eskiden "Otomatik giriş mesajı hazır" + düğme yok (kapı kodu misafire hiç gitmiyor, ev sahibi bilmiyordu).
    expect({ label: access?.label, manualButton: access?.sendCheckin === true }).toEqual({
      label: "Otomatik giriş mesajı gitmez · giriş bilgisini siz gönderin",
      manualButton: true,
    });
  });
});
