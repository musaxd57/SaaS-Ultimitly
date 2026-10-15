import { describe, it, expect, vi, afterEach } from "vitest";
import {
  adoptCorrelation,
  currentCorrelation,
  currentCorrelationId,
  isCorrelationId,
  isShortCorrelationId,
  newCorrelationId,
  runWithCorrelation,
  shortCorrelationId,
} from "@/lib/correlation";
import { OPERATIONAL_EVENTS, sanitizeEventData } from "@/lib/event-log";
import { serverError } from "@/lib/api";
import { reportError as reportErrorCore, __resetReportThrottle } from "@/lib/report-error-core";
import { emailService } from "@/lib/email-core";

// ---------------------------------------------------------------------------
// TAKİP NUMARASI (kurucu kararı 10-10 §5): numara biçimi, eşzamanlı istek yalıtımı, zincire katılma kuralı, olay verisi süzgeci
// (kişisel veri / serbest metin SIĞMAZ), 500 yanıtı metni (kurucunun metni AYNEN; anonim rotada eski metin).
// ---------------------------------------------------------------------------

const FOUNDER_TEXT = /^Bir sorun oluştu\. Destek ekibimize bu takip numarasıyla yazarak destek alabilirsiniz: [0-9a-f]{8}$/;

describe("takip numarası", () => {
  it("yeni numara UUID v4 küçük harf; kısa biçim ilk 8 karakter; biçim denetimi bozuk / büyük harfli / kısa değeri reddeder", () => {
    const id = newCorrelationId();
    expect(isCorrelationId(id)).toBe(true);
    expect(shortCorrelationId(id)).toBe(id.slice(0, 8));
    expect(isShortCorrelationId(shortCorrelationId(id))).toBe(true);
    expect(isCorrelationId(id.toUpperCase())).toBe(false);
    expect(isCorrelationId(`${id} `)).toBe(false);
    expect(isCorrelationId("x")).toBe(false);
    expect(isCorrelationId(null)).toBe(false);
    expect(isShortCorrelationId("7f3a91b")).toBe(false);
    expect(isShortCorrelationId("7f3a91bz")).toBe(false);
    expect(new Set(Array.from({ length: 200 }, newCorrelationId)).size).toBe(200);
  });

  it("🚨 eşzamanlı iki işlem birbirinin numarasını GÖRMEZ (await zinciri boyunca)", async () => {
    const seen: Array<[string, string | null]> = [];
    const job = (id: string, delay: number) =>
      runWithCorrelation({ id, organizationId: `org-${id.slice(0, 4)}` }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push([id, currentCorrelationId()]);
        await Promise.resolve();
        seen.push([id, currentCorrelation()?.organizationId ?? null]);
      });
    const a = newCorrelationId();
    const b = newCorrelationId();
    await Promise.all([job(a, 20), job(b, 5)]);
    for (const [id, got] of seen) expect(got?.startsWith(id) || got === `org-${id.slice(0, 4)}`).toBe(true);
    expect(currentCorrelationId()).toBeNull(); // işlem dışında numara yok
  });

  it("zincire katılma: yalnız işlem içinde ve yalnız geçerli biçimdeki numarayla; dış işlem etkilenmez", async () => {
    expect(adoptCorrelation(newCorrelationId())).toBe(false); // işlem yok
    const outer = newCorrelationId();
    const chain = newCorrelationId();
    await runWithCorrelation({ id: outer, organizationId: null }, async () => {
      expect(adoptCorrelation("istemciden-gelen-deger")).toBe(false);
      expect(currentCorrelationId()).toBe(outer);
      expect(adoptCorrelation(chain, "org-1")).toBe(true);
      expect(currentCorrelationId()).toBe(chain);
      expect(currentCorrelation()?.organizationId).toBe("org-1");
    });
    expect(currentCorrelationId()).toBeNull();
  });

  it("işlem bağlamı KOPYALANIR: zincire katılma çağıranın nesnesini değiştirmez (aynı nesneyle açılan ikinci işlem eski numarada kalır)", async () => {
    const ctx = { id: newCorrelationId(), organizationId: null };
    const original = ctx.id;
    await runWithCorrelation(ctx, async () => {
      adoptCorrelation(newCorrelationId(), "org-x");
    });
    expect(ctx).toEqual({ id: original, organizationId: null });
    await runWithCorrelation(ctx, async () => expect(currentCorrelationId()).toBe(original));
  });
});

describe("olay verisi süzgeci — kişisel veri / serbest metin SIĞMAZ", () => {
  it("izinli anahtar + anahtar başına kalıp geçer", () => {
    const ok = {
      plan: "pro",
      consentId: "cmabc123def",
      httpStatus: 404,
      eventType: "subscription.activated",
      subscriptionRef: "sub_01hx9abc",
      transactionRef: "txn_01hx9abc",
      providerEventId: "evt_01hx9abc",
      providerRequestId: "7f3a91b2-6d84-4e0c-9a52-18b7d6c403ef",
      method: "PATCH",
      currency: "TRY",
    };
    expect(sanitizeEventData(ok)).toEqual(ok);
  });

  it.each([
    ["e-posta", { consentId: "misafir@example.com" }],
    ["ad soyad (boşluk)", { reason: "Ayşe Yılmaz" }],
    ["kimlik alanında ad soyad (redaksiyon yakalamaz — biçim kuralı yakalar)", { subscriptionRef: "Ayşe Yılmaz" }],
    ["kimlik alanında Türkçe harfli tek sözcük", { consentId: "Yılmaz" }],
    // Haiku güvenlik incelemesi 10-12: rakam dizisi (telefon / TC kimlik) ve kalıba uymayan kimlik.
    ["istek kimliğinde telefon rakamları", { providerRequestId: "05551112233" }],
    ["kodda TC kimlik numarası", { reason: "12345678901" }],
    ["abonelik alanında sub_ olmayan değer", { subscriptionRef: "Ayse-Yilmaz" }],
    ["olay kimliğinde rakam dizisi", { providerEventId: "evt_05551112233" }],
    ["olay kimliğinde redaksiyonun yakalamadığı 7 haneli dizi", { providerEventId: "evt_1234567" }],
    ["yöntem alanında serbest metin", { method: "get all" }],
    ["para biriminde uzun kod", { currency: "TRYX" }],
    ["prototip anahtarı", { constructor: "x", __proto__: "y" }],
    ["telefon (+)", { providerRequestId: "+905551112233" }],
    ["cümle", { context: "ödeme başarısız oldu çünkü kart reddedildi" }],
    ["jeton", { providerRequestId: "Bearer abc.def.ghi" }],
    ["JWT biçimi", { consentId: "eyJhbGciOiJIUzI1NiJ9xxxxxxxxxxxxxxxxxxxxxxxx" }],
    ["izinsiz anahtar", { email: "x", guestName: "y", message: "z" }],
    ["ondalık / NaN sayı", { amountMinor: 1.5, httpStatus: Number.NaN }],
    ["sayı yerine metin", { httpStatus: "500" }],
  ])("%s → düşer, yalnız düşen sayısı kalır", (_label, data) => {
    const out = sanitizeEventData(data as Record<string, unknown>);
    expect(out).toEqual({ _dropped: Object.keys(data).length });
    expect(JSON.stringify(out)).not.toMatch(/Yılmaz|Yilmaz|5551112233|12345678901|@/);
  });

  it("olay adı kapalı küme (anti-vakum: ödeme zinciri adımları kayıtlı)", () => {
    expect(Object.keys(OPERATIONAL_EVENTS)).toEqual(
      expect.arrayContaining(["billing.consent.created", "billing.webhook.received", "billing.subscription.applied", "error.reported"]),
    );
    for (const level of Object.values(OPERATIONAL_EVENTS)) expect(["info", "warn", "error"]).toContain(level);
  });
});

describe("500 yanıtı — takip numarası (kurucu metni AYNEN; ekranda YALNIZ ödeme — kurucu kararı 10-12 sabah)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ödeme ekranı ucunda (gösterilebilir numara): kurucunun metni + kısa numara, tam numara gövdede", async () => {
    const id = newCorrelationId();
    const res = await runWithCorrelation({ id, organizationId: null, showToUser: true }, async () => serverError());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(FOUNDER_TEXT);
    expect(body.error.endsWith(id.slice(0, 8))).toBe(true);
    expect(body.correlationId).toBe(id);
  });

  it("özel iletili 500: ileti korunur, destek cümlesi eklenir", async () => {
    const id = newCorrelationId();
    const res = await runWithCorrelation({ id, organizationId: null, showToUser: true }, async () => serverError("Ödeme ekranı açılamadı."));
    expect((await res.json()).error).toBe(`Ödeme ekranı açılamadı. Destek ekibimize bu takip numarasıyla yazarak destek alabilirsiniz: ${id.slice(0, 8)}`);
  });

  it("🚨 ödeme dışı kimlikli uçta numara VAR ama ekranda GÖSTERİLMEZ: eski metin, gövdede numara yok", async () => {
    const res = await runWithCorrelation({ id: newCorrelationId(), organizationId: "org-1" }, async () => serverError());
    const body = await res.json();
    expect(body.error).toBe("Bir sorun oluştu. Sayfayı yenileyin; işlem tamamlanmadıysa birazdan tekrar deneyin.");
    expect(body).not.toHaveProperty("correlationId");
  });

  it("numara yoksa (anonim / misafir rotası) eski metin, gövdede numara YOK (misafir Lixus desteğine yazmaz)", async () => {
    const body = await serverError().json();
    expect(body.error).toBe("Bir sorun oluştu. Sayfayı yenileyin; işlem tamamlanmadıysa birazdan tekrar deneyin.");
    expect(body).not.toHaveProperty("correlationId");
  });
});

describe("hata raporu — log satırı, Sentry etiketi ve alarm e-postası AYNI numarayı taşır", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetReportThrottle();
  });

  it("işlem içindeki rapor: Sentry olayında correlation_id etiketi, e-postada 'Takip numarası', log satırında numara", async () => {
    vi.stubEnv("SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/123");
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.spyOn(emailService, "sendReporting").mockResolvedValue({ ok: true } as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = newCorrelationId();
    await runWithCorrelation({ id, organizationId: null }, () => reportErrorCore("test-context", new Error("boom")));
    await new Promise((r) => setTimeout(r, 10)); // Sentry gönderimi beklenmeden başlatılır
    const envelope = String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(JSON.parse(envelope.split("\n")[2]).tags).toEqual({ correlation_id: id });
    expect(String(send.mock.calls[0][2])).toContain(`Takip numarası: <code>${id}</code>`);
    expect(log.mock.calls.some(([line]) => String(line).includes(`[takip ${id}]`))).toBe(true);
  });

  it("işlem dışı çekirdek rapor (operatör betiği): numara uydurulmaz, etiket yok", async () => {
    vi.stubEnv("SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/123");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await reportErrorCore("script", new Error("boom"));
    await new Promise((r) => setTimeout(r, 10));
    const envelope = String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(JSON.parse(envelope.split("\n")[2])).not.toHaveProperty("tags");
  });
});

describe("arka plan işi çağıranın numarasını MİRAS ALMAZ (Haiku güvenlik incelemesi 10-12)", () => {
  it("e-posta kuyruğu boşaltımı kimlikli isteğin içinden tetiklense de kendi numarasıyla, işletmesiz koşar", async () => {
    const { kickEmailOutboxDrain } = await import("@/lib/email-outbox");
    const outer = newCorrelationId();
    let seen: ReturnType<typeof currentCorrelation> = null;
    await runWithCorrelation({ id: outer, organizationId: "org-1" }, async () => {
      await new Promise<void>((resolve) => {
        kickEmailOutboxDrain(async () => {
          seen = currentCorrelation();
          resolve();
        });
      });
    });
    expect(seen).not.toBeNull();
    expect(seen!.id).not.toBe(outer);
    expect(isCorrelationId(seen!.id)).toBe(true);
    expect(seen!.organizationId).toBeNull();
  });
});
