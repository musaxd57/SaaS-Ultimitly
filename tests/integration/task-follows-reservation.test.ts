import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalReservation } from "../helpers/fake-ingest";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DİLİM 4a (C-16) — YAŞAM DÖNGÜSÜ GÖREVLERİ REZERVASYON TARİHİNİ İZLER. Görevler rezervasyon oluşurken bir kez
// yazılıyordu (tür başına idempotent); misafir konaklamayı uzatınca / kısaltınca çıkış temizliği ESKİ günde kalıyordu:
// temizlikçi yanlış güne gider, erken giriş hazırlığı o devrin temizliğini hiç bulamaz. Kural: tarih değiştiğinde AÇIK
// SİSTEM görevi, tarihi ESKİ rezervasyon tarihine BİREBİR eşitse (sistemin yazdığı gibi duruyorsa) yeni tarihe taşınır —
// host'un elle taşıdığı, bitmiş ya da elle / mesajdan açılmış görevlere DOKUNULMAZ. Üç yazma yolu, aynı TX.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { NextRequest } from "next/server";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { POST as importFile } from "@/app/api/reservations/import/route";

const DAY = 86_400_000;
const tasksOf = (reservationId: string) =>
  prisma.task.findMany({ where: { reservationId }, orderBy: { type: "asc" }, select: { type: true, origin: true, status: true, dueAt: true } });
const due = async (reservationId: string, type: string) =>
  (await prisma.task.findFirstOrThrow({ where: { reservationId, type, origin: "system" } })).dueAt?.getTime();

describe("yaşam döngüsü görevleri rezervasyon tarihini izler", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    delete process.env.PRIMARY_ORG_ID;
    delete process.env.HOSPITABLE_API_TOKEN;
    resetPrimaryOrgCache();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("kanal senkronu (canonical yazma servisi)", () => {
    const fake = new FakeIngestProvider();
    const ARR = daysFromNow(5);
    const DEP = daysFromNow(9);
    const R = (over: Record<string, unknown> = {}) =>
      canonicalReservation({ externalId: "res-1", code: "HM1", arrivalDate: ARR, departureDate: DEP, ...over });
    beforeEach(() => {
      fake.reset();
      __setIngestAdapterForTest("hospitable", fake.adapter());
    });
    afterEach(() => __setIngestAdapterForTest("hospitable", null));

    async function seeded() {
      const { orgId, propertyId } = await makeOrgWithProperty();
      await setOrgHospitableToken(orgId, "tok-A", "A");
      fake.addProperty("tok-A", "hp-A", "Test Property");
      fake.setReservations("hp-A", [R()]);
      await syncHospitable(orgId);
      const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
      return { orgId, propertyId, res };
    }

    it("uzatma: çıkış temizliği YENİ çıkış gününe taşınır; giriş hazırlığı yerinde kalır", async () => {
      const { orgId, res } = await seeded();
      expect(await due(res.id, "cleaning")).toBe(DEP.getTime());
      const newDep = daysFromNow(11);
      fake.setReservations("hp-A", [R({ departureDate: newDep })]);
      await syncHospitable(orgId);
      expect(await due(res.id, "cleaning")).toBe(newDep.getTime());
      expect(await due(res.id, "checkin_prep")).toBe(ARR.getTime());
      // Tür başına tek görev kalır (taşıma çoğaltmaz).
      expect((await tasksOf(res.id)).length).toBe(2);
    });

    it("YALNIZ giriş günü değişirse giriş hazırlığı taşınır, temizlik yerinde kalır", async () => {
      const { orgId, res } = await seeded();
      const newArr = daysFromNow(4);
      fake.setReservations("hp-A", [R({ arrivalDate: newArr })]);
      await syncHospitable(orgId);
      expect(await due(res.id, "checkin_prep")).toBe(newArr.getTime());
      expect(await due(res.id, "cleaning")).toBe(DEP.getTime());
    });

    it("🚨 YENİ giriş = ESKİ çıkış (konaklama ileri kaydı): giriş hazırlığı yeni girişe, temizlik yeni çıkışa — ikisi karışmaz", async () => {
      // (5→9) ⇒ (9→13): giriş hazırlığı 9'a taşınınca ESKİ çıkış tarihiyle aynı güne düşer; tür filtresi olmasa ikinci
      // adım (temizlik: eski çıkış = 9) onu da 13'e sürüklerdi (inceleme 09-24).
      const { orgId, res } = await seeded();
      const newDep = daysFromNow(13);
      fake.setReservations("hp-A", [R({ arrivalDate: DEP, departureDate: newDep })]);
      await syncHospitable(orgId);
      expect(await due(res.id, "checkin_prep")).toBe(DEP.getTime());
      expect(await due(res.id, "cleaning")).toBe(newDep.getTime());
    });

    it("giriş günü değişince giriş hazırlığı yeni güne taşınır; kısaltmada temizlik ÖNE çekilir", async () => {
      const { orgId, res } = await seeded();
      const newArr = daysFromNow(6);
      const newDep = daysFromNow(7);
      fake.setReservations("hp-A", [R({ arrivalDate: newArr, departureDate: newDep })]);
      await syncHospitable(orgId);
      expect(await due(res.id, "checkin_prep")).toBe(newArr.getTime());
      expect(await due(res.id, "cleaning")).toBe(newDep.getTime());
    });

    it("🚨 host'un elle taşıdığı, bitmiş ve elle / mesajdan açılmış görevlere DOKUNULMAZ", async () => {
      const { orgId, propertyId, res } = await seeded();
      const hostMoved = new Date(DEP.getTime() + DAY); // temizlikçi ertesi sabah gelecek
      await prisma.task.updateMany({ where: { reservationId: res.id, type: "cleaning" }, data: { dueAt: hostMoved } });
      await prisma.task.updateMany({ where: { reservationId: res.id, type: "checkin_prep" }, data: { status: "done" } });
      const manual = await prisma.task.create({
        data: { propertyId, reservationId: res.id, type: "cleaning", origin: "manual", title: "Ara temizlik", dueAt: DEP, status: "todo", priority: "standard" },
      });
      const ai = await prisma.task.create({
        data: { propertyId, reservationId: res.id, type: "checkin_prep", origin: "ai", title: "Mesajdan", dueAt: ARR, status: "todo", priority: "standard" },
      });
      fake.setReservations("hp-A", [R({ arrivalDate: daysFromNow(6), departureDate: daysFromNow(11) })]);
      await syncHospitable(orgId);
      expect(await due(res.id, "cleaning")).toBe(hostMoved.getTime());
      expect(await due(res.id, "checkin_prep")).toBe(ARR.getTime());
      expect((await prisma.task.findUniqueOrThrow({ where: { id: manual.id } })).dueAt?.getTime()).toBe(DEP.getTime());
      expect((await prisma.task.findUniqueOrThrow({ where: { id: ai.id } })).dueAt?.getTime()).toBe(ARR.getTime());
    });

    it("KONTROL: tarih değişmeyen senkron görev tarihine dokunmaz; başka rezervasyonun görevi etkilenmez", async () => {
      const { orgId, propertyId, res } = await seeded();
      const other = await prisma.reservation.create({
        data: { propertyId, guestName: "B", arrivalDate: ARR, departureDate: DEP, channel: "direct", status: "confirmed", currency: "EUR" },
      });
      const otherTask = await prisma.task.create({
        data: { propertyId, reservationId: other.id, type: "cleaning", origin: "system", title: "t", dueAt: DEP, status: "todo", priority: "standard" },
      });
      fake.setReservations("hp-A", [R({ departureDate: daysFromNow(11) })]);
      await syncHospitable(orgId);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: otherTask.id } })).dueAt?.getTime()).toBe(DEP.getTime());
      const before = await due(res.id, "cleaning");
      await syncHospitable(orgId); // aynı veri
      expect(await due(res.id, "cleaning")).toBe(before);
    });
  });

  describe("takvim bağlantısı (iCal senkronu)", () => {
    const icsDate = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
    const feed = (from: number, to: number) =>
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:follow-1@airbnb.com",
        `DTSTART;VALUE=DATE:${icsDate(from)}`,
        `DTEND;VALUE=DATE:${icsDate(to)}`,
        "SUMMARY:Test Misafir",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n");

    it("uzatılan konaklamada çıkış temizliği yeni güne taşınır", async () => {
      const { propertyId } = await makeOrgWithProperty();
      const source = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" } });
      vi.mocked(fetchFeedText).mockResolvedValue(feed(5, 9));
      await syncCalendarSource(source.id);
      const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "follow-1@airbnb.com" } });
      const oldDue = await due(res.id, "cleaning");
      expect(oldDue).toBe(res.departureDate.getTime());

      vi.mocked(fetchFeedText).mockResolvedValue(feed(5, 11));
      await syncCalendarSource(source.id);
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } });
      expect(after.departureDate.getTime()).not.toBe(res.departureDate.getTime());
      expect(await due(res.id, "cleaning")).toBe(after.departureDate.getTime());
      expect((await tasksOf(res.id)).filter((t) => t.type === "cleaning").length).toBe(1);
    });
  });

  describe("dosyadan içe aktarma (aynı UID, değişen tarih)", () => {
    const icsDay = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
    const file = (from: number, to: number) =>
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:file-follow-1@lixusai.com",
        `DTSTART;VALUE=DATE:${icsDay(from)}`,
        `DTEND;VALUE=DATE:${icsDay(to)}`,
        "SUMMARY:Test Misafir",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
    const req = (propertyId: string, ics: string) => {
      const form = new FormData();
      form.set("file", new File([ics], "rez.ics", { type: "text/calendar" }));
      form.set("propertyId", propertyId);
      return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
    };

    it("güncellenen satırın giriş hazırlığı ve çıkış temizliği yeni günlere taşınır", async () => {
      const { orgId, propertyId } = await makeOrgWithProperty();
      session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
      await importFile(req(propertyId, file(10, 13)), { params: Promise.resolve({}) });
      const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "file-follow-1@lixusai.com" } });
      expect(await due(res.id, "cleaning")).toBe(res.departureDate.getTime());

      const r = await importFile(req(propertyId, file(12, 15)), { params: Promise.resolve({}) });
      expect(await r.json()).toMatchObject({ updated: 1 });
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } });
      expect(await due(res.id, "checkin_prep")).toBe(after.arrivalDate.getTime());
      expect(await due(res.id, "cleaning")).toBe(after.departureDate.getTime());
    });
  });
});
