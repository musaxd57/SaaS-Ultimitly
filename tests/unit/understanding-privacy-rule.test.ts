import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — BAŞKA KİŞİNİN BİLGİSİ KURALI (kurucu kararı 10-22 U9, "Evet olur"; anahtar `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED`
// KAPALI). Kırmızı takım vakası: başka misafirin dairesini / çıkışını soran mesaja yapay zekâ "paylaşamam" deyip konuyu kapatıyordu, ev
// sahibinde açık iş kalmıyordu. Açıkken istem EN SONA ek alır (soru `human_request` → sessiz + açık iş); kapalıyken istem, önbellek anahtarı
// ve istek gövdesi BAYT BAYT eski.
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
  UNDERSTANDING_PRIVACY_RULE_ADDENDUM,
  UNDERSTANDING_THREAT_RULE_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  understandGuestMessages,
  understandingSystemPromptFor,
  understandingPrivacyRuleEnabled,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { evalRuntime, understandingModeLabel } from "../eval/run-meta";

const RAW = {
  language: "tr",
  requests: [{ intent: "human_request", query_tr: "başka misafirin dairesi", query_original: "q" }],
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
  vi.stubEnv("OPENAI_API_KEY", "sk-test-privacy-rule-00000000000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("istem", () => {
  it("🚨 kapalı: istem bayt bayt eski; açık: ek EN SONDA (tehdit ekiyle birlikte de)", () => {
    expect(understandingSystemPromptFor({})).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ privacy: false })).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ privacy: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_PRIVACY_RULE_ADDENDUM}`);
    const both = understandingSystemPromptFor({ items: true, threat: true, privacy: true });
    expect(both.endsWith(UNDERSTANDING_PRIVACY_RULE_ADDENDUM)).toBe(true);
    expect(both).toContain(UNDERSTANDING_THREAT_RULE_ADDENDUM);
    expect(understandingSystemPromptFor({ items: true, threat: true })).not.toContain("OTHER PEOPLE'S INFORMATION");
  });

  it("ek başka kişinin bilgisini human_request'e bağlar; misafirin KENDİ rezervasyonu hariç", () => {
    expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).toContain("is intent human_request");
    expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).toContain("The guest's OWN stay is NOT this");
    // Canlı ölçüm 10-22: "Hangi dairede kalıyoruz, dairenin adı ne?" misafirin KENDİ dairesi → başka kişinin bilgisi DEĞİL (tutulup e-posta gidiyordu).
    expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).toContain("which apartment, room, floor or door number they are in, its name");
    expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).toContain("[directions_transport]");
    expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).toContain("[checkout_time]");
  });

  it("örnekler ölçüm setinden farklı (ezber yok) — kırmızı takım geliştirme seti", () => {
    const set = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-e2e-redteam-dev.json"), "utf8")) as {
      scenarios?: { text?: string; message?: string; messages?: { text?: string }[] }[];
    };
    const texts = (set.scenarios ?? []).flatMap((s) => [s.text, s.message, ...(s.messages ?? []).map((m) => m.text)]).filter((t): t is string => !!t);
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) expect(UNDERSTANDING_PRIVACY_RULE_ADDENDUM).not.toContain(t.slice(0, 24));
  });

  it("anahtar yalnız '1' ile açılır", () => {
    expect(understandingPrivacyRuleEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_PRIVACY_RULE_ENABLED", "true");
    expect(understandingPrivacyRuleEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_PRIVACY_RULE_ENABLED", "1");
    expect(understandingPrivacyRuleEnabled()).toBe(true);
  });
});

describe("çağrı (davranışsal — istek gövdesi)", () => {
  it("🚨 kapalı: modele giden istem eki TAŞIMAZ; açık: taşır, önbellek ayrı girdi", async () => {
    const f = modelReturns(RAW);
    vi.stubGlobal("fetch", f);
    const msg = "Arkadaşım da burada kalıyor, hangi dairede?";
    await understandGuestMessages({ guestMessage: msg });
    expect(systemOf(f, 0)).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    vi.stubEnv("AI_UNDERSTANDING_PRIVACY_RULE_ENABLED", "1");
    const second = await understandGuestMessages({ guestMessage: msg });
    expect(second.status === "ok" && second.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
    expect(systemOf(f, 1).endsWith(UNDERSTANDING_PRIVACY_RULE_ADDENDUM)).toBe(true);
  });
});

describe("ölçüm koşu kimliği", () => {
  it("kip etiketi 'prv' taşır ve anlama istemi kimliği anahtarla değişir", () => {
    expect(understandingModeLabel({ privacy: true })).toBe("prv");
    expect(understandingModeLabel({ items: true, threat: true, privacy: true })).toBe("items+thr+prv");
    const off = evalRuntime().prompts?.understanding;
    vi.stubEnv("AI_UNDERSTANDING_PRIVACY_RULE_ENABLED", "1");
    const on = evalRuntime().prompts?.understanding;
    expect(on).not.toBe(off);
    expect(on).toMatch(/^[0-9a-f]{12}$/);
  });
});
