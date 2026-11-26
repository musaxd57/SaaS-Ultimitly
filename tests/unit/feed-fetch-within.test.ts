import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// K27-K15: asılı DNS ön kontrolü takvim beslemesinin TOPLAM süresini aşamaz. Sahte saat (gerçek bekleme yok): ön kontrol hiç dönmezse
// süre dolunca "feed deadline exceeded" ile düşer ve istek HİÇ açılmaz. (Senkron motoruna bağlantısı:
// tests/integration/calendar-sync-dns-budget.test.ts.)

const h = vi.hoisted(() => ({ dns: null as null | (() => Promise<boolean>) }));
vi.mock("@/lib/net/private-host", async (orig) => {
  const actual = await orig<typeof import("@/lib/net/private-host")>();
  return { ...actual, resolvesToPrivate: vi.fn((host: string) => (h.dns ? h.dns() : actual.resolvesToPrivate(host))) };
});
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn(async () => "BEGIN:VCALENDAR") }));

import { fetchPublicFeedWithin } from "@/lib/net/feed-fetch-within";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { resolvesToPrivate } from "@/lib/net/private-host";

const OPTS = { totalMs: 15_000, maxBytes: 1024, userAgent: "t" };

describe("fetchPublicFeedWithin — DNS ön kontrolü toplam süreye dahil", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.mocked(fetchFeedText).mockClear();
    vi.mocked(resolvesToPrivate).mockClear();
    h.dns = null;
  });
  afterEach(() => vi.useRealTimers());

  it("hiç dönmeyen DNS → süre dolunca düşer, istek açılmaz", async () => {
    h.dns = () => new Promise<boolean>(() => {});
    const p = fetchPublicFeedWithin("https://example.com/cal.ics", OPTS);
    const settled = p.then(
      () => "resolved",
      (e: unknown) => (e as Error).message,
    );
    await vi.advanceTimersByTimeAsync(14_999);
    let state = "pending";
    void settled.then((s) => (state = s));
    await Promise.resolve();
    expect(state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe("feed deadline exceeded");
    expect(fetchFeedText).not.toHaveBeenCalled();
  });

  it("DNS 4 sn sürerse besleme kalan ~11 sn'yi alır", async () => {
    h.dns = () => new Promise<boolean>((r) => setTimeout(() => r(false), 4_000));
    const p = fetchPublicFeedWithin("https://example.com/cal.ics", OPTS);
    await vi.advanceTimersByTimeAsync(4_000);
    await p;
    expect(vi.mocked(fetchFeedText).mock.calls[0]![1].timeoutMs).toBe(11_000);
  });

  it("özel adrese çözülen ad engellenir; özel adres dizesi DNS'e gitmez", async () => {
    h.dns = async () => true;
    await expect(fetchPublicFeedWithin("https://example.com/cal.ics", OPTS)).rejects.toThrow("blocked private host");
    h.dns = null;
    await expect(fetchPublicFeedWithin("https://10.0.0.5/cal.ics", OPTS)).rejects.toThrow("blocked private host");
    expect(resolvesToPrivate).toHaveBeenCalledTimes(1);
    expect(fetchFeedText).not.toHaveBeenCalled();
  });

  it("zamanlayıcı başarıda temizlenir (askıda zamanlayıcı bırakmaz)", async () => {
    h.dns = async () => false;
    await fetchPublicFeedWithin("https://example.com/cal.ics", OPTS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
