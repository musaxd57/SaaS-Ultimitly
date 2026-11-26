import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/lib/event-log", async (orig) => ({ ...(await orig<typeof import("@/lib/event-log")>()), logEvent: vi.fn(async () => {}) }));

import { PADDLE_REPLAY_THRESHOLDS_MS, PADDLE_REPLAY_STUCK_MS, PADDLE_REPLAY_WINDOW_MS } from "@/lib/payments/paddle-replay";
import { nextPaddleReplayAt, PADDLE_REPLAY_THRESHOLDS_MS as SCHEDULE_THRESHOLDS } from "@/lib/payments/paddle-replay-schedule";
import { paddleReplayDue, seeded } from "../helpers/paddle-replay-oracle";
import { probePaddleRead, signPaddleWebhook, verifyPaddleSignature } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// S7 — saf parçalar: yeniden işleme sıklığı (yaş eşikleri), kendi olayımızı yeniden imzalama, anahtar yoklaması.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date("2026-11-11T12:00:00.000Z");
const createdAgo = (ms: number) => new Date(T0.getTime() - ms);
const passAgo = (ms: number) => new Date(T0.getTime() - ms);

// `paddleReplayDue` artık KÂHİNDİR (eski kural, `tests/helpers/paddle-replay-oracle.ts`): aşağıdaki pinler kâhinin eski kuralı aynen
// taşıdığını, sonraki blok yeni satır bazlı çizelgenin onunla aynı kümeyi seçtiğini ölçer.
describe("paddleReplayDue (kâhin) — olay yaşı eşikleri geçtikçe birer kez", () => {
  it("eşikler artan sırada; ilki 'yarıda kaldı' süresiyle aynı; sonuncusu 14 günlük pencerenin içinde", () => {
    expect([...PADDLE_REPLAY_THRESHOLDS_MS]).toEqual([...PADDLE_REPLAY_THRESHOLDS_MS].sort((a, b) => a - b));
    expect(PADDLE_REPLAY_THRESHOLDS_MS[0]).toBe(PADDLE_REPLAY_STUCK_MS);
    expect(PADDLE_REPLAY_THRESHOLDS_MS.at(-1)!).toBeLessThan(PADDLE_REPLAY_WINDOW_MS);
    expect(PADDLE_REPLAY_THRESHOLDS_MS).toHaveLength(10); // olay başına en çok 10 yeniden işleme
  });

  it("ilk tur (son tur bilinmiyor): ilk eşiği geçmiş olay işlenir, geçmemiş olay beklenir", () => {
    expect(paddleReplayDue(createdAgo(14 * MIN), null, T0)).toBe(false);
    expect(paddleReplayDue(createdAgo(15 * MIN), null, T0)).toBe(true); // sınır: tam eşik = geçti
    expect(paddleReplayDue(createdAgo(3 * 24 * HOUR), null, T0)).toBe(true);
  });

  it("🚨 son turdan bu yana yeni bir eşik geçilmediyse İŞLENMEZ (her turda yeniden deneme yok)", () => {
    // Olay 40 dk önce alındı; son tur 20 dk önceydi (o zaman yaşı 20 dk idi → 15 dk eşiği o turda geçilmişti).
    expect(paddleReplayDue(createdAgo(40 * MIN), passAgo(20 * MIN), T0)).toBe(false);
    // Aynı olay 65 dakikalıkken: son turdan (yaş 40 dk) bu yana 1 saat eşiği geçildi.
    expect(paddleReplayDue(createdAgo(65 * MIN), passAgo(25 * MIN), T0)).toBe(true);
  });

  it("sınır: eşik tam son turun anına denk geldiyse o turda sayılmıştır, yeniden sayılmaz", () => {
    // Son turda yaş tam 1 saatti (eşik o turda geçildi) → şimdi 1 sa 30 dk: yeni eşik yok.
    expect(paddleReplayDue(createdAgo(90 * MIN), passAgo(30 * MIN), T0)).toBe(false);
    // Son turda yaş 59 dk idi → şimdi 1 sa 29 dk: 1 saat eşiği bu turda.
    expect(paddleReplayDue(createdAgo(89 * MIN), passAgo(30 * MIN), T0)).toBe(true);
  });

  it("uzun aradan sonra geçilen birden çok eşik TEK işlemedir; son eşikten sonra bir daha işlenmez", () => {
    expect(paddleReplayDue(createdAgo(10 * HOUR), passAgo(9 * HOUR), T0)).toBe(true); // 2, 4, 8 sa birlikte
    expect(paddleReplayDue(createdAgo(300 * HOUR), passAgo(HOUR), T0)).toBe(false); // 256 sa çoktan geçildi
    expect(paddleReplayDue(createdAgo(257 * HOUR), passAgo(2 * HOUR), T0)).toBe(true);
  });

  it("14 gün boyunca saatlik turlarda bir olay en çok eşik sayısı kadar işlenir", () => {
    const created = createdAgo(0);
    let last: Date | null = null;
    let replays = 0;
    for (let h = 0; h <= 14 * 24; h++) {
      const now = new Date(T0.getTime() + h * HOUR + 7 * MIN); // turlar tam saat başında değil
      if (paddleReplayDue(created, last, now)) replays++;
      last = now;
    }
    expect(replays).toBe(PADDLE_REPLAY_THRESHOLDS_MS.length - 1); // 15 dk ile 1 sa aynı ilk turda birleşir (ilk tur 7. dakikada değil 1 sa 7 dk'da)
  });
});

// ---------------------------------------------------------------------------
// Vade OLAYIN SATIRINDA (kurucu 11-18 akşam, migration 98): `nextPaddleReplayAt(createdAt, sonDeneme)`. Eski kural (`paddleReplayDue`,
// ortak son tur) ile AYNI "bu turda denenir" kümesini vermeli: satır bazlı çizelge = her satırın son denemesinden sonra geçilecek ilk eşik.
// Kâhin simülasyonu: aynı tur dizisinde eski kural (son tur = önceki tur) ile yeni kural (vade <= şimdi; denenince sıradaki eşik) yan yana.
// Rastgelelik tohumlu; saat sabit T0 — gerçek saate bağlı değil.
// ---------------------------------------------------------------------------
describe("nextPaddleReplayAt — satır bazlı vade, eski kuralla eşdeğer", () => {
  it("eşikler tek kaynak (yeniden işleme modülü çizelge modülünü dışa verir)", () => {
    expect(PADDLE_REPLAY_THRESHOLDS_MS).toBe(SCHEDULE_THRESHOLDS);
  });

  it("hiç denenmemiş olay: ilk eşik; deneme sonrası: o andaki yaştan BÜYÜK ilk eşik (eşitlik harcanmıştır); eşik kalmayınca null", () => {
    const c = createdAgo(0);
    expect(nextPaddleReplayAt(c, null)!.getTime()).toBe(c.getTime() + 15 * MIN);
    expect(nextPaddleReplayAt(c, c)!.getTime()).toBe(c.getTime() + 15 * MIN);
    expect(nextPaddleReplayAt(c, new Date(c.getTime() + 15 * MIN))!.getTime()).toBe(c.getTime() + HOUR); // tam eşikte denendi → sıradaki
    expect(nextPaddleReplayAt(c, new Date(c.getTime() + 15 * MIN - 1))!.getTime()).toBe(c.getTime() + 15 * MIN);
    expect(nextPaddleReplayAt(c, new Date(c.getTime() + 10 * HOUR))!.getTime()).toBe(c.getTime() + 16 * HOUR); // geçilen 2/4/8 tek denemede
    expect(nextPaddleReplayAt(c, new Date(c.getTime() + 256 * HOUR - 1))!.getTime()).toBe(c.getTime() + 256 * HOUR);
    expect(nextPaddleReplayAt(c, new Date(c.getTime() + 256 * HOUR))).toBeNull();
    expect(nextPaddleReplayAt(c, new Date(c.getTime() - HOUR))!.getTime()).toBe(c.getTime() + 15 * MIN); // geçmiş referans → ilk eşik
  });

  /** Aynı tur dizisini iki kuralla koşturur; her turda denenen kümeler aynı olmalı. */
  function simulate(createdAts: Date[], runs: Date[]): { compared: number; nonEmpty: number } {
    const next = createdAts.map((c) => nextPaddleReplayAt(c, null)); // işleyicinin ilk yazımı
    let prev: Date | null = null;
    let nonEmpty = 0;
    for (const now of runs) {
      const alive = (i: number) => createdAts[i].getTime() <= now.getTime(); // tur anında alınmış olaylar
      const oldSet = createdAts.map((c, i) => alive(i) && paddleReplayDue(c, prev, now));
      const newSet = createdAts.map((_, i) => alive(i) && next[i] !== null && next[i]!.getTime() <= now.getTime());
      expect(newSet, `run=${now.toISOString()}`).toEqual(oldSet);
      newSet.forEach((d, i) => {
        if (d) next[i] = nextPaddleReplayAt(createdAts[i], now);
      });
      if (newSet.some(Boolean)) nonEmpty++;
      prev = now;
    }
    return { compared: runs.length, nonEmpty };
  }

  it("🚨 kâhin: 400 tohumlu zaman çizelgesinde (alınma anları, düzensiz tur anları) eski kuralla BİREBİR aynı küme", () => {
    const rnd = seeded(20261118);
    let nonEmpty = 0;
    for (let s = 0; s < 400; s++) {
      const runs: Date[] = [];
      let t = T0.getTime();
      const nRuns = 5 + Math.floor(rnd() * 30);
      for (let r = 0; r < nRuns; r++) {
        t += 1 + Math.floor(rnd() * (rnd() < 0.5 ? 70 * MIN : rnd() < 0.8 ? 10 * HOUR : 80 * HOUR));
        runs.push(new Date(t));
      }
      const created = Array.from({ length: 12 }, () => new Date(T0.getTime() - 20 * HOUR + Math.floor(rnd() * (t - T0.getTime() + 20 * HOUR))));
      nonEmpty += simulate(created, runs).nonEmpty;
    }
    expect(nonEmpty).toBeGreaterThan(1_000); // kâhin boş değil
  });

  it("🚨 kâhin: sınır eşitlikleri — tur anı bir eşiğe tam denk / ±1 ms", () => {
    const c = createdAgo(0);
    for (const t of PADDLE_REPLAY_THRESHOLDS_MS) {
      for (const d of [-1, 0, 1]) {
        simulate([c], [new Date(c.getTime() + 5 * MIN), new Date(c.getTime() + t + d), new Date(c.getTime() + t + d + 1), new Date(c.getTime() + 2 * t + d)]);
      }
    }
  });

  it("14 gün boyunca saatlik turlarda bir olay en çok eşik sayısı kadar denenir (yeni çizelgeyle)", () => {
    const created = createdAgo(0);
    let next = nextPaddleReplayAt(created, null);
    let replays = 0;
    for (let h = 0; h <= 14 * 24; h++) {
      const now = new Date(T0.getTime() + h * HOUR + 7 * MIN);
      if (next && next.getTime() <= now.getTime()) {
        replays++;
        next = nextPaddleReplayAt(created, now);
      }
    }
    expect(replays).toBe(PADDLE_REPLAY_THRESHOLDS_MS.length - 1); // 15 dk ile 1 sa aynı ilk turda birleşir (kâhin testiyle aynı)
  });
});

describe("signPaddleWebhook — yalnız kendi sakladığımız olayı yeniden imzalamak için", () => {
  const SECRET = "test-webhook-hmac-key-not-a-real-secret";
  const BODY = JSON.stringify({ event_id: "evt_1", event_type: "subscription.updated", data: { id: "sub_1" } });

  it("ürettiği başlık doğrulayıcıdan geçer; gövde, sır ya da zaman değişirse geçmez", () => {
    const ts = 1_800_000_000;
    const header = signPaddleWebhook(BODY, SECRET, ts);
    expect(header).toMatch(/^ts=1800000000;h1=[0-9a-f]{64}$/);
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: BODY, secret: SECRET, now: ts })).toBe(true);
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: `${BODY} `, secret: SECRET, now: ts })).toBe(false);
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: BODY, secret: "baska-sir", now: ts })).toBe(false);
    expect(verifyPaddleSignature({ signatureHeader: header, rawBody: BODY, secret: SECRET, now: ts + 6 * 60 })).toBe(false); // 5 dk penceresi
  });
});

describe("probePaddleRead — API anahtarımız şu an okuyabiliyor mu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const respond = (status: number, body: unknown = {}) =>
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as unknown as Response);

  it("anahtar tanımlı değilse sağlayıcıya gidilmez", async () => {
    vi.stubEnv("PADDLE_API_KEY", "");
    const spy = respond(200);
    expect(await probePaddleRead()).toBe("unconfigured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("tek ucuz okuma: abonelik listesinin ilk kaydı (işleyicinin ihtiyaç duyduğu yetkiyle aynı kaynak)", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    const spy = respond(200, { data: [] });
    expect(await probePaddleRead()).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/\/subscriptions\?per_page=1$/);
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("🚨 anahtar reddedildi (401 / 403), hız sınırı, sunucu hatası ve ağ hatası = okunamadı", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    for (const status of [401, 403, 429, 500, 503, 408]) {
      respond(status, { error: { code: "x" } });
      expect(await probePaddleRead(), String(status)).toBe("unreadable");
      vi.restoreAllMocks();
    }
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await probePaddleRead()).toBe("unreadable");
  });

  it("yetkiyle ilgisiz bir ret (ör. 400) anahtarın tanındığını gösterir → okunabilir", async () => {
    vi.stubEnv("PADDLE_API_KEY", "test-key");
    respond(400, { error: { code: "bad_request" } });
    expect(await probePaddleRead()).toBe("ok");
  });
});
