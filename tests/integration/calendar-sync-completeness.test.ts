import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { loadAvailabilityInputs } from "@/modules/availability/load";
import { checkAvailability, todayKey, addNights } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// F16 (Codex denetimi 09-05, düzeltme 09-26): EKSİK OKUMA → okunanlar yazılır, açık iptal işlenir,
// ama listede OLMAYAN hiçbir şey hakkında hüküm verilmez:
//   · kaynak `partial` (hatasız ama eksik ≠ "ok"), özet satırı sade uyarı taşır
//   · kayıp uzlaştırması (bayrak AÇIK) eksik okumada kayıp SAYMAZ — birbirini izleyen eksik okumalar
//     24 saati aşsa bile iptal yok; görülen satırın eski serisi sıfırlanır
//   · müsaitlik motoru bu kaynakla boş geceye "müsait" demez
// Her iddia TAM okumadaki karşılığıyla birlikte sınanır (kural yalnız eksik okumayı kesiyor mu?).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ev = (uid: string, from = 10, to = 12, extra: string[] = []) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${ymd(from)}`, `DTEND;VALUE=DATE:${ymd(to)}`, "SUMMARY:Reserved", ...extra, "END:VEVENT"].join("\n");
const full = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\n${events.join("\n")}\nEND:VCALENDAR`;
/** Aynı içerik, END:VCALENDAR'sız: kesilmiş yanıt. */
const truncated = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\n${events.join("\n")}`;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" } });
  return { orgId, propertyId, sourceId: source.id };
}
const sourceRow = (id: string) => prisma.calendarSource.findUniqueOrThrow({ where: { id } });

describe("F16 — eksik iCal okuması", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("yarım dosya: okunan rezervasyonlar alınır, kaynak 'partial', özet sade uyarı; aynı içerik tam gelince 'ok'", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("a@airbnb.com"), ev("b@airbnb.com", 14, 16)));
    const r = await syncCalendarSource(sourceId);
    expect(r.imported).toBe(2);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    const partial = await sourceRow(sourceId);
    expect(partial.lastStatus).toBe("partial");
    expect(partial.lastResult).toContain("Takvimin bir kısmı okunamadı (takvim dosyası yarım geldi)");

    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("a@airbnb.com"), ev("b@airbnb.com", 14, 16)));
    await syncCalendarSource(sourceId);
    const ok = await sourceRow(sourceId);
    expect(ok.lastStatus).toBe("ok");
    expect(ok.lastResult).not.toContain("okunamadı");
  });

  it("tekrarlayan etkinlik de eksik okumadır (neden metni farklı)", async () => {
    const { sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("a@x", 10, 12, ["RRULE:FREQ=WEEKLY;COUNT=5"])));
    await syncCalendarSource(sourceId);
    const row = await sourceRow(sourceId);
    expect(row.lastStatus).toBe("partial");
    expect(row.lastResult).toContain("tekrarlayan etkinlikler okunamıyor");
  });

  it("satır yazma hatası eksik okumaya BASKINDIR: 'error'", async () => {
    const { sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("a@x"), ev("b@x", 14, 16)));
    const realTx = prisma.$transaction.bind(prisma);
    let n = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      n += 1;
      if (n === 2) return Promise.reject(new Error("db blip"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    await syncCalendarSource(sourceId);
    expect((await sourceRow(sourceId)).lastStatus).toBe("error");
  });

  it("🚨 kayıp uzlaştırması AÇIKKEN: eksik okumalar 24 saati aşsa bile kaybolanı iptal ETMEZ; tam okuma kaybı sayar", async () => {
    vi.stubEnv("ICAL_DISAPPEARANCE_RECONCILE_ENABLED", "1");
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("keep@x"), ev("gone@x", 14, 16)));
    await syncCalendarSource(sourceId);
    const gone = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "gone@x" } });

    // İki eksik okuma, arada 25 saat (uzlaştırmanın süre eşiği aşılır): "gone@x" listede yok.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 60_000));
      vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("keep@x")));
      await syncCalendarSource(sourceId);
      vi.setSystemTime(new Date(Date.now() + 25 * 3_600_000));
      await syncCalendarSource(sourceId);
      let row = await prisma.reservation.findUniqueOrThrow({ where: { id: gone.id } });
      expect(row.status).toBe("confirmed");
      expect(row.feedMissingCount ?? 0).toBe(0); // eksik okuma kayıp SAYMADI
      expect((await sourceRow(sourceId)).lastResult).toContain("kayıp uzlaştırması bu turda atlandı");

      // Karşı yön: aynı eksiklik TAM okumada kayıp sayılır (kural yalnız eksik okumayı kesiyor).
      vi.setSystemTime(new Date(Date.now() + 60_000));
      vi.mocked(fetchFeedText).mockResolvedValue(full(ev("keep@x")));
      await syncCalendarSource(sourceId);
      row = await prisma.reservation.findUniqueOrThrow({ where: { id: gone.id } });
      expect(row.feedMissingCount).toBe(1);
      expect(row.status).toBe("confirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("eksik okumada GÖRÜLEN satırın eski kayıp serisi sıfırlanır (olumlu kanıt; bir sonraki tam kayıp iptal ettiremez)", async () => {
    vi.stubEnv("ICAL_DISAPPEARANCE_RECONCILE_ENABLED", "1");
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("x@x")));
    await syncCalendarSource(sourceId);
    const x = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "x@x" } });
    // Daha önce bir tam okumada kaybolmuş gibi (seri 1, 30 saat önce başlamış; son görülme eski).
    const oldSeen = new Date(Date.now() - 31 * 3_600_000);
    await prisma.reservation.update({
      where: { id: x.id },
      data: { feedMissingCount: 1, feedFirstMissingAt: new Date(Date.now() - 30 * 3_600_000), feedLastSeenAt: oldSeen },
    });
    vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("x@x")));
    await syncCalendarSource(sourceId);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: x.id } });
    expect(row.feedMissingCount).toBe(0);
    expect(row.feedFirstMissingAt).toBeNull();
    expect(row.feedLastSeenAt!.getTime()).toBeGreaterThan(oldSeen.getTime());
  });

  it("açık STATUS:CANCELLED eksik okumada da işlenir (belirli bir UID'nin olumlu beyanı)", async () => {
    const { propertyId, sourceId } = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("c@x")));
    await syncCalendarSource(sourceId);
    vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("c@x", 10, 12, ["STATUS:CANCELLED"])));
    await syncCalendarSource(sourceId);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "c@x" } });
    expect(row.status).toBe("cancelled");
    expect((await sourceRow(sourceId)).lastStatus).toBe("partial");
  });

  it("🚨 müsaitlik: eksik okunan kaynakla boş gece 'müsait' DEĞİL (bilinmiyor); tam okumada müsait", async () => {
    const { orgId, propertyId, sourceId } = await seed();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Istanbul" } });
    vi.mocked(fetchFeedText).mockResolvedValue(truncated(ev("a@x", 10, 12)));
    await syncCalendarSource(sourceId);

    const now = new Date();
    const today = todayKey(now, "Europe/Istanbul");
    // Yükleyici: kısmi durum olduğu gibi geçer, okuma anı "son okuma" olarak taşınır (görülen satır görülmüştür).
    const row = await sourceRow(sourceId);
    const loaded0 = await loadAvailabilityInputs(orgId, { range: { nightsFromToday: 30 }, now });
    expect(loaded0!.inputs.get(propertyId)!.sources).toEqual([
      expect.objectContaining({ kind: "calendar_feed", lastStatus: "partial", lastSuccessAt: row.lastSyncedAt }),
    ]);
    const ask = async () => {
      const loaded = await loadAvailabilityInputs(orgId, { range: { nightsFromToday: 30 }, now });
      return checkAvailability(loaded!.inputs.get(propertyId)!, { from: addNights(today, 3), to: addNights(today, 5) });
    };
    const partial = await ask();
    expect(partial).toMatchObject({ ok: true, value: { verdict: "unknown", certainty: "unverified" } });
    if (!partial.ok) throw new Error(partial.reason);
    expect(partial.value.nights[0].unknownReasons).toContain("source_incomplete");
    expect(partial.value.sources[0]).toMatchObject({ kind: "calendar_feed", state: "incomplete" });

    vi.mocked(fetchFeedText).mockResolvedValue(full(ev("a@x", 10, 12)));
    await syncCalendarSource(sourceId);
    expect(await ask()).toMatchObject({ ok: true, value: { verdict: "available", certainty: "verified" } });
  });
});
