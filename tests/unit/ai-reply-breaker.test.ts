import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Kurucu 10-21 ("bekleme uzamasın", "model düşmesin"): cevap çağrısının devre kesicisi + tek hızlı yeniden deneme + zaman tavanı.
// Sözleşme `src/lib/ai/model-breaker.ts`. Misafire giden değişmez: model cevabı yokken sonuç her zaman deterministik yedek
// (`source: "fallback"`) — otomatik gönderim kapısı onu zaten göndermez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({
  alertOnTransition: vi.fn(async () => "alerted"),
  clearAlertState: vi.fn(async () => {}),
}));

import { reportError } from "@/lib/report-error";
import { alertOnTransition } from "@/lib/alert-state";
import { suggestReply } from "@/lib/ai";
import {
  REPLY_BREAKER_COOLDOWN_MS,
  REPLY_BREAKER_THRESHOLD,
  REPLY_BREAKER_STREAK_GAP_MS,
  __replyBreakerTenantCountForTests,
  __resetReplyModelBreakerForTests,
  noteReplyModelResponded,
  noteReplyModelTimeout,
  replyModelCallAllowed,
  replyRetryDelayMs,
  replyTimeoutMs,
} from "@/lib/ai/model-breaker";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReport = vi.mocked(reportError);
const mockAlert = vi.mocked(alertOnTransition);

const input: SuggestReplyInput = {
  guestMessage: "Otopark var mı?",
  property: { name: "Lale Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "", city: "İstanbul" },
  reservation: { guestName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
};

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              intent: "parking",
              confidence: 0.9,
              reply: "Binanın önünde ücretsiz park yeri var.",
              priority: "standard",
              riskLevel: "none",
              detectedLanguage: "tr",
            }),
          },
        },
      ],
    }),
    { status: 200 },
  );
}
const timeout = () => {
  throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
};
const breakerReports = () => mockReport.mock.calls.filter((c) => c[0] === "openai-reply devre kesici").length;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mockReport.mockClear();
  mockAlert.mockClear();
  __resetReplyModelBreakerForTests(0);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("devre kesici: art arda zaman aşımı beklemeyi uzatmaz", () => {
  it(`${REPLY_BREAKER_THRESHOLD} ardışık zaman aşımından sonra çağrı yapılmaz, sonuç yedek; açılış TEK kez raporlanır`, async () => {
    const f = vi.fn(async () => timeout());
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) expect((await suggestReply(input)).source).toBe("fallback");
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD); // zaman aşımı yeniden DENENMEZ (bekleme ikiye katlanmaz)
    expect(breakerReports()).toBe(1);
    for (let i = 0; i < 5; i++) expect((await suggestReply(input)).source).toBe("fallback");
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD); // kesici açık: ağa hiç çıkılmadı
    expect(breakerReports()).toBe(1);
  });

  it("kontrol: eşiğin bir altı kesiciyi açmaz", async () => {
    const f = vi.fn(async () => timeout());
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD - 1; i++) await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    expect((await suggestReply(input)).source).toBe("openai");
    expect(breakerReports()).toBe(0);
  });

  it("bekleme dolunca tek deneme: cevap gelirse kesici kapanır; yine zaman aşımıysa hemen yeniden açılır", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-21T10:00:00Z").getTime();
    vi.setSystemTime(t0);
    const f = vi.fn(async () => timeout());
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) await suggestReply(input);
    vi.setSystemTime(t0 + REPLY_BREAKER_COOLDOWN_MS - 1);
    await suggestReply(input);
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD); // bekleme dolmadı
    vi.setSystemTime(t0 + REPLY_BREAKER_COOLDOWN_MS);
    await suggestReply(input); // tek deneme, yine zaman aşımı
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD + 1);
    await suggestReply(input); // hemen yeniden açıldı
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD + 1);
    vi.setSystemTime(t0 + 3 * REPLY_BREAKER_COOLDOWN_MS);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    expect((await suggestReply(input)).source).toBe("openai");
    // Kapandı: tek zaman aşımı artık kesiciyi açmaz.
    const g = vi.fn(async () => timeout());
    vi.stubGlobal("fetch", g);
    await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    expect((await suggestReply(input)).source).toBe("openai");
  });

  it("hızlı dönen hata (503) zaman aşımı sayılmaz: kesici açılmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream", { status: 503 })));
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD + 2; i++) await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    expect((await suggestReply(input)).source).toBe("openai");
    expect(breakerReports()).toBe(0);
  });
});

describe("tek hızlı yeniden deneme", () => {
  it("503 sonra başarı → model cevabı; arıza raporu yok", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("upstream", { status: 503 })).mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", f);
    const r = await suggestReply(input);
    expect(r.source).toBe("openai");
    expect(f).toHaveBeenCalledTimes(2);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("hız sınırı 429 sonra başarı → model cevabı", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", f);
    expect((await suggestReply(input)).source).toBe("openai");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("ağ hatası (zaman aşımı değil) sonra başarı → model cevabı", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", f);
    expect((await suggestReply(input)).source).toBe("openai");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("iki kez 503 → yalnız İKİ deneme, yedek, tek rapor", async () => {
    const f = vi.fn(async () => new Response("upstream", { status: 503 }));
    vi.stubGlobal("fetch", f);
    expect((await suggestReply(input)).source).toBe("fallback");
    expect(f).toHaveBeenCalledTimes(2);
    expect(mockReport.mock.calls.map((c) => c[0])).toEqual(["openai-reply 503"]);
  });

  it("kalıcı arıza (kota bitti) yeniden DENENMEZ, geçiş alarmına gider", async () => {
    const f = vi.fn(
      async () =>
        new Response('{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}', { status: 429 }),
    );
    vi.stubGlobal("fetch", f);
    expect((await suggestReply(input)).source).toBe("fallback");
    expect(f).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 404])("%i yeniden denenmez", async (status) => {
    const f = vi.fn(async () => new Response("{}", { status }));
    vi.stubGlobal("fetch", f);
    await suggestReply(input);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("zaman tavanı ve bekleme hesabı", () => {
  it("reasoning: 30 sn (high çaba 60); reasoning olmayan 20 sn", () => {
    expect(replyTimeoutMs(true, null)).toBe(30_000);
    expect(replyTimeoutMs(true, "none")).toBe(30_000);
    expect(replyTimeoutMs(true, "medium")).toBe(30_000);
    expect(replyTimeoutMs(true, "high")).toBe(60_000);
    expect(replyTimeoutMs(false, null)).toBe(20_000);
  });

  it("çağrı hesaplanan tavanla yapılır (canlı varsayılan model)", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    await suggestReply(input);
    expect(spy).toHaveBeenCalledWith(30_000);
    spy.mockRestore();
  });

  it("Retry-After saniye olarak dinlenir, 3 sn tavanlı; yoksa / bozuksa 1 sn", () => {
    __resetReplyModelBreakerForTests(null);
    expect(replyRetryDelayMs(null)).toBe(1_000);
    expect(replyRetryDelayMs("2")).toBe(2_000);
    expect(replyRetryDelayMs("0.5")).toBe(500);
    expect(replyRetryDelayMs("10")).toBe(3_000);
    expect(replyRetryDelayMs("abc")).toBe(1_000);
    expect(replyRetryDelayMs("-1")).toBe(1_000);
  });
});

describe("Haiku 10-21 bulguları", () => {
  it("önce hızlı 429, yeniden denemede takılma: zaman aşımları birikir, kesici açılır (geçici hata kesiciyi kapatmaz)", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response("{}", { status: 429 }));
    let n = 0;
    f.mockImplementation(async () => {
      n++;
      if (n % 2 === 1) return new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 });
      return timeout();
    });
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) await suggestReply(input);
    expect(breakerReports()).toBe(1);
    const before = f.mock.calls.length;
    await suggestReply(input);
    expect(f.mock.calls.length).toBe(before); // açık: ağa çıkılmadı
  });

  it("iki kez geçici hata (503) alan çağrı sayacı SIFIRLAMAZ: arada 503 olsa da art arda zaman aşımları kesiciyi açar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => timeout()));
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD - 1; i++) await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream", { status: 503 })));
    await suggestReply(input); // iki deneme de 503 → sağlayıcı sağlıklı sayılmaz
    vi.stubGlobal("fetch", vi.fn(async () => timeout()));
    await suggestReply(input);
    expect(breakerReports()).toBe(1);
  });

  it("KONTROL: kesin ret (400) sağlayıcının takılmadığını gösterir → sayaç sıfırlanır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => timeout()));
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD - 1; i++) await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await suggestReply(input);
    vi.stubGlobal("fetch", vi.fn(async () => timeout()));
    await suggestReply(input);
    expect(breakerReports()).toBe(0);
  });

  it("gövde okunurken zaman aşımı da sayılır", async () => {
    const hanging = () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => timeout(),
        text: async () => "",
      }) as unknown as Response;
    const f = vi.fn(async () => hanging());
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) expect((await suggestReply(input)).source).toBe("fallback");
    expect(breakerReports()).toBe(1);
    await suggestReply(input);
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD);
  });

  it("bekleme dolunca YALNIZ bir deneme geçer (eşzamanlı ikinci çağrı beklemez, model-yok yoluna gider)", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) noteReplyModelTimeout("org-a", t0);
    expect(replyModelCallAllowed("org-a", t0 + 1)).toBe(false);
    const after = t0 + REPLY_BREAKER_COOLDOWN_MS;
    expect(replyModelCallAllowed("org-a", after)).toBe(true); // deneme kirası
    expect(replyModelCallAllowed("org-a", after + 10)).toBe(false); // kira süresince ikinci çağrı yok
  });

  it("açılış YALNIZ bir kez raporlanır: açıkken düşen çağrılar (deneme dahil) yeniden rapor üretmez", () => {
    const t0 = 2_000_000;
    const opened = Array.from({ length: REPLY_BREAKER_THRESHOLD + 3 }, () => noteReplyModelTimeout("org-a", t0));
    expect(opened.filter(Boolean)).toHaveLength(1);
    expect(noteReplyModelTimeout("org-a", t0 + REPLY_BREAKER_COOLDOWN_MS + 5)).toBe(false); // deneme yine düştü → yeniden açıldı, rapor yok
  });
});

// Güvenlik incelemesi 10-21 P3: kesici kiracı başına. Bir işletmenin (ya da misafirinin) art arda zaman aşımları öteki işletmeleri
// durdurmaz; ortak kesici yalnız dizi EN AZ İKİ işletmeden gelince açılır (gerçek sağlayıcı arızası).
describe("devre kesici: kiracılar arası yalıtım", () => {
  it("bir işletmenin üç zaman aşımı YALNIZ onu bekletir; öteki işletme çağırmaya devam eder", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) noteReplyModelTimeout("org-a", t0);
    expect(replyModelCallAllowed("org-a", t0 + 1)).toBe(false);
    expect(replyModelCallAllowed("org-b", t0 + 1)).toBe(true);
    expect(replyModelCallAllowed(undefined, t0 + 1)).toBe(true);
  });

  it("art arda zaman aşımları iki işletmeden geliyorsa ortak kesici açılır: üçüncü işletme de bekler", () => {
    const t0 = 4_000_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-a", t0);
    expect(noteReplyModelTimeout("org-b", t0)).toBe(true); // ortak açıldı (tek rapor)
    expect(replyModelCallAllowed("org-c", t0 + 1)).toBe(false);
    expect(replyModelCallAllowed("org-c", t0 + REPLY_BREAKER_COOLDOWN_MS)).toBe(true); // bekleme bitti → tek deneme
  });

  it("KONTROL: başka bir işletmenin cevabı ortak diziyi sıfırlar (sağlayıcı ayakta), saldırganın kendi dizisini değil", () => {
    const t0 = 5_000_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-b", t0);
    noteReplyModelResponded("org-b");
    noteReplyModelTimeout("org-a", t0);
    expect(replyModelCallAllowed("org-c", t0 + 1)).toBe(true); // ortak dizi sıfırlandı: 1 zaman aşımı
    expect(noteReplyModelTimeout("org-a", t0)).toBe(true); // org-a kendi dizisinde üçüncü → yalnız o açıldı
    expect(replyModelCallAllowed("org-a", t0 + 1)).toBe(false);
    expect(replyModelCallAllowed("org-c", t0 + 1)).toBe(true);
  });

  it("uçtan uca: A işletmesinin çağrıları takılınca kesici açılır, B işletmesinin çağrısı yine modele gider", async () => {
    const f = vi.fn<() => Promise<Response>>(async () => timeout());
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) await suggestReply({ ...input, breakerKey: "org-a" });
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD);
    await suggestReply({ ...input, breakerKey: "org-a" });
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD); // A bekliyor
    f.mockImplementation(async () => okResponse());
    const b = await suggestReply({ ...input, breakerKey: "org-b" });
    expect(f).toHaveBeenCalledTimes(REPLY_BREAKER_THRESHOLD + 1);
    expect(b.source).toBe("openai");
  });
});

// Haiku 10-21 incelemesi: kira israfı, bayat dizi, sessiz kiracı kaydı.
describe("devre kesici: kira, dizi penceresi, temizlik", () => {
  it("#1 A kendi beklemesindeyken reddedilir; ortak kesici kapalıysa B ve C çağırır (A'nın reddi kira almaz)", () => {
    const t0 = 7_000_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-b", t0);
    noteReplyModelTimeout("org-b", t0); // ortak açıldı (bitiş t0+60s); B henüz eşikte değil (2)
    noteReplyModelTimeout("org-a", t0 + 50_000); // ortak yenilendi (bitiş t0+110s)
    noteReplyModelTimeout("org-a", t0 + 55_000); // A eşiği → A bitiş t0+115s; ortak bitiş t0+115s
    // Ortak bekleme bitti ama A'nınki bitmedi senaryosu: A'yı ortağın önüne geçirmek için ortağı B'nin cevabıyla kapatıp yeniden kur.
    noteReplyModelResponded("org-b"); // sağlayıcı B'ye cevap verdi → ortak kapandı; A kendi beklemesinde
    const now = t0 + 60_000;
    expect(replyModelCallAllowed("org-a", now)).toBe(false); // A bekliyor
    expect(replyModelCallAllowed("org-b", now)).toBe(true); // B geçer (ortak kira israf edilmedi)
    expect(replyModelCallAllowed("org-c", now)).toBe(true);
  });

  it("#2 bayat zaman aşımları diziye sayılmaz: saatler önceki iki zaman aşımı + bugünkü bir tanesi kesiciyi açmaz", () => {
    const t0 = 8_000_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-a", t0);
    const later = t0 + REPLY_BREAKER_STREAK_GAP_MS + 1;
    expect(noteReplyModelTimeout("org-b", later)).toBe(false); // ortak açılmadı
    expect(noteReplyModelTimeout("org-a", later)).toBe(false); // A'nın dizisi de baştan başladı (1)
    expect(replyModelCallAllowed("org-c", later + 1)).toBe(true);
    expect(replyModelCallAllowed("org-a", later + 1)).toBe(true);
  });

  it("#2 aynı işletmenin kendi bayat dizisi de sıfırlanır (araya başka işletme girmeden)", () => {
    const t0 = 8_500_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-a", t0);
    expect(noteReplyModelTimeout("org-a", t0 + REPLY_BREAKER_STREAK_GAP_MS + 1)).toBe(false); // 3. ama bayat → dizi 1
    expect(replyModelCallAllowed("org-a", t0 + REPLY_BREAKER_STREAK_GAP_MS + 2)).toBe(true);
  });

  it("#2 KONTROL: yakın aralıklı (30 sn) zaman aşımları dizi sayılır", () => {
    const t0 = 9_000_000;
    noteReplyModelTimeout("org-a", t0);
    noteReplyModelTimeout("org-a", t0 + 30_000);
    expect(noteReplyModelTimeout("org-a", t0 + 60_000)).toBe(true);
  });

  it("#3 sessizleşen kiracının kaydı silinir; açık beklemedeki kayıt silinmez", () => {
    const t0 = 10_000_000;
    noteReplyModelTimeout("org-a", t0);
    for (let i = 0; i < REPLY_BREAKER_THRESHOLD; i++) noteReplyModelTimeout("org-b", t0); // B açık (bitiş t0+60s)
    expect(__replyBreakerTenantCountForTests()).toBe(2);
    noteReplyModelTimeout("org-c", t0 + 30_000);
    expect(__replyBreakerTenantCountForTests()).toBe(3); // henüz bayat değil
    noteReplyModelTimeout("org-c", t0 + REPLY_BREAKER_STREAK_GAP_MS + 1);
    expect(__replyBreakerTenantCountForTests()).toBe(1); // A ve B (beklemesi bitmiş) silindi, C kaldı
  });
});
