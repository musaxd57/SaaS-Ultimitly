import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";

// ---------------------------------------------------------------------------
// Tur 7 CAL-2 (kurucu onayı 11-05, Codex görüşüyle) — aynı UID'nin satırları SIRADAN BAĞIMSIZ çözülür (`ics-resolve.ts`).
// Eski "bir geçişte UID başına ilk satır" kuralında iptal edilmiş tekrar örneği / eski iptal kopyası canlı satırdan önce gelince:
//  · var olan rezervasyon İPTAL ediliyordu (dışa aktarılan takvim o geceleri bırakıyordu → çift rezervasyon riski),
//  · ilk senkronda canlı ana kayıt hiç alınmıyordu.
// Gerçek iptal (ana kaydın kendi iptali, daha yeni sürümün iptali) aynen çalışır.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ev = (uid: string, from: number, to: number, extra: string[] = []) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(to)}`, "SUMMARY:Reserved", ...extra, "END:VEVENT"].join("\n");
const cal = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join("\n")}\nEND:VCALENDAR`;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({ data: { propertyId, label: "Google", url: "https://example.com/cal.ics" } });
  return { orgId, propertyId, sourceId: source.id };
}

async function syncWith(sourceId: string, text: string) {
  vi.mocked(fetchFeedText).mockResolvedValue(text);
  return syncCalendarSource(sourceId);
}

describe("iCal senkronu — ana kayıt / tekrar örneği / sürüm (CAL-2)", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("🚨 var olan rezervasyon: iptal kopyası canlı kopyadan ÖNCE gelse de ONAYLI kalır (olay yok)", async () => {
    const { propertyId, sourceId } = await seed();
    await syncWith(sourceId, cal(ev("bk-1", 10, 12)));
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    expect(r.status).toBe("confirmed");
    const events = await prisma.ingestEvent.count();

    await syncWith(sourceId, cal(ev("bk-1", 10, 12, ["STATUS:CANCELLED"]), ev("bk-1", 10, 12)));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("confirmed");
    expect(await prisma.ingestEvent.count()).toBe(events);
  });

  it("🚨 ilk senkron: tekrarlayan serinin iptal edilmiş örneği önde gelse de ana kayıt DOLU gece olarak alınır — iki sırada aynı", async () => {
    const master = ev("rec-1", 10, 12, ["RRULE:FREQ=WEEKLY;COUNT=3"]);
    const cancelledInstance = ev("rec-1", 17, 19, [`RECURRENCE-ID;VALUE=DATE:${ymd(17)}`, "STATUS:CANCELLED"]);
    for (const text of [cal(cancelledInstance, master), cal(master, cancelledInstance)]) {
      await resetDb();
      const { propertyId, sourceId } = await seed();
      await syncWith(sourceId, text);
      const rows = await prisma.reservation.findMany({ where: { propertyId } });
      expect(rows.map((x) => [x.status, x.arrivalDate.toISOString().slice(0, 10)])).toEqual([["confirmed", new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10)]]);
      const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } });
      expect(src.lastStatus).toBe("partial"); // tekrarlar açılmaz — okuma eksik işaretli kalır
    }
  });

  it("🚨 seri 10 + 17: yalnız 10 örneği iptal → 10'daki kayıt iptal (dışa aktarım o geceleri kapatmaz); 17 örneği iptal → 10 dolu kalır", async () => {
    const master = ev("rec-2", 10, 12, ["RRULE:FREQ=WEEKLY;COUNT=2"]);
    const cancel10 = ev("rec-2", 10, 12, [`RECURRENCE-ID;VALUE=DATE:${ymd(10)}`, "STATUS:CANCELLED"]);
    const cancel17 = ev("rec-2", 17, 19, [`RECURRENCE-ID;VALUE=DATE:${ymd(17)}`, "STATUS:CANCELLED"]);
    const { propertyId, sourceId } = await seed();
    await syncWith(sourceId, cal(master));
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    expect(r.status).toBe("confirmed");
    await syncWith(sourceId, cal(master, cancel17));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("confirmed");
    await syncWith(sourceId, cal(cancel10, master));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
  });

  it("🚨 GERÇEK iptal: daha yeni sürümün (SEQUENCE) iptali, canlı eski kopya önde gelse de rezervasyonu iptal eder", async () => {
    const { propertyId, sourceId } = await seed();
    await syncWith(sourceId, cal(ev("bk-2", 10, 12, ["SEQUENCE:1"])));
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    await syncWith(sourceId, cal(ev("bk-2", 10, 12, ["SEQUENCE:1"]), ev("bk-2", 10, 12, ["SEQUENCE:2", "STATUS:CANCELLED"])));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
  });

  it("KONTROL — ana kaydın tek başına iptali eskisi gibi iptal eder", async () => {
    const { propertyId, sourceId } = await seed();
    await syncWith(sourceId, cal(ev("bk-3", 10, 12)));
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    await syncWith(sourceId, cal(ev("bk-3", 10, 12, ["STATUS:CANCELLED"])));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
  });
});
