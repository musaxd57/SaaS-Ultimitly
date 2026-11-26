import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — ARIZA ↔ KULLANIM BAĞLAM KURALI (kurucu 11-04; anahtar `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED` VARSAYILAN KAPALI, kurucu
// onayı bekler — önce / sonra `docs/olcum/ARIZA-KULLANIM-ONCE-SONRA-2026-11-04.md`). Kapalıyken istem, önbellek anahtarı ve istek gövdesi
// BAYT BAYT eski; açıkken kural niyet satırının HEMEN ardında (ölçülen yer) ve önbellek ayrı girdi.
// ---------------------------------------------------------------------------
vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import {
  UNDERSTANDING_FAULT_CONTEXT_RULE,
  UNDERSTANDING_SYSTEM_PROMPT,
  insertAfterIntentLine,
  understandGuestMessages,
  understandingFaultContextEnabled,
  understandingSystemPromptFor,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { understandingModeLabel } from "../eval/run-meta";

const RAW = {
  language: "tr",
  requests: [{ intent: "complaint_issue", query_tr: "ütü ısınmıyor", query_original: "ütü ısınmıyor" }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};
function modelReturns(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
}
const systemOf = (f: ReturnType<typeof modelReturns>, i = 0) =>
  (JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body)) as { messages: { role: string; content: string }[] }).messages.find(
    (m) => m.role === "system",
  )!.content;

beforeEach(() => {
  __resetUnderstandingCache();
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-fault-context-0000000000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("istem", () => {
  it("🚨 kapalı: istem bayt bayt eski; açık: kural niyet satırının HEMEN ardında, bir kez, öteki kiplerle birlikte", () => {
    for (const opts of [{}, { items: true }, { items: true, complaintFollowup: true, english: true }, { threat: true, privacy: true }]) {
      const off = understandingSystemPromptFor(opts);
      expect(understandingSystemPromptFor({ ...opts, faultContext: false })).toBe(off);
      const on = understandingSystemPromptFor({ ...opts, faultContext: true });
      expect(on).toBe(insertAfterIntentLine(off, UNDERSTANDING_FAULT_CONTEXT_RULE));
      expect(on.split(UNDERSTANDING_FAULT_CONTEXT_RULE).length).toBe(2);
      const lines = on.split("\n");
      const intentAt = lines.findIndex((l) => l.startsWith("- intent: the closest label"));
      expect(lines[intentAt + 1]).toBe(UNDERSTANDING_FAULT_CONTEXT_RULE);
    }
    expect(understandingSystemPromptFor({})).toBe(UNDERSTANDING_SYSTEM_PROMPT);
  });

  it("kural bağlamdan okur (sabit sözcük kuralı değil); ölçüm setinin cümleleri ve cihazları kuralda GEÇMEZ (ezber yok)", () => {
    expect(UNDERSTANDING_FAULT_CONTEXT_RULE).toContain("judge from the whole conversation, not from single words");
    expect(UNDERSTANDING_FAULT_CONTEXT_RULE).toContain("is neither");
    expect(UNDERSTANDING_FAULT_CONTEXT_RULE).not.toMatch(/tost|toaster|kettle|Wasserkocher|Kaffeemaschine|Waschmaschine|çaydanlık/i);
    const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-breakdown.json"), "utf8")) as { cases: { message: string }[] };
    expect(set.cases.length).toBeGreaterThan(30);
    for (const c of set.cases) expect(UNDERSTANDING_FAULT_CONTEXT_RULE).not.toContain(c.message.slice(0, 20));
  });

  it("anahtar yalnız '1' ile açılır; ölçüm kip etiketi 'flt'", () => {
    expect(understandingFaultContextEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED", "true");
    expect(understandingFaultContextEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED", "1");
    expect(understandingFaultContextEnabled()).toBe(true);
    expect(understandingModeLabel({ items: true, faultContext: true })).toBe("items+flt");
  });
});

describe("çağrı (davranışsal — istek gövdesi)", () => {
  it("🚨 kapalı: modele giden istem kuralı TAŞIMAZ; açık: taşır ve önbellek AYRI girdi (kapalı sonucu açık koşuya sızmaz)", async () => {
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    await understandGuestMessages({ guestMessage: "Ütü ısınmıyor." });
    expect(systemOf(f, 0)).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    vi.stubEnv("AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED", "1");
    const second = await understandGuestMessages({ guestMessage: "Ütü ısınmıyor." });
    expect(second.status === "ok" && second.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
    expect(systemOf(f, 1)).toBe(insertAfterIntentLine(UNDERSTANDING_SYSTEM_PROMPT, UNDERSTANDING_FAULT_CONTEXT_RULE));
  });
});
