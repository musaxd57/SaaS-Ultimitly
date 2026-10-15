import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/hospitable", () => ({ listProperties: vi.fn(), listReservations: vi.fn(), listMessages: vi.fn() }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));

import { NextRequest } from "next/server";
import { createReservationTasks, removeAutoTasksForCancelledReservation, __reservationTaskHooks, RESERVATION_TASKS_TX } from "@/lib/automation";
import { reportError } from "@/lib/report-error";
import { OPEN_AUTO_LIFECYCLE_TASK_WHERE } from "@/lib/tasks/cancelled-leftovers";
import { syncCalendarSource, reconcileFeedDisappearance } from "@/lib/import/sync";
import { POST as IMPORT } from "@/app/api/reservations/import/route";
import { syncHospitable } from "@/lib/hospitable-sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { pauseFirstCleanup, pauseFirstCreator, settleOrWait, untilPaused } from "../helpers/reservation-lock";
import { POST as REACTIVATE } from "@/app/api/reservations/[id]/reactivate/route";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { PATCH as PATCH_RESERVATION } from "@/app/api/reservations/[id]/route";

// ---------------------------------------------------------------------------
// BÜTÜN İPTAL YOLLARI AYNI KİLİT PROTOKOLÜ (ChatGPT 10-15: "bütün iptal yollarının aynı kilit protokolünü kullandığını doğrula; 'zaten
// iptal edilmiş' olması tek başına hızlı yolun güvenlik kanıtı olmasın; iptalden önce başlamış oluşturucu ihtimalini test et").
//
// Protokol: görev açan işlem (`createReservationTasks`) rezervasyonu rezervasyon kilidi (ad alanı 44) ALTINDA okur ve görevleri aynı
// işlemde yazar; her iptal yolu kendi iptalini commit ettikten SONRA `removeAutoTasksForCancelledReservation` çağırır ve o da AYNI
// kilidi bekler. Böylece iptalden ÖNCE başlamış açan işlem ya önce biter (görevlerini temizlik siler) ya da sonra koşar (iptali görür).
//
// Senaryo HER yol için aynı: açan işlem kilit altında rezervasyonu "onaylı" okur ve DURDURULUR (görevler henüz yazılmamış, kilit tutuluyor
// → o an silinecek görev SAYISI 0). Sonra yol iptali kendi biçimiyle yapar. Beklenen: yolun temizliği kilitte BEKLER ("waiting"); açan
// işlem bırakılınca görevlerini yazar, temizlik ardından siler → iptal edilmiş konaklamada sistem görevi KALMAZ. Kilitsiz bir kısa yol
// ("zaten iptal + şu an görev yok → çık") ya da eksik temizlik çağrısı "done" + 2 artık görev verir → KIRMIZI.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ymd = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const atMidnight = (offset: number) => new Date(`${ymd(offset)}T00:00:00.000Z`);
const UID = "kilit-1@airbnb.com";

const vevent = (uid: string, cancelled: boolean) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${icsDay(5)}`, `DTEND;VALUE=DATE:${icsDay(8)}`, "SUMMARY:Ada Guest", ...(cancelled ? ["STATUS:CANCELLED"] : []), "END:VEVENT"].join("\r\n");
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb//Hosting Calendar//EN", ...events, "END:VCALENDAR"].join("\r\n");
const icsFileReq = (propertyId: string, ics: string) => {
  const form = new FormData();
  form.set("file", new File([ics], "takvim.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
};
const hospReservation = (category: "accepted" | "cancelled") => ({
  id: "res-kilit",
  platform: "airbnb",
  arrival_date: ymd(5),
  departure_date: ymd(8),
  reservation_status: { current: { category } },
  guest: { full_name: "Ada Guest" },
  last_message_at: null,
});

type Ctx = { orgId: string; propertyId: string };
type CancelPath = {
  name: string;
  /** Onaylı, GÖREVSİZ rezervasyon (yolun eşleştireceği biçimde) — kimliğini döner. */
  setup: (c: Ctx) => Promise<{ reservationId: string; sourceId?: string }>;
  /** Yolun iptali + kendi temizliği (açan işlem DURDURULMUŞKEN çağrılır). */
  cancel: (c: Ctx, s: { reservationId: string; sourceId?: string }) => Promise<unknown>;
};

const icalBound = async (c: Ctx, extra: Record<string, unknown> = {}) => {
  const source = await prisma.calendarSource.create({ data: { propertyId: c.propertyId, label: "Airbnb", url: "https://example.com/cal.ics" } });
  const r = await prisma.reservation.create({
    data: {
      propertyId: c.propertyId, guestName: "Ada Guest", arrivalDate: atMidnight(5), departureDate: atMidnight(8), channel: "airbnb",
      status: "confirmed", sourceReference: UID, calendarSourceId: source.id, ...extra,
    },
  });
  return { reservationId: r.id, sourceId: source.id };
};
const fileOwned = async (c: Ctx) => {
  const r = await prisma.reservation.create({
    data: {
      propertyId: c.propertyId, guestName: "Ada Guest", arrivalDate: atMidnight(5), departureDate: atMidnight(8), channel: "ics",
      status: "confirmed", sourceReference: UID, calendarSourceId: null,
    },
  });
  return { reservationId: r.id };
};
/** "Zaten iptal": iptal ÖNCEKİ bir turda yazıldı, o turun temizliği yapılamadı (örn. zaman aşımı) — onarım çağrısı sınanır. */
const markCancelled = (reservationId: string) => prisma.reservation.update({ where: { id: reservationId }, data: { status: "cancelled" } });

const PATHS: CancelPath[] = [
  {
    name: "iCal senkronu — iptal GEÇİŞİ (STATUS:CANCELLED)",
    setup: (c) => icalBound(c),
    cancel: async (_c, s) => {
      vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, true)));
      return syncCalendarSource(s.sourceId!);
    },
  },
  {
    name: "iCal senkronu — ONARIM ('zaten iptal' satır, önceki turun temizliği düşmüş)",
    setup: (c) => icalBound(c),
    cancel: async (_c, s) => {
      await markCancelled(s.reservationId);
      vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, true)));
      return syncCalendarSource(s.sourceId!);
    },
  },
  {
    name: "iCal kayıp uzlaştırması (satır feed'den kayboldu, eşikler aşıldı — prod'da anahtar KAPALI, fonksiyon düzeyinde sınanır)",
    setup: async (c) => {
      const s = await icalBound(c, { feedMissingCount: 1, feedFirstMissingAt: new Date(Date.now() - 25 * 3_600_000) });
      await prisma.reservation.create({
        data: {
          propertyId: c.propertyId, guestName: "Kalan", arrivalDate: atMidnight(20), departureDate: atMidnight(22), channel: "airbnb",
          status: "confirmed", sourceReference: "kalan@airbnb.com", calendarSourceId: s.sourceId,
        },
      });
      return s;
    },
    cancel: (c, s) =>
      reconcileFeedDisappearance({
        source: { id: s.sourceId!, propertyId: c.propertyId },
        channel: "airbnb",
        seenRefs: new Set(["kalan@airbnb.com"]),
        runStartedAt: new Date(),
        now: new Date(),
        complete: true,
      }),
  },
  {
    name: "Dosyadan içe aktarma — iptal GEÇİŞİ (aynı UID, STATUS:CANCELLED)",
    setup: fileOwned,
    cancel: (c) => IMPORT(icsFileReq(c.propertyId, calendar(vevent(UID, true))), { params: Promise.resolve({}) }),
  },
  {
    name: "Dosyadan içe aktarma — ONARIM (aynı iptal dosyası yeniden yüklendi)",
    setup: fileOwned,
    cancel: async (c, s) => {
      await markCancelled(s.reservationId);
      return IMPORT(icsFileReq(c.propertyId, calendar(vevent(UID, true))), { params: Promise.resolve({}) });
    },
  },
  {
    name: "Dosyadan içe aktarma — ONARIM (canlı satırlı dosya iptalli kaydı geri AÇMAZ)",
    setup: fileOwned,
    cancel: async (c, s) => {
      await markCancelled(s.reservationId);
      return IMPORT(icsFileReq(c.propertyId, calendar(vevent(UID, false))), { params: Promise.resolve({}) });
    },
  },
  {
    name: "Rezervasyon düzenleme rotası (PATCH status: cancelled — arayüz kullanmıyor, API açık; Haiku 10-15)",
    setup: fileOwned,
    cancel: (_c, s) =>
      PATCH_RESERVATION(
        new NextRequest(`http://localhost/api/reservations/${s.reservationId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled" }),
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: s.reservationId }) },
      ),
  },
  {
    name: "Hospitable senkronu — iptal GEÇİŞİ",
    setup: async (c) => {
      vi.mocked(listProperties).mockResolvedValue([{ id: "hp", name: "Test Property" }] as never);
      vi.mocked(listReservations).mockResolvedValue([hospReservation("accepted")] as never);
      await syncHospitable(c.orgId); // satırı Hospitable yazar (kimlik eşleşmesi gerçek); açtığı görevler silinir → görevsiz başlangıç
      const r = await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-kilit" } });
      await prisma.task.deleteMany({ where: { reservationId: r.id } });
      return { reservationId: r.id };
    },
    cancel: async (c) => {
      vi.mocked(listReservations).mockResolvedValue([hospReservation("cancelled")] as never);
      return syncHospitable(c.orgId);
    },
  },
];

const leftoverTasksFor = async (c: Ctx, reservationId: string) => {
  for (const type of ["checkin_prep", "cleaning"]) {
    await prisma.task.create({ data: { propertyId: c.propertyId, reservationId, type, origin: "system", title: "eski", status: "todo" } });
  }
};

const systemTasks = (reservationId: string) =>
  prisma.task.count({ where: { reservationId, origin: "system", type: { in: ["checkin_prep", "cleaning"] } } });

describe("İptal yolları — aynı rezervasyon kilidi (iptalden ÖNCE başlamış görev açan işlem)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(listMessages).mockResolvedValue([] as never);
    const made = await makeOrgWithProperty();
    ctx = { orgId: made.orgId, propertyId: made.propertyId };
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => {
    __reservationTaskHooks.afterExistingRead = null;
    __reservationTaskHooks.afterCleanupLockedRead = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(PATHS.map((p) => [p.name, p] as const))("🚨 %s: temizlik kilidi BEKLER, sonunda iptal edilmiş konaklamada sistem görevi KALMAZ", async (_n, path) => {
    const s = await path.setup(ctx);
    expect(await systemTasks(s.reservationId)).toBe(0); // ön koşul: görevsiz
    const pause = pauseFirstCreator(s.reservationId);
    const creating = createReservationTasks(s.reservationId);
    let running: Promise<unknown> | null = null;
    let outcome: "waiting" | "done";
    try {
      await untilPaused(pause, creating); // açan işlem kilit altında "onaylı" okudu, görevleri HENÜZ yazmadı
      running = path.cancel(ctx, s);
      outcome = await settleOrWait(s.reservationId, running);
      // O anda silinecek görev YOK — kilitsiz "görev yok → çık" kısa yolu tam burada yanılırdı.
      expect(await systemTasks(s.reservationId)).toBe(0);
    } finally {
      pause.release();
    }
    expect(outcome).toBe("waiting");
    expect(await creating).toBe(2); // açan işlem kendi gördüğüyle bitti: iki görev yazdı
    await running;
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
    expect(await systemTasks(s.reservationId)).toBe(0); // temizlik kilidi alınca onları sildi
  }, 30_000);

  it("kayıp uzlaştırmasında temizlik düşerse SESSİZ kalmaz: operatöre TEK toplu alarm, satır verisi yok (eskiden `.catch(() => {})`)", async () => {
    const s = await PATHS[2].setup(ctx);
    await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "x", status: "todo" } });
    const realTx = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      if (opts === RESERVATION_TASKS_TX) return Promise.reject(new Error("pool timeout"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    try {
      const rec = await PATHS[2].cancel(ctx, s);
      expect(rec).toMatchObject({ cancelled: 1 }); // iptal yine de doğru yazıldı
    } finally {
      spy.mockRestore();
    }
    expect(await systemTasks(s.reservationId)).toBe(1); // temizlik düştü
    const calls = vi.mocked(reportError).mock.calls.filter((c) => c[0] === "import.sync.reconcile.tasks");
    expect(calls).toHaveLength(1);
    const msg = String((calls[0][1] as Error).message);
    expect(msg).toContain("1 kaybolan rezervasyonun görevleri silinemedi");
    expect(msg).not.toContain(s.reservationId); // satır kimliği alarm metnine girmez (Opus O7: ad iddiası vakumluydu)
    // ALARM ≠ ONARIM (kurucu / Codex 10-15): kalan görev bir sonraki senkronun onarım taramasıyla TAMAMLANIR (satır feed'de yok).
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent("kalan@airbnb.com", false)));
    await syncCalendarSource(s.sourceId!);
    expect(await systemTasks(s.reservationId)).toBe(0);
  });

  it("ONARIM YOLU: iptal temizliği düşen ve SONRA feed'den kaybolan satır (bir daha 'zaten iptal' olarak gelmez) sonraki senkronda temizlenir", async () => {
    const s = await icalBound(ctx);
    await prisma.reservation.create({
      data: {
        propertyId: ctx.propertyId, guestName: "Kalan", arrivalDate: atMidnight(20), departureDate: atMidnight(22), channel: "airbnb",
        status: "confirmed", sourceReference: "kalan@airbnb.com", calendarSourceId: s.sourceId,
      },
    });
    await leftoverTasksFor(ctx, s.reservationId);
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, true), vevent("kalan@airbnb.com", false)));
    const realTx = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      if (opts === RESERVATION_TASKS_TX && typeof arg === "function" && String(arg).includes("taskUpdate")) return Promise.reject(new Error("pool timeout"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    try {
      await syncCalendarSource(s.sourceId!); // iptal geçişi + aynı turdaki onarım taraması: ikisi de düşer
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
    expect(await systemTasks(s.reservationId)).toBe(2);
    // Airbnb takvimi iptal edilen etkinliği çoğunlukla SİLER: sonraki turda satır feed'de hiç yok.
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent("kalan@airbnb.com", false)));
    await syncCalendarSource(s.sourceId!);
    expect(await systemTasks(s.reservationId)).toBe(0);
  });

  it("kurucu D5: ONARIM yalnız başlanmamış + dokunulmamış sistem görevini siler; başlanmış ya da bir kişinin güncellediği görev KORUNUR", async () => {
    const s = await icalBound(ctx, { status: "cancelled" });
    const user = await prisma.user.create({ data: { organizationId: ctx.orgId, name: "Temizlikçi", email: `t-${ctx.orgId}@x.com`, passwordHash: "x", role: "staff" } });
    const untouched = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "checkin_prep", origin: "system", title: "x", status: "todo" } });
    const started = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "x", status: "in_progress" } });
    const noted = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "x", status: "todo" } });
    await prisma.taskUpdate.create({ data: { taskId: noted.id, userId: user.id, note: "anahtar alındı" } });
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent("kalan@airbnb.com", false))); // satır feed'de yok → onarım taraması
    await syncCalendarSource(s.sourceId!);
    expect(await prisma.task.findUnique({ where: { id: untouched.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: started.id } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: noted.id } })).not.toBeNull();
    // İptal GEÇİŞİNİN kendisi (onarım değil) bugünkü kümeyi siler — bu tur değiştirilmedi.
    expect(await removeAutoTasksForCancelledReservation(s.reservationId)).toBe(2);
  });

  it("kurucu D5 (Haiku 10-15): ZATEN iptalli satıra tekrar PATCH 'iptal' ve Hospitable'ın her turdaki çağrısı ONARIMDIR — başlanmış görev korunur", async () => {
    // PATCH: satır zaten iptal → yalnız dokunulmamış görev silinir.
    const a = await fileOwned(ctx);
    await markCancelled(a.reservationId);
    const aTodo = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: a.reservationId, type: "checkin_prep", origin: "system", title: "x", status: "todo" } });
    const aStarted = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: a.reservationId, type: "cleaning", origin: "system", title: "x", status: "in_progress" } });
    const patch = await PATCH_RESERVATION(
      new NextRequest(`http://localhost/api/reservations/${a.reservationId}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: a.reservationId }) },
    );
    expect(patch.status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: aTodo.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: aStarted.id } })).not.toBeNull();
    // Hospitable: satır ÖNCEKİ turda iptal edildi; bu tur geçiş değil → onarım.
    const hosp = PATHS.find((p) => p.name.startsWith("Hospitable"))!;
    const h = await hosp.setup(ctx);
    await hosp.cancel(ctx, h); // geçiş turu (görev yoktu)
    const hStarted = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: h.reservationId, type: "cleaning", origin: "system", title: "x", status: "in_progress" } });
    const hTodo = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: h.reservationId, type: "checkin_prep", origin: "system", title: "x", status: "todo" } });
    await hosp.cancel(ctx, h); // sonraki tur: satır zaten iptal
    expect(await prisma.task.findUnique({ where: { id: hTodo.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: hStarted.id } })).not.toBeNull();
  });

  it("geçişte TAM küme (bugünkü iptal davranışı değişmedi): onaylı satır PATCH ile iptal edilince başlanmış sistem görevi de silinir", async () => {
    const a = await fileOwned(ctx);
    await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: a.reservationId, type: "cleaning", origin: "system", title: "x", status: "in_progress" } });
    await PATCH_RESERVATION(
      new NextRequest(`http://localhost/api/reservations/${a.reservationId}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: a.reservationId }) },
    );
    expect(await systemTasks(a.reservationId)).toBe(0);
  });

  it("aşırı uygulama yok (onarım taraması): onaylı satırın görevleri, ev sahibinin kendi görevi ve BAŞKA kaynağın iptalli satırı dokunulmaz", async () => {
    const s = await icalBound(ctx); // onaylı, bu kaynağın satırı
    await leftoverTasksFor(ctx, s.reservationId);
    const cancelledHere = await prisma.reservation.create({
      data: {
        propertyId: ctx.propertyId, guestName: "B", arrivalDate: atMidnight(30), departureDate: atMidnight(32), channel: "airbnb",
        status: "cancelled", sourceReference: "b@airbnb.com", calendarSourceId: s.sourceId,
      },
    });
    const manual = await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: cancelledHere.id, type: "cleaning", origin: "manual", title: "elle", status: "todo" } });
    const other = await prisma.calendarSource.create({ data: { propertyId: ctx.propertyId, label: "Booking", url: "https://example.com/other.ics" } });
    const otherRow = await prisma.reservation.create({
      data: {
        propertyId: ctx.propertyId, guestName: "C", arrivalDate: atMidnight(40), departureDate: atMidnight(42), channel: "booking",
        status: "cancelled", sourceReference: "c@booking.com", calendarSourceId: other.id,
      },
    });
    await leftoverTasksFor(ctx, otherRow.id);
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, false)));
    await syncCalendarSource(s.sourceId!);
    expect(await systemTasks(s.reservationId)).toBe(2); // onaylı → dokunulmaz
    expect(await prisma.task.findUnique({ where: { id: manual.id } })).not.toBeNull(); // ev sahibinin görevi korunur
    expect(await systemTasks(otherRow.id)).toBe(2); // başka kaynağın satırı bu kaynağın senkronunda temizlenmez
  });

  it("Hospitable senkronunda iptal temizliği düşerse SESSİZ kalmaz: koşu başına TEK alarm, satır verisi yok (Opus O4; eskiden `.catch(() => {})`)", async () => {
    const hosp = PATHS.find((p) => p.name.startsWith("Hospitable"))!;
    const s = await hosp.setup(ctx);
    await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "x", status: "todo" } });
    const realTx = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      if (opts === RESERVATION_TASKS_TX) return Promise.reject(new Error("pool timeout"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    vi.mocked(reportError).mockClear();
    try {
      await hosp.cancel(ctx, s);
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled"); // iptal yazıldı
    expect(await systemTasks(s.reservationId)).toBe(1); // temizlik düştü (sonraki senkron yeniden dener)
    const calls = vi.mocked(reportError).mock.calls.filter((c) => String(c[0]).startsWith("reservation-tasks org:"));
    expect(calls).toHaveLength(1);
    const msg = String((calls[0][1] as Error).message);
    expect(msg).toContain("1 reservation task side effect(s) failed");
    expect(msg).not.toContain(s.reservationId);
  });

  it("aşırı uygulama yok: dosyadaki iptal satırı BAŞKA kaynağın (takvim bağlantısının) zaten iptalli satırına DOKUNMAZ — görevleri silinmez", async () => {
    const s = await icalBound(ctx);
    await markCancelled(s.reservationId);
    await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "x", status: "todo" } });
    const res = await IMPORT(icsFileReq(ctx.propertyId, calendar(vevent(UID, true))), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await systemTasks(s.reservationId)).toBe(1); // satır takvim bağlantısının; onun temizliği kendi senkronunda
  });

  it("aşırı uygulama yok: dosyadaki iptal satırı başka KANALIN (kaynaksız ama 'ics' olmayan — sağlayıcı / elle) zaten iptalli satırına DOKUNMAZ", async () => {
    const r = await prisma.reservation.create({
      data: {
        propertyId: ctx.propertyId, guestName: "Ada Guest", arrivalDate: atMidnight(5), departureDate: atMidnight(8), channel: "airbnb",
        status: "cancelled", sourceReference: UID, calendarSourceId: null,
      },
    });
    await prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: r.id, type: "cleaning", origin: "system", title: "x", status: "todo" } });
    const res = await IMPORT(icsFileReq(ctx.propertyId, calendar(vevent(UID, true))), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await systemTasks(r.id)).toBe(1); // dosya yalnız KENDİ satırına dokunur (`calendarSourceId` null + `channel` "ics")
  });

  it("eski sürümden kalan artıklar: teşhis betiğinin saydığı küme = iptal temizliğinin sildiği küme (ev sahibinin / mesajın görevi ve bitmiş iş korunur)", async () => {
    const r = await prisma.reservation.create({
      data: { propertyId: ctx.propertyId, guestName: "Ada", arrivalDate: atMidnight(5), departureDate: atMidnight(8), channel: "airbnb", status: "cancelled" },
    });
    const mk = (type: string, origin: string, status: string) =>
      prisma.task.create({ data: { propertyId: ctx.propertyId, reservationId: r.id, type, origin, status, title: "x" } });
    await mk("cleaning", "system", "todo");
    await mk("checkin_prep", "system", "in_progress");
    await mk("cleaning", "system", "done"); // bitmiş iş kaydı
    await mk("cleaning", "manual", "todo"); // ev sahibinin kendi görevi
    await mk("maintenance", "ai", "todo"); // mesajdan açılan
    const leftoverWhere = { ...OPEN_AUTO_LIFECYCLE_TASK_WHERE, reservation: { status: "cancelled" } };
    expect(await prisma.task.count({ where: leftoverWhere })).toBe(2);
    expect(await removeAutoTasksForCancelledReservation(r.id)).toBe(2);
    expect(await prisma.task.count({ where: leftoverWhere })).toBe(0);
    expect(await prisma.task.count({ where: { reservationId: r.id } })).toBe(3);
  });

  it("aşırı uygulama yok: iptal commit edildikten SONRA çağrılan görev açma ön okumada iptali görür, kilide girmeden 0 döner", async () => {
    const s = await icalBound(ctx);
    vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, true)));
    await syncCalendarSource(s.sourceId);
    expect(await createReservationTasks(s.reservationId)).toBe(0);
    expect(await systemTasks(s.reservationId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TERS YÖN — YENİDEN AÇMA (Opus 10-15 O1). İptal temizliği kilit altında "iptal" okuyup eski görevleri silmek üzereyken (henüz commit
// edilmemiş) rezervasyon yeniden açılırsa, görev açan işlemin kilitsiz hızlı yolu eski görevleri "var" görüp çıkardı → temizlik commit
// edince onaylı rezervasyon GÖREVSİZ kalırdı. Yeniden açan iki yol (`Yeniden aç` düğmesi, takvimin iptalli satırı yeniden onaylaması)
// hızlı yolu atlar: temizliği bekler, silinenleri görür, görevleri yeniden açar.
// ---------------------------------------------------------------------------
type ReopenPath = { name: string; setup: (c: Ctx) => Promise<{ reservationId: string; sourceId?: string }>; reopen: (c: Ctx, s: { reservationId: string; sourceId?: string }) => Promise<unknown> };

const leftoverTasks = async (c: Ctx, reservationId: string) => {
  for (const type of ["checkin_prep", "cleaning"]) {
    await prisma.task.create({ data: { propertyId: c.propertyId, reservationId, type, origin: "system", title: "eski", status: "todo" } });
  }
};

const REOPEN_PATHS: ReopenPath[] = [
  {
    name: "\"Yeniden aç\" düğmesi (kanal etkin gösteriyor)",
    setup: async (c) => {
      const user = await prisma.user.create({ data: { organizationId: c.orgId, name: "O", email: `o-${c.orgId}@x.com`, passwordHash: "x", role: "owner" } });
      session = { userId: user.id, organizationId: c.orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
      const r = await prisma.reservation.create({
        data: { propertyId: c.propertyId, guestName: "Ada Guest", arrivalDate: atMidnight(5), departureDate: atMidnight(8), channel: "airbnb", status: "cancelled", sourceReference: "res-acik" },
      });
      await prisma.ingestEvent.create({
        data: {
          organizationId: c.orgId, provider: "hospitable", entityType: "reservation", entityId: r.id, kind: "reservation.updated",
          changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]), occurredAt: new Date(),
        },
      });
      await leftoverTasks(c, r.id);
      return { reservationId: r.id };
    },
    reopen: (_c, s) =>
      REACTIVATE(new NextRequest(`http://localhost/api/reservations/${s.reservationId}/reactivate`, { method: "POST" }), {
        params: Promise.resolve({ id: s.reservationId }),
      }),
  },
  {
    name: "iCal senkronu — iptalli satır canlı göründü, yeniden onaylandı",
    setup: async (c) => {
      const s = await icalBound(c, { status: "cancelled" });
      await leftoverTasks(c, s.reservationId);
      return s;
    },
    reopen: async (_c, s) => {
      vi.mocked(fetchFeedText).mockResolvedValue(calendar(vevent(UID, false)));
      return syncCalendarSource(s.sourceId!);
    },
  },
];

describe("Yeniden açma yolları — süren iptal temizliğiyle yarış (Opus O1)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    ctx = { orgId: made.orgId, propertyId: made.propertyId };
  });
  afterEach(() => {
    __reservationTaskHooks.afterExistingRead = null;
    __reservationTaskHooks.afterCleanupLockedRead = null;
  });

  it.each(REOPEN_PATHS.map((p) => [p.name, p] as const))("🚨 %s: görev açma temizliği BEKLER, sonunda onaylı rezervasyonda giriş hazırlığı + temizlik VAR", async (_n, path) => {
    const s = await path.setup(ctx);
    expect(await systemTasks(s.reservationId)).toBe(2); // eski artık görevler
    const pause = pauseFirstCleanup(s.reservationId);
    const cleaning = removeAutoTasksForCancelledReservation(s.reservationId);
    let running: Promise<unknown> | null = null;
    let outcome: "waiting" | "done";
    try {
      await untilPaused(pause, cleaning); // temizlik kilit altında "iptal" okudu, eski görevleri HENÜZ silmedi
      running = path.reopen(ctx, s);
      outcome = await settleOrWait(s.reservationId, running);
    } finally {
      pause.release();
    }
    expect(outcome).toBe("waiting");
    expect(await cleaning).toBe(2); // temizlik kendi gördüğüyle bitti: eski iki görevi sildi
    await running;
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("confirmed");
    const tasks = await prisma.task.findMany({ where: { reservationId: s.reservationId, origin: "system" }, select: { type: true, title: true } });
    expect(tasks.map((t) => t.type).sort()).toEqual(["checkin_prep", "cleaning"]);
    expect(tasks.every((t) => t.title !== "eski")).toBe(true); // yeni açılmış görevler
  }, 30_000);
});
