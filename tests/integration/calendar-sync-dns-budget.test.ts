import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// K27-K15 (Codex 11-25 akşam): takvim senkronunun SSRF DNS ön kontrolü 15 sn'lik toplam ağ süresinin DIŞINDAYDI — ön kontrol ne kadar
// sürerse sürsün `fetchFeedText` yine tam 15 sn alıyordu (asılı DNS → süre sınırsız). Pinlenen: ön kontrolün harcadığı süre beslemenin
// süresinden DÜŞÜLÜR (toplam ≤ 15 sn), ön kontrol süreyi bitirirse istek HİÇ açılmaz ve kaynak "error" yazılır; özel adres yine engellenir.
// Saat: yalnız `Date.now` kaydırılır (ön kontrol taklidi "5 sn sürdü" der) — gerçek bekleme yok. Asılı ön kontrolün son anı (gerçek
// zamanlayıcı) `tests/unit/feed-fetch-within.test.ts`te sahte saatle pinli.
// ---------------------------------------------------------------------------

const clock = vi.hoisted(() => ({ offsetMs: 0, dnsCostMs: 0, dnsPrivate: false }));
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/net/private-host", async (orig) => {
  const actual = await orig<typeof import("@/lib/net/private-host")>();
  return {
    ...actual,
    resolvesToPrivate: vi.fn(async () => {
      clock.offsetMs += clock.dnsCostMs; // DNS ön kontrolü "bu kadar sürdü"
      return clock.dnsPrivate;
    }),
  };
});

import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { resolvesToPrivate } from "@/lib/net/private-host";

const ICS = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR";

describe("K15 — takvim senkronu: DNS ön kontrolü toplam süreye dahil", () => {
  beforeEach(async () => {
    await resetDb();
    clock.offsetMs = 0;
    clock.dnsCostMs = 0;
    clock.dnsPrivate = false;
    vi.mocked(fetchFeedText).mockReset();
    vi.mocked(fetchFeedText).mockResolvedValue(ICS);
    vi.mocked(resolvesToPrivate).mockClear();
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock.offsetMs);
  });
  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  async function source() {
    const { propertyId } = await makeOrgWithProperty();
    return prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" } });
  }

  it("ön kontrol 5 sn sürdüyse besleme en fazla ~10 sn alır (toplam 15 sn)", async () => {
    const s = await source();
    clock.dnsCostMs = 5_000;
    const r = await syncCalendarSource(s.id);
    expect(r.errors).toEqual([]);
    expect(resolvesToPrivate).toHaveBeenCalledTimes(1);
    expect(fetchFeedText).toHaveBeenCalledTimes(1);
    const timeoutMs = vi.mocked(fetchFeedText).mock.calls[0]![1].timeoutMs;
    expect(timeoutMs).toBeLessThanOrEqual(10_000);
    expect(timeoutMs).toBeGreaterThan(9_000);
  });

  it("ön kontrol hızlıysa besleme 15 sn'ye yakın süre alır (aşırı kısma yok)", async () => {
    const s = await source();
    await syncCalendarSource(s.id);
    const timeoutMs = vi.mocked(fetchFeedText).mock.calls[0]![1].timeoutMs;
    expect(timeoutMs).toBeLessThanOrEqual(15_000);
    expect(timeoutMs).toBeGreaterThan(14_000);
  });

  it("ön kontrol bütün süreyi yediyse istek HİÇ açılmaz; kaynak error", async () => {
    const s = await source();
    clock.dnsCostMs = 15_000;
    const r = await syncCalendarSource(s.id);
    expect(fetchFeedText).not.toHaveBeenCalled();
    expect(r.errors.length).toBeGreaterThan(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: s.id } })).lastStatus).toBe("error");
  });

  it("özel adrese çözülen ad YİNE engellenir (SSRF ön kontrolü gevşemedi)", async () => {
    const s = await source();
    clock.dnsPrivate = true;
    const r = await syncCalendarSource(s.id);
    expect(fetchFeedText).not.toHaveBeenCalled();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("özel adres DİZESİ DNS'e bile gitmeden engellenir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const s = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://169.254.169.254/cal.ics" } });
    const r = await syncCalendarSource(s.id);
    expect(resolvesToPrivate).not.toHaveBeenCalled();
    expect(fetchFeedText).not.toHaveBeenCalled();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
