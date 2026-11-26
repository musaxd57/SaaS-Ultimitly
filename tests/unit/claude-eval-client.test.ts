import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { asArray, claudeJson, extractJson, ClaudeFatalError } from "../eval/claude-client";

// ---------------------------------------------------------------------------
// Claude ölçer istemcisi (yalnız tests/eval; ürün Claude çağırmaz) — ücret sözleşmesi (Haiku incelemesi 10-14):
// yalnız GEÇİCİ hata (429 / 5xx / ağ) yeniden denenir; kalıcı 4xx, kesilmiş cevap ve JSON olmayan cevap AYNI pahalı isteği tekrar
// göndermez. Gerçek ağ YOK (fetch sahte).
// ---------------------------------------------------------------------------

const ok = (text: string, stop = "end_turn") =>
  new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: stop }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const status = (code: number) => new Response(JSON.stringify({ error: { type: "x" } }), { status: code });

describe("Claude ölçer istemcisi — yeniden deneme yalnız geçici hatada", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-xxxxxxxxxxxxxxxxxxxxxxxx");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Bekleme süreleri sahte saatle hemen geçer (gerçek 2 + 4 sn beklenmez). */
  const call = async () => {
    const p = claudeJson<unknown>({ model: "m", system: "s", user: "u" });
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const r = await settled;
    if (r.ok) return r.v;
    throw r.e;
  };

  it("🚨 400 (yanlış model adı / istek) → TEK çağrı, kalıcı hata", async () => {
    const f = vi.fn(async () => status(400));
    vi.stubGlobal("fetch", f);
    await expect(call()).rejects.toBeInstanceOf(ClaudeFatalError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("🚨 kesilmiş cevap (max_tokens) → TEK çağrı, kalıcı hata", async () => {
    const f = vi.fn(async () => ok('[{"text":"a"', "max_tokens"));
    vi.stubGlobal("fetch", f);
    await expect(call()).rejects.toThrow(/kesildi/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("🚨 JSON olmayan cevap → TEK çağrı, kalıcı hata", async () => {
    const f = vi.fn(async () => ok("I cannot help with that."));
    vi.stubGlobal("fetch", f);
    await expect(call()).rejects.toBeInstanceOf(ClaudeFatalError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: 529 / 500 geçici → yeniden dener ve başarır", async () => {
    const f = vi.fn().mockResolvedValueOnce(status(529)).mockResolvedValueOnce(status(500)).mockResolvedValueOnce(ok('[{"text":"a"}]'));
    vi.stubGlobal("fetch", f);
    await expect(call()).resolves.toEqual([{ text: "a" }]);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("KONTROL: ağ hatası geçici → yeniden dener; üçünde de düşerse hata", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", f);
    await expect(call()).rejects.toThrow(/fetch failed/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("anahtar yoksa ağa hiç çıkmaz", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(call()).rejects.toBeInstanceOf(ClaudeFatalError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("Claude ölçer istemcisi — JSON ayıklama", () => {
  it("bütün metin, ```json çiti ve önünde not olan cevap", () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```\nThanks')).toEqual([{ a: 1 }]);
    expect(extractJson('[not] {"items":[{"a":1}]}')).toEqual({ items: [{ a: 1 }] });
  });
  it("Haiku 10-14: önce gelen çitli ÖRNEK ve açıklamadaki köşeli parantez gerçek cevabın yerine geçmez", () => {
    const withExample = 'Format example:\n```json\n[{"i":0}]\n```\nAnswer:\n```json\n[{"i":0,"belongs":true},{"i":1,"belongs":false}]\n```';
    expect(extractJson(withExample)).toEqual([{ i: 0, belongs: true }, { i: 1, belongs: false }]);
    expect(extractJson('[not] [{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("dizi bekleyen çağıran {items} sarmalını da kabul eder, başka biçimde kalıcı hata", () => {
    expect(asArray({ items: [1, 2] })).toEqual([1, 2]);
    expect(asArray([3])).toEqual([3]);
    expect(() => asArray({ x: 1 })).toThrow(ClaudeFatalError);
  });
});
