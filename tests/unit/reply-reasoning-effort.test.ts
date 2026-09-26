import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { suggestReply } from "@/lib/ai";
import { replyReasoningEffort } from "@/lib/ai/model-family";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// CEVAP MODELİ DÜŞÜNME ÇABASI (09-25, model kıyası): gpt-6-luna varsayılanda düşünme token'ı harcar (canlı sonda:
// "OK" için 13), gpt-5.1'in varsayılanı düşünmesiz. Kıyasın adil olması ve gecikme/maliyetin ayarlanabilmesi için
// `OPENAI_REASONING_EFFORT` (kapalı küme). YOKSA gövdeye HİÇ girmez → bugünkü canlı davranış birebir.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
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

describe("replyReasoningEffort — kapalı küme", () => {
  it("yalnız none/minimal/low/medium/high; boş/tanınmayan → gönderilmez", () => {
    for (const v of ["none", "minimal", "low", "medium", "high"]) {
      vi.stubEnv("OPENAI_REASONING_EFFORT", v);
      expect(replyReasoningEffort()).toBe(v);
    }
    for (const v of ["", "  ", "LOW ", "turbo", "0"]) {
      vi.stubEnv("OPENAI_REASONING_EFFORT", v);
      expect(replyReasoningEffort(), JSON.stringify(v)).toBeUndefined();
    }
  });
});

describe("cevap isteği gövdesi", () => {
  it("ayar YOKSA reasoning_effort gövdeye girmez (bugünkü canlı davranış)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    const c = capture();
    await suggestReply(input);
    expect(c.bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(c.bodies[0]).not.toHaveProperty("temperature");
    expect(c.bodies[0]).toHaveProperty("max_completion_tokens");
  });

  it("ayar varsa reasoning modelinde gövdeye girer; klasik modelde ASLA (400 olurdu)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    let c = capture();
    await suggestReply(input);
    expect(c.bodies[0].reasoning_effort).toBe("low");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1");
    c = capture();
    await suggestReply(input);
    expect(c.bodies[0]).not.toHaveProperty("reasoning_effort");
  });
});
