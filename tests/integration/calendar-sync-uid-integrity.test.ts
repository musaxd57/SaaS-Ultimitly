import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { syncCalendarSource } from "@/lib/import/sync";
import { parseIcsDetailed } from "@/lib/import/ics";
import { fetchFeedText } from "@/lib/net/pinned-fetch";

// ---------------------------------------------------------------------------
// İNCELEME AJANI b1 (09-30) — iCal ABONELİK SENKRONUNDA KAYIT KİMLİĞİ:
//   1. Aynı UID çelişen iki hâlle (Google / Outlook tekrarlayan etkinliğin iptal edilmiş örneği aynı UID'yi taşır): ikinci satır
//      ilkinin rezervasyonunu İPTAL ediyor, sonraki geçişte ilk satır yeniden onaylıyordu — her 15 dakikada bir iptal ↔ onay,
//      görevler silinip yeniden kuruluyor, geçiş iptalle bittiği için Lixus'un dışa aktardığı takvim o geceleri kapatmıyordu (çift
//      rezervasyon riski). Kural dosyadan içe aktarmayla AYNI: bir geçişte UID başına İLK satır işlenir, sonrakiler atlanır
//      (kaynak yine 'partial', neden metni ev sahibine görünür).
//   2. UID'siz etkinlik her geçişte YENİ rezervasyon (ve görevleri) açıyordu (günde ~96 kopya). Kural dosyadan içe aktarmayla
//      aynı: aynı kaynağın aynı tarihli, aynı adlı UID'siz satırı varsa aynı kayıttır.
//   3. Küçük harfli "begin:vevent" (RFC 5545 büyük/küçük harf duyarsız) ve yalnız CR satır sonlu dosya etkinlikleri sessizce
//      düşürüyordu ("ok" + boş → müsaitlik "boş" diyebilirdi).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ev = (uid: string | null, from = 10, to = 12, extra: string[] = []) =>
  ["BEGIN:VEVENT", ...(uid === null ? [] : [`UID:${uid}`]), `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(to)}`, "SUMMARY:Reserved", ...extra, "END:VEVENT"].join("\n");
const cal = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join("\n")}\nEND:VCALENDAR`;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({ data: { propertyId, label: "Google", url: "https://example.com/cal.ics" } });
  return { orgId, propertyId, sourceId: source.id };
}

describe("iCal abonelik senkronu — kayıt kimliği (inceleme b1)", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 aynı UID + iptal edilmiş örnek: rezervasyon her geçişte ONAYLI kalır, olay / görev çalkantısı yok", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("blk-1", 10, 12), ev("blk-1", 10, 12, ["STATUS:CANCELLED"])));
    await syncCalendarSource(sourceId);
    const after1 = await prisma.reservation.findMany({ where: { propertyId } });
    expect(after1).toHaveLength(1);
    expect(after1[0].status).toBe("confirmed");
    const events1 = await prisma.ingestEvent.count();
    const tasks1 = await prisma.task.findMany({ where: { reservationId: after1[0].id }, select: { id: true } });

    await syncCalendarSource(sourceId);
    await syncCalendarSource(sourceId);
    const after3 = await prisma.reservation.findUniqueOrThrow({ where: { id: after1[0].id } });
    expect(after3.status).toBe("confirmed");
    expect(await prisma.ingestEvent.count()).toBe(events1); // iptal / yeniden onay olayı yok
    const tasks3 = await prisma.task.findMany({ where: { reservationId: after1[0].id }, select: { id: true } });
    expect(tasks3.map((t) => t.id).sort()).toEqual(tasks1.map((t) => t.id).sort()); // görevler silinip yeniden kurulmadı
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(src.lastStatus).toBe("partial");
    expect(src.lastResult).toContain("aynı kayıt farklı tarihlerle iki kez geçiyor");
  });

  it("🚨 aynı UID + taşınmış örnek: tarihler geçişler arasında gidip gelmez (ilk satır)", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("mv-1", 10, 12), ev("mv-1", 20, 22)));
    await syncCalendarSource(sourceId);
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    const events1 = await prisma.ingestEvent.count();
    await syncCalendarSource(sourceId);
    const again = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(again.arrivalDate.getTime()).toBe(r.arrivalDate.getTime());
    expect(await prisma.ingestEvent.count()).toBe(events1);
  });

  it("KONTROL — farklı UID'ler, açık iptal ve tek satırlık iptal eskisi gibi işlenir", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("a-1", 10, 12), ev("b-1", 14, 16)));
    await syncCalendarSource(sourceId);
    expect(await prisma.reservation.count({ where: { propertyId, status: "confirmed" } })).toBe(2);
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("a-1", 10, 12), ev("b-1", 14, 16, ["STATUS:CANCELLED"])));
    await syncCalendarSource(sourceId);
    expect(await prisma.reservation.count({ where: { propertyId, status: "cancelled" } })).toBe(1);
  });

  it("🚨 UID'siz etkinlik her geçişte YENİ rezervasyon açmaz (boş UID dahil)", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(null, 10, 12), ev("", 14, 16)));
    await syncCalendarSource(sourceId);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    await syncCalendarSource(sourceId);
    await syncCalendarSource(sourceId);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
  });

  it("KONTROL — UID'siz ama FARKLI tarihli etkinlik ayrı kayıttır", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(null, 10, 12)));
    await syncCalendarSource(sourceId);
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(null, 10, 12), ev(null, 20, 22)));
    await syncCalendarSource(sourceId);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
  });

  it("🚨 küçük harfli etkinlik sınırları ve yalnız CR satır sonu okunur (sessizce boş değil)", async () => {
    const lower = cal(ev("lc-1", 10, 12)).replace("BEGIN:VEVENT", "begin:vevent").replace("END:VEVENT", "end:vevent");
    expect(parseIcsDetailed(lower).events.map((e) => e.sourceReference)).toEqual(["lc-1"]);
    const crOnly = cal(ev("cr-1", 10, 12), ev("cr-2", 14, 16)).replace(/\n/g, "\r");
    const parsed = parseIcsDetailed(crOnly);
    expect(parsed.events.map((e) => e.sourceReference)).toEqual(["cr-1", "cr-2"]);
    expect(parsed.incomplete).toEqual([]);
    // Katlanmış (devam satırlı) özellik CR ile de açılır — kimliğin KENDİSİ iki satıra bölünmüş (açılmazsa kimlik "fold" okunur).
    const folded = cal(ev("fold-1", 10, 12)).replace("UID:fold-1", "UID:fold\n -1").replace(/\n/g, "\r");
    expect(parseIcsDetailed(folded).events.map((e) => e.sourceReference)).toEqual(["fold-1"]);
    const foldedCrlf = cal(ev("fold-2", 10, 12)).replace("UID:fold-2", "UID:fold\n -2").replace(/\n/g, "\r\n");
    expect(parseIcsDetailed(foldedCrlf).events.map((e) => e.sourceReference)).toEqual(["fold-2"]);
  });

  it("🚨 CAL-3: 200 karakterden uzun UID — tarih değişikliği ve STATUS:CANCELLED uygulanır (eskiden 'atlandı', kayıt eski tarihte kalıyordu)", async () => {
    const { propertyId, sourceId } = await seed();
    const uid = `${"E".repeat(240)}@exchange.example`;
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(uid, 10, 12)));
    await syncCalendarSource(sourceId);
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    expect(r.sourceReference).toHaveLength(200);

    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(uid, 20, 23)));
    await syncCalendarSource(sourceId);
    const moved = await prisma.reservation.findMany({ where: { propertyId } });
    expect(moved).toHaveLength(1);
    expect(moved[0].arrivalDate.toISOString().slice(0, 10)).toBe(new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10));

    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev(uid, 20, 23, ["STATUS:CANCELLED"])));
    await syncCalendarSource(sourceId);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
  });

  it("🚨 CAL-4: besleme silinip yeniden eklenince benimsenen satırın kanalı beslemenin kanalına döner (eskiden 'manual' kalıyordu)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const first = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/a1.ics" } });
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("ab-1", 10, 12)));
    await syncCalendarSource(first.id);
    const [r] = await prisma.reservation.findMany({ where: { propertyId } });
    expect(r.channel).toBe("airbnb");
    // Silme rotasının yaptığı (calendar-sources/[id] DELETE): bağ kopar, kanal "manual".
    await prisma.reservation.update({ where: { id: r.id }, data: { calendarSourceId: null, channel: "manual" } });
    await prisma.calendarSource.delete({ where: { id: first.id } });
    const again = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/a2.ics" } });
    await syncCalendarSource(again.id);
    const healed = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(healed.calendarSourceId).toBe(again.id);
    expect(healed.channel).toBe("airbnb");
  });

  it("KONTROL — CAL-4: gerçek kanal etiketi ezilmez (Booking satırını 'Airbnb' etiketli besleme benimserse Booking kalır)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: {
        propertyId, guestName: "Reserved", status: "confirmed", channel: "booking", sourceReference: "bk-9",
        arrivalDate: new Date(`${ymd(10).slice(0, 4)}-${ymd(10).slice(4, 6)}-${ymd(10).slice(6)}T12:00:00Z`),
        departureDate: new Date(`${ymd(12).slice(0, 4)}-${ymd(12).slice(4, 6)}-${ymd(12).slice(6)}T12:00:00Z`),
      },
    });
    const src = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/a3.ics" } });
    vi.mocked(fetchFeedText).mockResolvedValue(cal(ev("bk-9", 10, 12)));
    await syncCalendarSource(src.id);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "bk-9" } })).channel).toBe("booking");
  });
});

