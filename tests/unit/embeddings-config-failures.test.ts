import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// A7 #3 (09-27, kodda doğrulandı): gömme sağlayıcısının YAPILANDIRMA arızaları sessizdi — üretimin iki çağıranı `quiet: true`
// geçiyor, 400 hiç bildirilmiyordu; 1536 dışı boyut her durumda raporsuz `null`du; JSON olmayan 200 ağ hatası sanılıp 3 kez
// yeniden isteniyordu. Sonuç: anlamsal arama kalıcı "soğuk" kalırken açılış logu "AÇIK" diyordu (boyut uyuşmazlığında gömmeler
// faturalanıp atılıyordu). Artık: boyut uyuşmazlığı ve istek biçiminin reddi (desteklenmeyen parametre / "dimensions") gömme
// kanalının KALICI "request" alarmına (geçiş tabanlı, bir kez) gider; JSON olmayan gövde yeniden denenmez. Tek girdiye özgü 400
// (ör. token sınırı) alarm ÜRETMEZ — o, yapılandırma arızası değildir. Arama davranışı aynı (düşünce sözcüksel sürer).
// ---------------------------------------------------------------------------

const persistent = vi.fn(async () => {});
const reported = vi.fn(async () => ({ sent: false }));
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: (...args: unknown[]) => persistent(...(args as [])),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: (...args: unknown[]) => reported(...(args as [])),
}));

import { embedTexts, clearEmbeddingCache, embeddingRequestRejected, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";

const vec = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  clearEmbeddingCache();
  persistent.mockClear();
  reported.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("gömme yapılandırma arızası sessiz kalmaz", () => {
  it("🚨 1536 dışı boyut (ör. large modelin 3072'si) → kalıcı 'request' alarmı, sonuç null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vec(3072) }] }), { status: 200 })));
    expect(await embedTexts(["havlu"], { quiet: true })).toBeNull();
    expect(persistent).toHaveBeenCalledTimes(1);
    expect(persistent.mock.calls[0]).toEqual(["request", 200, "", "embedding"]);
  });

  it("🚨 'dimensions' parametresini reddeden 400 → kalıcı 'request' alarmı (quiet olsa da), yeniden denenmez", async () => {
    const body = JSON.stringify({ error: { message: "This model does not support specifying dimensions.", type: "invalid_request_error", param: "dimensions" } });
    const f = vi.fn(async () => new Response(body, { status: 400 }));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["havlu"], { quiet: true })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(persistent).toHaveBeenCalledTimes(1);
    expect((persistent.mock.calls[0] as unknown[])[0]).toBe("request");
    expect((persistent.mock.calls[0] as unknown[])[3]).toBe("embedding");
  });

  it("🚨 JSON olmayan 200 (ağ geçidi HTML'i) yeniden DENENMEZ ve sözleşme ihlali olarak bildirilir", async () => {
    const f = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["havlu"], { quiet: true })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledTimes(1);
    expect((reported.mock.calls[0] as unknown[])[0]).toBe("openai-embeddings shape violation");
  });

  it("KONTROL — tek girdiye özgü 400 (token sınırı) yapılandırma arızası DEĞİL: alarm yok (quiet), sonuç null", async () => {
    const body = JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens.", type: "invalid_request_error", param: null } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
    expect(await embedTexts(["havlu"], { quiet: true })).toBeNull();
    expect(persistent).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });

  it("KONTROL — doğru boyut: vektörler döner, alarm yok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vec(EMBEDDING_DIMENSIONS) }] }), { status: 200 })));
    const out = await embedTexts(["havlu"], { quiet: true });
    expect(out).toHaveLength(1);
    expect(persistent).not.toHaveBeenCalled();
  });
});

describe("istek biçimi reddi — saf sınıflandırıcı", () => {
  const dims = JSON.stringify({ error: { message: "This model does not support specifying dimensions.", param: "dimensions" } });
  it("yalnız 400 / 422: aynı gövde 503'te (geçici, yeniden denenir) yapılandırma arızası SAYILMAZ", () => {
    expect(embeddingRequestRejected(400, dims)).toBe(true);
    expect(embeddingRequestRejected(422, dims)).toBe(true);
    expect(embeddingRequestRejected(503, dims)).toBe(false);
    expect(embeddingRequestRejected(429, dims)).toBe(false);
  });
  it("desteklenmeyen parametre kodu da reddir; token sınırı değildir", () => {
    expect(embeddingRequestRejected(400, JSON.stringify({ error: { code: "unsupported_parameter" } }))).toBe(true);
    expect(embeddingRequestRejected(400, JSON.stringify({ error: { message: "maximum context length is 8192 tokens" } }))).toBe(false);
  });
});
