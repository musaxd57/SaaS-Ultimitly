import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { promptCacheFields } from "@/lib/ai/prompt-cache";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// OPENAI İSTEM ÖNBELLEĞİ (kurucu 10-30, `ai/prompt-cache.ts`): amaç başına sabit anahtar + 24 saat saklama, yalnız OpenAI'ye giden istekte.
// Önbellek önek eşleşmesiyle çalışır → cevap isteğinde sistem istemi İLK mesaj ve misafir mesajından bağımsız olmalı.
// ---------------------------------------------------------------------------

const CHAT = "https://api.openai.com/v1/chat/completions";

describe("promptCacheFields", () => {
  it("OpenAI isteğinde amaç anahtarı + 24 saat saklama", () => {
    expect(promptCacheFields("reply", CHAT, {})).toEqual({ prompt_cache_key: "lixus:reply", prompt_cache_retention: "24h" });
    expect(promptCacheFields("semantic:absence_judge", CHAT, {})).toEqual({
      prompt_cache_key: "lixus:semantic:absence_judge",
      prompt_cache_retention: "24h",
    });
  });

  it("OpenAI dışı uçta hiçbir alan eklenmez (bilinmeyen alanı reddedebilir)", () => {
    expect(promptCacheFields("reply", "https://api.example.com/v1/chat/completions", {})).toEqual({});
    expect(promptCacheFields("reply", "https://api.openai.com.evil.example/v1", {})).toEqual({});
    expect(promptCacheFields("reply", "not a url", {})).toEqual({});
  });

  it("acil kapatma iki alanı da kaldırır; saklama ayrı kapatılabilir", () => {
    expect(promptCacheFields("reply", CHAT, { OPENAI_PROMPT_CACHE_DISABLED: "1" })).toEqual({});
    expect(promptCacheFields("reply", CHAT, { OPENAI_PROMPT_CACHE_RETENTION: "in_memory" })).toEqual({ prompt_cache_key: "lixus:reply" });
  });

  it("anahtar 64 karakterle sınırlı, misafir / org verisi taşımaz", () => {
    const k = promptCacheFields(`semantic:${"x".repeat(200)}`, CHAT, {}).prompt_cache_key ?? "";
    expect(k.length).toBeLessThanOrEqual(64);
    expect(k.startsWith("lixus:semantic:")).toBe(true);
  });
});

const base: SuggestReplyInput = {
  guestMessage: "Wifi şifresi nedir?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "tr",
};

function capture(): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ intent: "wifi", confidence: 0.9, reply: "Kartta.", priority: "standard", riskLevel: "none", detectedLanguage: "tr" }) },
            },
          ],
        }),
      );
    }),
  );
  return { bodies };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cevap isteği gövdesi — önbellek alanları", () => {
  it("gövdede amaç anahtarı + 24 saat; sistem istemi ilk mesaj ve misafir mesajından bağımsız (önek sabit)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    const c = capture();
    await suggestReply(base);
    await suggestReply({ ...base, guestMessage: "Otopark var mı? Kaç araba sığar?" });
    expect(c.bodies[0].prompt_cache_key).toBe("lixus:reply");
    expect(c.bodies[0].prompt_cache_retention).toBe("24h");
    const msgs = (b: Record<string, unknown>) => b.messages as { role: string; content: string }[];
    expect(msgs(c.bodies[0])[0].role).toBe("system");
    expect(msgs(c.bodies[0])[0].content).toBe(msgs(c.bodies[1])[0].content);
    expect(msgs(c.bodies[0])[1].content).not.toBe(msgs(c.bodies[1])[1].content);
  });

  it("acil kapatmada gövdede önbellek alanı yok (bugünkü istek birebir)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_PROMPT_CACHE_DISABLED", "1");
    const c = capture();
    await suggestReply(base);
    expect(c.bodies[0]).not.toHaveProperty("prompt_cache_key");
    expect(c.bodies[0]).not.toHaveProperty("prompt_cache_retention");
  });
});
