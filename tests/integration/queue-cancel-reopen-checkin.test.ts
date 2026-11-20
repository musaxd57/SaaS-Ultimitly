import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import { encryptSecret } from "@/lib/crypto-core";

// ---------------------------------------------------------------------------
// KUYRUK YOLU (G1 tur 3 bulgusu) — T3-B2'nin GİRİŞ MESAJI hâli + Girişler ekranının söylediği (konu 6).
//
// Kalıcı kuyruk açık. Giriş mesajı (kapı kodu taşıyabilir) kuyrukta beklerken rezervasyon iptal edilir → işçi satırı `reservation_cancelled`
// ile kalıcı iptal eder. Ev sahibi "Gerçekten etkin — yeniden aç" der. Gönderici her geçişte adayı görür, ön eleme (aynı anahtarlı, `pending`
// olmayan satır) düşürür → giriş mesajı HİÇ gitmez. Aynı anda Girişler ekranı "Otomatik giriş mesajı hazır" der ve elle gönderim düğmesi
// SUNMAZ (ekran yalnız `failed` / `canceled` OLMAYAN satırı "kuyrukta" sayar; iptal satırı gönderimi engellediği hâlde "gidecek" görünür).
// Ev sahibinin müdahale etmesi için bir işaret yok.
// DÜZELTİLDİ (11-20, `reservations/reopen.ts`): yeniden açma, YALNIZ `reservation_cancelled` ile iptal edilmiş yaşam döngüsü satırlarını
// bekleyen yapar; giriş mesajı yeniden açılan misafire gider.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueCheckins } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { reopenCancelledReservation } from "@/lib/reservations/reopen";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";

const REF = "res-reopen-checkin-1";

describe("kuyruk yolu — iptal → yeniden açma sonrası giriş mesajı + Girişler", () => {
  const sends: string[] = [];
  const send: OutboxSendFn = async (row) => {
    sends.push(row.id);
    return { ok: true, providerMessageId: `p${sends.length}` };
  };
  const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    sends.length = 0;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 yeniden açılan rezervasyona kuyruktaki giriş mesajı gider (Girişler 'hazır' dediği gibi)", async () => {
    // Saat dilimi UTC: `stayDay` (UTC günü) her saatte işletmenin günüyle aynı.
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
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: `s-${org.id}@x.test`, passwordHash: "x", role: "owner" } });
    const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" } });
    await seedAutoMessage(property.id, "checkin", "Merhaba {isim}, giriş bilgileriniz: kapı kodu 4821.");
    const r = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(1), departureDate: stayDay(3), channel: "airbnb", status: "confirmed", sourceReference: REF },
    });

    expect((await sendDueCheckins(org.id)).sent).toBe(1); // kuyruğa girdi
    await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } }); // kanal iptal etti
    await drain();
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("canceled");

    // Kanal rezervasyonu yeniden etkin gösterdi (satır iptal tutuldu) → ev sahibi yeniden açtı.
    await prisma.ingestEvent.create({
      data: { organizationId: org.id, provider: "hospitable", entityType: "reservation", entityId: r.id, kind: "reservation.updated", changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]) },
    });
    expect(await reopenCancelledReservation({ organizationId: org.id, actorUserId: owner.id, reservationId: r.id, via: "panel" })).toEqual({ ok: true });

    for (let i = 0; i < 3; i++) {
      await sendDueCheckins(org.id);
      await drain();
    }
    const list = await loadArrivalReadiness(org.id, new Date());
    const row = list.rows.find((x) => x.reservationId === r.id);
    const access = row?.readiness.factors.find((f) => f.key === "access") as { label: string; sendCheckin?: true } | undefined;
    const checkinSentAt = (await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).checkinSentAt;
    // Ekran artık doğruyu söyler: otomatik giriş mesajı GÖNDERİLDİ (eskiden "hazır" deyip hiç göndermiyordu).
    expect(access?.label).toMatch(/^Otomatik giriş mesajı gönderildi /);
    // Kuyruk kapalıyken olduğu gibi giriş mesajı gider (tek gönderim, damga dolu).
    expect({ sends: sends.length, stamped: checkinSentAt !== null }).toEqual({ sends: 1, stamped: true });
  });
});
