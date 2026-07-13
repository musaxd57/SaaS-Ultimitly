import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { translate, __resetTranslateCache, __translateCacheSize } from "@/lib/ai/translate";

// Codex #30 contract: translate returns a STRUCTURED result. A failure is
// { ok:false, reason } — never the original text masquerading as a translation
// (the reply route used to SEND that untranslated text to the guest). The
// cache is a bounded LRU with TTL instead of an unbounded module Map.

function stubOpenAi(content: string | null, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          content === null ? "err" : JSON.stringify({ choices: [{ message: { content } }] }),
          { status },
        ),
    ),
  );
}

beforeEach(() => __resetTranslateCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("translate — structured result", () => {
  it("no API key → { ok:false, reason:'not_configured' } (NOT the original text)", async () => {
    // vitest env pins OPENAI_API_KEY="" — the old behavior returned the input.
    const r = await translate("Merhaba, Wi-Fi şifresi nedir?", "en");
    expect(r).toEqual({ ok: false, reason: "not_configured" });
  });

  it("same source/target and empty input are legitimate successes (unchanged text)", async () => {
    expect(await translate("Hello there", "en", "en")).toEqual({ ok: true, text: "Hello there" });
    expect(await translate("", "de")).toEqual({ ok: true, text: "" });
    expect(await translate("   ", "de")).toEqual({ ok: true, text: "   " });
  });

  it("over-long input → too_long (no paid call attempted)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await translate("x".repeat(6001), "en");
    expect(r).toEqual({ ok: false, reason: "too_long" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("HTTP failure / empty completion → { ok:false, reason:'failed' }", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    stubOpenAi(null, 500);
    expect(await translate("Merhaba", "en")).toEqual({ ok: false, reason: "failed" });
    stubOpenAi(""); // 200 but empty content
    expect(await translate("Merhaba", "en")).toEqual({ ok: false, reason: "failed" });
  });

  it("success returns the translation and caches it (second call = no fetch)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    stubOpenAi("Hello, what is the Wi-Fi password?");
    const first = await translate("Merhaba, Wi-Fi şifresi nedir?", "en");
    expect(first).toEqual({ ok: true, text: "Hello, what is the Wi-Fi password?" });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const second = await translate("Merhaba, Wi-Fi şifresi nedir?", "en");
    expect(second).toEqual({ ok: true, text: "Hello, what is the Wi-Fi password?" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cache is BOUNDED: never grows past the LRU cap", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    stubOpenAi("t");
    for (let i = 0; i < 230; i++) await translate(`msg-${i}`, "en");
    expect(__translateCacheSize()).toBeLessThanOrEqual(200);
  });

  it("failures are NOT cached (a later retry can succeed)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    stubOpenAi(null, 500);
    expect((await translate("Merhaba", "en")).ok).toBe(false);
    stubOpenAi("Hello");
    expect(await translate("Merhaba", "en")).toEqual({ ok: true, text: "Hello" });
  });
});
