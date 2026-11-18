import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/lib/event-log", async (orig) => ({ ...(await orig<typeof import("@/lib/event-log")>()), logEvent: vi.fn(async () => {}) }));

import { paddleReplayDue, paddleReplayDueWhere, PADDLE_REPLAY_THRESHOLDS_MS, PADDLE_REPLAY_STUCK_MS, PADDLE_REPLAY_WINDOW_MS } from "@/lib/payments/paddle-replay";
import { probePaddleRead, signPaddleWebhook, verifyPaddleSignature } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// S7 — saf parçalar: yeniden işleme sıklığı (yaş eşikleri), kendi olayımızı yeniden imzalama, anahtar yoklaması.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date("2026-11-11T12:00:00.000Z");
const createdAgo = (ms: number) => new Date(T0.getTime() - ms);
const passAgo = (ms: number) => new Date(T0.getTime() - ms);

describe("paddleReplayDue — olay yaşı eşikleri geçtikçe birer kez", () => {
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
// Codex 11-17 B1 — vade koşulu SORGUYA iner (`paddleReplayDueWhere`). Seçim artık bu `where` parçasıyla yapılıyor; `paddleReplayDue` ile
// BİREBİR aynı kümeyi seçmeli (sınır eşitlikleri dahil). Kâhin: `where` parçasını bellekte değerlendiren küçük yorumlayıcı — yalnız
// `createdAt` üzerindeki gt / gte / lt / lte anahtarlarını tanır, başka bir şekil görürse FIRLATIR (şekil değişirse test sessizce boşa düşmez).
// Rastgelelik tohumlu (her koşuda aynı girdiler); saat sabit T0 — gerçek saate bağlı değil.
// ---------------------------------------------------------------------------
type CreatedAtCond = { gt?: Date; gte?: Date; lt?: Date; lte?: Date };
function evalDueWhere(where: unknown, createdAt: Date): boolean {
  const w = where as { OR?: unknown[] };
  if (!w || !Array.isArray(w.OR) || Object.keys(w).length !== 1) throw new Error(`beklenmeyen şekil: ${JSON.stringify(where)}`);
  return w.OR.some((clause) => {
    const c = clause as { createdAt?: CreatedAtCond };
    if (!c || Object.keys(c).length !== 1 || !c.createdAt) throw new Error(`beklenmeyen şekil: ${JSON.stringify(clause)}`);
    const x = createdAt.getTime();
    return Object.entries(c.createdAt).every(([op, v]) => {
      if (!(v instanceof Date)) throw new Error(`beklenmeyen değer: ${op}`);
      const y = v.getTime();
      if (op === "gt") return x > y;
      if (op === "gte") return x >= y;
      if (op === "lt") return x < y;
      if (op === "lte") return x <= y;
      throw new Error(`beklenmeyen işleç: ${op}`);
    });
  });
}
/** Tohumlu, belirlenimci sayı üreteci (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("paddleReplayDueWhere — vade koşulunun sorgu parçası (Codex 11-17 B1)", () => {
  const compare = (createdAt: Date, lastPassAt: Date | null, now: Date) =>
    expect(evalDueWhere(paddleReplayDueWhere(lastPassAt, now), createdAt), `created=${createdAt.toISOString()} last=${lastPassAt?.toISOString() ?? "yok"}`).toBe(
      paddleReplayDue(createdAt, lastPassAt, now),
    );

  it("🚨 kâhin: sınır değerlerinde (her eşik için tam sınır ve ±1 ms, son turla ve şimdiyle) paddleReplayDue ile BİREBİR aynı", () => {
    const lasts: (Date | null)[] = [null, passAgo(0), passAgo(1), passAgo(10 * MIN), passAgo(15 * MIN), passAgo(HOUR), passAgo(9 * HOUR), passAgo(300 * HOUR), new Date(T0.getTime() + MIN)];
    let checked = 0;
    for (const last of lasts) {
      for (const t of PADDLE_REPLAY_THRESHOLDS_MS) {
        const anchors = [T0.getTime() - t, ...(last ? [last.getTime() - t] : [])];
        for (const a of anchors) {
          for (const d of [-1, 0, 1]) {
            compare(new Date(a + d), last, T0);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("🚨 kâhin: 20.000 tohumlu rastgele (oluşturma, son tur, şimdi) üçlüsünde aynı; iki sonuç da yeterince çıkıyor (kâhin boş değil)", () => {
    const rnd = seeded(20261117);
    let due = 0;
    let notDue = 0;
    for (let i = 0; i < 20_000; i++) {
      const now = new Date(T0.getTime() + Math.floor(rnd() * 30 * 24 * HOUR));
      const created = new Date(now.getTime() - Math.floor(rnd() * 300 * HOUR) + Math.floor(rnd() * HOUR) - HOUR / 2);
      const last = rnd() < 0.15 ? null : new Date(now.getTime() - Math.floor(rnd() * (rnd() < 0.5 ? 2 * HOUR : 300 * HOUR)));
      const expected = paddleReplayDue(created, last, now);
      compare(created, last, now);
      if (expected) due++;
      else notDue++;
    }
    expect(due).toBeGreaterThan(1_000);
    expect(notDue).toBeGreaterThan(1_000);
  });

  it("son tur bilinmiyorsa (ilk tur) alt sınır yok; biliniyorsa her eşik için tek kapalı-açık aralık", () => {
    const first = paddleReplayDueWhere(null, T0) as { OR: { createdAt: CreatedAtCond }[] };
    expect(first.OR).toHaveLength(PADDLE_REPLAY_THRESHOLDS_MS.length);
    for (const c of first.OR) expect(Object.keys(c.createdAt)).toEqual(["lte"]);
    const later = paddleReplayDueWhere(passAgo(HOUR), T0) as { OR: { createdAt: CreatedAtCond }[] };
    for (const c of later.OR) expect(Object.keys(c.createdAt).sort()).toEqual(["gt", "lte"]);
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
