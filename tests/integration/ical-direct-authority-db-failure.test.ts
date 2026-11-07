import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 6 — sahiplik sorgusu hata verirse bu koşuda YAZMA YOK, hata görünür (Haiku 10-11: sorgu fırlatınca senkron fırlatıyordu).
// AYRI dosya: Prisma temsilcisine `vi.spyOn` sonraki testlere sızar (CLAUDE.md çalışma dersi).
// ---------------------------------------------------------------------------

vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/net/private-host", () => ({ isPrivateHost: () => false, resolvesToPrivate: async () => false }));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn(async () => ({})) }));

import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { reportError } from "@/lib/report-error";

describe("değişmez 6 — sahiplik sorgusu hatası", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.restoreAllMocks());

  it("🚨 sorgu hatası → fırlatmaz, satır YAZMAZ, kaynak hata gösterir, operatör uyarılır; tanınmayan adreste sorgu hiç yapılmaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const airbnb = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://www.airbnb.com/calendar/ical/1.ics" } });
    const other = await prisma.calendarSource.create({ data: { propertyId, label: "Diğer", url: "https://example.com/x.ics" } });
    vi.mocked(fetchFeedText).mockResolvedValue(
      "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:u1\nDTSTART;VALUE=DATE:20270110\nDTEND;VALUE=DATE:20270114\nEND:VEVENT\nEND:VCALENDAR",
    );
    const spy = vi.spyOn(prisma.channelListing, "findMany").mockRejectedValue(new Error("db down"));

    const r = await syncCalendarSource(airbnb.id);
    expect(r.errors).toHaveLength(1);
    expect(await prisma.reservation.count({ where: { calendarSourceId: airbnb.id } })).toBe(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: airbnb.id } })).lastStatus).toBe("error");
    expect(vi.mocked(reportError)).toHaveBeenCalled();

    spy.mockClear();
    const r2 = await syncCalendarSource(other.id);
    expect(spy).not.toHaveBeenCalled();
    expect(r2.imported).toBe(1);
  });
});
