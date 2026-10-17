import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — ŞİKÂYET TEHDİDİ KURALI (kurucu kararı 10-11, "bayrakla ekle + ölç"; anahtar `AI_UNDERSTANDING_THREAT_RULE_ENABLED`
// KAPALI). Neden analizi: "Polisi arayacağız" ifadesi şikâyet etiketini düşürüyordu (ifade çıkınca 0/2 → 2/2). Açıkken sistem istemine
// EN SONA kural eki girer (şikâyet etiketini EKLETİR, acili kaldırmaz); kapalıyken istem, önbellek anahtarı ve istek gövdesi BAYT BAYT eski.
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
  UNDERSTANDING_THREAT_RULE_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  understandGuestMessages,
  understandingSystemPromptFor,
  understandingThreatRuleEnabled,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { evalRuntime, understandingModeLabel } from "../eval/run-meta";

const RAW = {
  language: "tr",
  requests: [{ intent: "complaint_issue", query_tr: "sıcak su yok", query_original: "sıcak su yok" }],
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
  vi.stubEnv("OPENAI_API_KEY", "sk-test-threat-rule-0000000000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("istem", () => {
  it("🚨 kapalı: istem bayt bayt eski (ek yok); açık: ek EN SONDA, öteki kiplerle birlikte", () => {
    expect(understandingSystemPromptFor({})).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ threat: false })).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ threat: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_THREAT_RULE_ADDENDUM}`);
    const all = understandingSystemPromptFor({ items: true, english: true, threat: true });
    expect(all.endsWith(UNDERSTANDING_THREAT_RULE_ADDENDUM)).toBe(true);
    expect(understandingSystemPromptFor({ items: true, english: true })).not.toContain("THREATS TO CALL THE POLICE");
  });

  it("ek şikâyet etiketini EKLETİR, acili kaldırtmaz; örnekler ölçüm setinden farklı (ezber yok)", () => {
    expect(UNDERSTANDING_THREAT_RULE_ADDENDUM).toContain("ALWAYS include a complaint_issue request");
    expect(UNDERSTANDING_THREAT_RULE_ADDENDUM).toContain("keep emergency when you would add it anyway");
    expect(UNDERSTANDING_THREAT_RULE_ADDENDUM).not.toMatch(/remove emergency|drop emergency|do not add emergency/i);
    const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/emergency-number.json"), "utf8")) as {
      scenarios: { text: string }[];
    };
    for (const s of set.scenarios) expect(UNDERSTANDING_THREAT_RULE_ADDENDUM).not.toContain(s.text.slice(0, 24));
  });

  it("anahtar yalnız '1' ile açılır", () => {
    expect(understandingThreatRuleEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_THREAT_RULE_ENABLED", "true");
    expect(understandingThreatRuleEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_THREAT_RULE_ENABLED", "1");
    expect(understandingThreatRuleEnabled()).toBe(true);
  });
});

describe("çağrı (davranışsal — istek gövdesi)", () => {
  it("🚨 kapalı: modele giden sistem istemi eki TAŞIMAZ; açık: taşır ve önbellek ayrı girdi (kapalı sonucu açık koşuya sızmaz)", async () => {
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    await understandGuestMessages({ guestMessage: "Sıcak su yok, polise gideceğim." });
    expect(systemOf(f, 0)).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    vi.stubEnv("AI_UNDERSTANDING_THREAT_RULE_ENABLED", "1");
    const second = await understandGuestMessages({ guestMessage: "Sıcak su yok, polise gideceğim." });
    expect(second.status === "ok" && second.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
    expect(systemOf(f, 1).endsWith(UNDERSTANDING_THREAT_RULE_ADDENDUM)).toBe(true);
  });
});

describe("ölçüm koşu kimliği", () => {
  it("kip etiketi 'thr' taşır ve anlama istemi kimliği anahtarla değişir", () => {
    expect(understandingModeLabel({ threat: true })).toBe("thr");
    expect(understandingModeLabel({ items: true, threat: true })).toBe("items+thr");
    const off = evalRuntime().prompts?.understanding;
    vi.stubEnv("AI_UNDERSTANDING_THREAT_RULE_ENABLED", "1");
    const on = evalRuntime().prompts?.understanding;
    expect(on).not.toBe(off);
    expect(on).toMatch(/^[0-9a-f]{12}$/);
  });
});
