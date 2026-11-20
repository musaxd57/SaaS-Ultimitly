import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// OTOMATİK MESAJ — KUYRUK YOLU ↔ DOĞRUDAN YOL EŞİTLİĞİ (F-1 adım 1, karakterizasyon; kurucu 11-20 sabah: "F-1'de doğrudan yol ile kuyruk
// arasında misafire giden bir fark bulunursa, yeni davranışa karar vermeden önce örneğini bana gösterin").
//
// Bu gece dört hata aynı sınıftan çıktı: gönderilip gönderilmeme kuralı göndericinin aday sorgusunda VE kuyruk işçisinin gönderim anı
// vetosunda ayrı yazılı; biri değişince öteki ayrışıyor (T3-B2 iptal → yeniden açma, T3-B3 uzayan çıkış, T4-B1 kapalı dönem sonrası bayat
// mesaj, H4-7 silinip geri gelen kayıt). F-1'in tek karar fonksiyonuna geçmeden ÖNCE bugünkü davranış bu matrisle sabitlenir: her hücrede aynı
// rezervasyon değişikliği iki yolda yaşanır, misafire giden (gönderim sayısı + metin) AYNI olmalı. Kuyruk kolunda satır değişiklikten ÖNCE
// kuyruğa girer (gerçek sıra), sonra değişiklik, sonra işçi + gönderici geçişleri. Temel: G1 tur 4 sondası (7 hücre).
// Saat: yalnız `Date` sahte (işletme UTC, bugün 09:00 — çıkış göndericisinin 08:00–11:59 penceresi içinde); zamanlayıcılar gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueCheckins, sendDueCheckouts, sendDueWelcomes } from "@/lib/automation";
import { drainOutboxOnce } from "@/lib/outbox/worker";

type Kind = "welcome" | "checkin" | "checkout";
type Seeded = { orgId: string; reservationId: string; p2: string };
type Change = (s: Seeded) => Promise<void>;

/** Bugün 09:00 UTC (işletme UTC). */
function morningToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 9, 0));
}

async function seed(kind: Kind): Promise<Seeded> {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone: "UTC",
      autoWelcome: true,
      autoWelcomeEnabledAt: new Date(0),
      autoCheckin: true,
      autoCheckinEnabledAt: new Date(0),
      autoCheckout: true,
      autoCheckoutEnabledAt: new Date(0),
      aiSignature: "Lale",
      autoReplyHospitable: true,
    },
  });
  const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
  const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
  for (const [p, code] of [[p1.id, "1111"], [p2.id, "2222"]] as const) {
    await seedAutoMessage(p, "welcome", `Hoş geldiniz ${code}`);
    await seedAutoMessage(p, "checkin", `Kapı kodu ${code}`);
    await seedAutoMessage(p, "checkout", `Bugün çıkış gününüz ${code}`);
  }
  // Çıkış hücrelerinde konaklama bugün biter; ötekilerde iki gün sonra başlar.
  const dates = kind === "checkout" ? { arrivalDate: stayDay(-2), departureDate: stayDay(0) } : { arrivalDate: stayDay(2), departureDate: stayDay(4) };
  const r = await prisma.reservation.create({
    data: { propertyId: p1.id, guestName: "Bircan", ...dates, channel: "airbnb", status: "confirmed", sourceReference: "res-m" },
  });
  return { orgId: org.id, reservationId: r.id, p2: p2.id };
}

const sender = (k: Kind) => (k === "welcome" ? sendDueWelcomes : k === "checkin" ? sendDueCheckins : sendDueCheckouts);

const norm = (s: string) => s.replace(/\n+/g, " | ");

async function directPath(kind: Kind, change: Change): Promise<string[]> {
  const s = await seed(kind);
  await change(s);
  for (let i = 0; i < 2; i++) await sender(kind)(s.orgId);
  return vi.mocked(sendOnChannel).mock.calls.map((c) => norm(String(c[1])));
}

async function queuePath(kind: Kind, change: Change): Promise<string[]> {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  const s = await seed(kind);
  await sender(kind)(s.orgId); // değişiklikten ÖNCE kuyruğa girdi
  await change(s);
  const bodies: string[] = [];
  for (let i = 0; i < 3; i++) {
    await drainOutboxOnce({
      send: async (row) => {
        bodies.push(norm(row.body));
        return { ok: true, providerMessageId: `p${bodies.length}` };
      },
      tokenFor: async () => "t",
    });
    await sender(kind)(s.orgId);
  }
  return bodies;
}

const update = (s: Seeded, data: Record<string, unknown>) => prisma.reservation.update({ where: { id: s.reservationId }, data }).then(() => undefined);

const copyTo = async (s: Seeded, channel: string) => {
  const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
  await prisma.reservation.create({
    data: { propertyId: s.p2, guestName: r.guestName, arrivalDate: r.arrivalDate, departureDate: r.departureDate, channel, status: "confirmed", sourceReference: r.sourceReference },
  });
};

const CELLS: { name: string; kind: Kind; change: Change }[] = [
  // G1 tur 4'ün yedi hücresi.
  { name: "giriş × varış İLERİ (+10 gün, pencere dışı)", kind: "checkin", change: (s) => update(s, { arrivalDate: stayDay(12), departureDate: stayDay(14) }) },
  { name: "giriş × varış GERİ (yarın)", kind: "checkin", change: (s) => update(s, { arrivalDate: stayDay(1) }) },
  { name: "giriş × daire değişimi (aynı satır öteki daireye)", kind: "checkin", change: (s) => update(s, { propertyId: s.p2 }) },
  {
    name: "giriş × daire değişimi (eski satır iptal + yeni satır öteki dairede)",
    kind: "checkin",
    change: async (s) => {
      await copyTo(s, "airbnb");
      await update(s, { status: "cancelled" });
    },
  },
  { name: "karşılama × onaylı → bekliyor", kind: "welcome", change: (s) => update(s, { status: "pending" }) },
  { name: "giriş × onaylı → tamamlandı", kind: "checkin", change: (s) => update(s, { status: "completed" }) },
  { name: "karşılama × iki dairede kopya", kind: "welcome", change: (s) => copyTo(s, "manual") },
  // Bu gecenin sınıfları.
  {
    name: "karşılama × iptal → yeniden onaylı (T3-B2)",
    kind: "welcome",
    change: async (s) => {
      await update(s, { status: "cancelled" });
      // Kuyruk kolunda işçi bu arada iptal edilmiş satırı görür (gerçek sıra).
      if (process.env.DURABLE_OUTBOX_ENABLED === "1") await drainOutboxOnce({ send: async () => ({ ok: true, providerMessageId: "x" }), tokenFor: async () => "t" });
      await update(s, { status: "confirmed" });
    },
  },
  {
    name: "giriş × iptal → yeniden onaylı (T3-B2)",
    kind: "checkin",
    change: async (s) => {
      await update(s, { status: "cancelled" });
      if (process.env.DURABLE_OUTBOX_ENABLED === "1") await drainOutboxOnce({ send: async () => ({ ok: true, providerMessageId: "x" }), tokenFor: async () => "t" });
      await update(s, { status: "confirmed" });
    },
  },
  {
    name: "giriş × kayıt silindi, senkron aynı kaynak kimliğiyle geri getirdi (H4-7)",
    kind: "checkin",
    change: async (s) => {
      const r = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
      await prisma.reservation.delete({ where: { id: r.id } });
      if (process.env.DURABLE_OUTBOX_ENABLED === "1") await drainOutboxOnce({ send: async () => ({ ok: true, providerMessageId: "x" }), tokenFor: async () => "t" });
      await prisma.reservation.create({
        data: { propertyId: r.propertyId, guestName: r.guestName, arrivalDate: r.arrivalDate, departureDate: r.departureDate, channel: "airbnb", status: "confirmed", sourceReference: r.sourceReference },
      });
    },
  },
  { name: "çıkış × değişiklik yok (kontrol)", kind: "checkout", change: async () => undefined },
  { name: "çıkış × çıkış iki gün İLERİ alındı (T3-B3)", kind: "checkout", change: (s) => update(s, { departureDate: stayDay(2) }) },
  { name: "çıkış × iptal", kind: "checkout", change: (s) => update(s, { status: "cancelled" }) },
];

describe("otomatik mesaj — kuyruk yolu ↔ doğrudan yol aynı misafir sonucu (F-1 karakterizasyon)", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, providerMessageId: "d1" } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(morningToday());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  for (const cell of CELLS) {
    it(cell.name, async () => {
      const direct = await directPath(cell.kind, cell.change);
      await resetDb();
      vi.clearAllMocks();
      vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, providerMessageId: "d1" } as never);
      const queued = await queuePath(cell.kind, cell.change);
      expect({ queued }).toEqual({ queued: direct });
    });
  }
});
