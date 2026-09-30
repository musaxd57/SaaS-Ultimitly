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

describe("karar kaydı — GÖNDERİLEN çaba (`llmUsage.e`, Luna geçişi 09-30)", () => {
  // Sağlayıcı yanıtı çabayı bildirmez; kayıt hangi ayarın hangi kararı verdiğini göstersin diye koddan eklenir.
  function stubWithUsage(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: "gpt-6-luna",
              usage: { prompt_tokens: 120, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 12 } },
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify({ intent: "wifi", confidence: 0.9, reply: "Kartta.", priority: "standard", riskLevel: "none", detectedLanguage: "tr" }) },
                },
              ],
            }),
          ),
      ),
    );
  }

  it("çaba gönderildiyse kayda girer; gönderilmediyse alan YOK (bugünkü kayıt bayt bayt aynı)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    stubWithUsage();
    expect((await suggestReply(input)).llmUsage).toEqual({ pt: 120, ct: 30, rt: 12, m: "gpt-6-luna", e: "low" });
    vi.stubEnv("OPENAI_REASONING_EFFORT", "");
    stubWithUsage();
    const off = (await suggestReply(input)).llmUsage;
    expect(off).toEqual({ pt: 120, ct: 30, rt: 12, m: "gpt-6-luna" });
    expect(off).not.toHaveProperty("e");
  });

  it("klasik modele çaba GİTMEZ → kayıtta da yok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    stubWithUsage();
    const usage = (await suggestReply(input)).llmUsage;
    expect(usage?.pt).toBe(120);
    expect(usage).not.toHaveProperty("e");
  });

  it("🚨 yanıtta kullanım kaydı yoksa yalnız çabadan kayıt UYDURULMAZ (kullanılamaz cevap sayacı llmUsage'ın varlığına bakar)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    capture(); // yanıtta usage / model YOK
    expect((await suggestReply(input)).llmUsage).toBeUndefined();
  });
});
