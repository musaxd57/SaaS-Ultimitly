import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// OKUYUCU TEK HIZLI YENİDEN DENEME (kurucu kararı 4.11, 10-28: "Evet, bir kez yeniden denensin"). Cevap modelinin 10-21 kuralı
// (`model-breaker.ts`) okuyucuya da: geçici hata (408 · 429 hız sınırı · 5xx · zaman aşımı OLMAYAN ağ hatası) bir kez; zaman aşımı,
// kalıcı arıza (kota / anahtar / model), bozuk / kesik cevap yeniden DENENMEZ. Kurucu notu "süreye falan baksın": toplam süre tek
// çağrının tavanını AŞMAZ — ikinci deneme ilk denemeden kalan süreyle koşar, kalan süre tavanın yarısından azsa denenmez.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));

import { runPartReader } from "@/lib/ai/semantic/part-reader";
import { structuredRetryBudgetMs } from "@/lib/ai/semantic/structured-call";
import { __resetReplyModelBreakerForTests } from "@/lib/ai/model-breaker";

const parts = [{ ref: "R1", request: "q", text: "t", notes: ["n"] }];
const okBody = () =>
  JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            parts: [{ ref: "R1", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, quote: "" }],
          }),
        },
      },
    ],
  });
const ok = () => new Response(okBody(), { status: 200 });
const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/** Sırayla verilen cevapları dönen sahte fetch; her çağrı sayılır. */
function seq(...steps: (() => Response | Promise<Response>)[]) {
  let i = 0;
  const f = vi.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return step();
  });
  return f;
}
const run = (f: ReturnType<typeof vi.fn>) => runPartReader({ guestMessage: "m", parts, fetchImpl: f as unknown as typeof fetch });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("AI_SEMANTIC_TIMEOUT_MS", "4000");
  __resetReplyModelBreakerForTests(0);
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetReplyModelBreakerForTests();
});

describe("4.11 — okuyucu geçici hatada bir kez yeniden denenir", () => {
  it("🚨 sunucu hatası (503) → ikinci deneme okunur (hüküm gelir, parçalar boşuna tutulmaz)", async () => {
    const f = seq(() => new Response("upstream error", { status: 503 }), ok);
    const out = await run(f);
    expect(out).toEqual({ status: "ok", holds: new Map() });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("hız sınırı (429, kota değil) ve 408 → bir kez yeniden", async () => {
    for (const status of [429, 408, 500, 502]) {
      const f = seq(() => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), { status }), ok);
      expect((await run(f)).status).toBe("ok");
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it("ağ hatası (bağlantı reddi, zaman aşımı değil) → bir kez yeniden", async () => {
    const f = seq(() => {
      throw new TypeError("fetch failed");
    }, ok);
    expect((await run(f)).status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("🚨 yalnız BİR kez: iki geçici hata → düştü (bütün parçalar tutulur)", async () => {
    const f = seq(() => new Response("x", { status: 503 }));
    expect(await run(f)).toEqual({ status: "failed" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("4.11 — yeniden DENENMEYENLER (bugünkü davranış aynen)", () => {
  it("🚨 zaman aşımı denenmez (bekleme ikiye katlanmasın)", async () => {
    const f = seq(() => {
      throw timeoutError();
    }, ok);
    expect(await run(f)).toEqual({ status: "failed" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("🚨 kalıcı arıza denenmez: kota bitti (429 insufficient_quota), anahtar reddi (401), model yok (404)", async () => {
    const cases: [number, string][] = [
      [429, JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } })],
      [401, JSON.stringify({ error: { code: "invalid_api_key" } })],
      [404, JSON.stringify({ error: { code: "model_not_found" } })],
    ];
    for (const [status, body] of cases) {
      const f = seq(() => new Response(body, { status }), ok);
      expect(await run(f)).toEqual({ status: "failed" });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("istek hatası (400), kesik cevap, bozuk cevap, ret denenmez", async () => {
    const bodies: (() => Response)[] = [
      () => new Response(JSON.stringify({ error: { code: "invalid_request_error" } }), { status: 400 }),
      () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{" } }] }), { status: 200 }),
      () => new Response("not json", { status: 200 }),
      () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { refusal: "no" } }] }), { status: 200 }),
    ];
    for (const b of bodies) {
      const f = seq(b, ok);
      expect(await run(f)).toEqual({ status: "failed" });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});

describe("4.11 — süre (kurucu: 'süreye falan baksın')", () => {
  it("🚨 ilk hata YAVAŞ geldiyse (tavanın yarısından fazlası geçti) yeniden denenmez", async () => {
    vi.stubEnv("AI_SEMANTIC_TIMEOUT_MS", "1000");
    const f = seq(async () => {
      await new Promise((r) => setTimeout(r, 600));
      return new Response("x", { status: 503 });
    }, ok);
    expect(await run(f)).toEqual({ status: "failed" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("🚨 ikinci deneme KALAN süreyle koşar: toplam bekleme tek çağrının tavanını aşmaz", async () => {
    vi.stubEnv("AI_SEMANTIC_TIMEOUT_MS", "1000");
    let secondSignal: AbortSignal | undefined;
    const f = vi
      .fn()
      .mockImplementationOnce(async () => new Response("x", { status: 503 }))
      .mockImplementationOnce(async (_u: unknown, init?: { signal?: AbortSignal }) => {
        secondSignal = init?.signal;
        // Sağlayıcı ikinci denemede takılır: yalnız kalan süre dolunca kesilir.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      });
    const started = Date.now();
    expect(await run(f)).toEqual({ status: "failed" });
    const elapsed = Date.now() - started;
    expect(f).toHaveBeenCalledTimes(2);
    expect(secondSignal?.aborted).toBe(true);
    // Tek çağrının tavanı 1000 ms; ikinci deneme kalan süreyle sınırlı → toplam ≈ 1000 ms (2000 değil).
    expect(elapsed).toBeLessThan(1_600);
  });

  it("bütçe hesabı: kalan = tavan − geçen − bekleme; kalan tavanın yarısından azsa deneme yok", () => {
    expect(structuredRetryBudgetMs(12_000, 300, 1_000)).toBe(10_700);
    expect(structuredRetryBudgetMs(12_000, 5_000, 1_000)).toBe(6_000);
    expect(structuredRetryBudgetMs(12_000, 5_001, 1_000)).toBeNull();
    expect(structuredRetryBudgetMs(12_000, 2_000, 3_000)).toBe(7_000);
    expect(structuredRetryBudgetMs(12_000, 12_500, 0)).toBeNull();
  });
});
