import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — EV KURALI GÖLGE KİPİ (#188 dilim 3, kurucu 09-26 "yap hemen"; bayrak `AI_HOUSE_RULES_SHADOW`).
// Her istek ev kuralı KONUSU (`rule_topic`) + misafirin TUTUMU (`rule_stance`) taşır. Karar DEĞİL: yalnız karar kaydına
// "kural açık olsaydı ne olurdu" yazılır (`house-rules/shadow.ts`). Bayrak kapalıyken şema / istem / önbellek anahtarı /
// çözücü çıktısı BAYT BAYT eski; öğe kipiyle birlikte açılabilir (şema ve istem ikisini de taşır).
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
  UNDERSTANDING_JSON_SCHEMA,
  UNDERSTANDING_JSON_SCHEMA_ITEMS,
  UNDERSTANDING_RULE_STANCES,
  UNDERSTANDING_RULE_TOPICS,
  parseUnderstanding,
  understandingSchemaFor,
} from "@/lib/ai/semantic/understanding-schema";
import {
  UNDERSTANDING_ITEMS_PROMPT_ADDENDUM,
  UNDERSTANDING_RULES_PROMPT_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  understandGuestMessages,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { houseRulesShadowEnabled } from "@/lib/house-rules/flag";
import { HOUSE_RULE_TOPICS, RULE_STANCES } from "@/lib/house-rules/core";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const RAW_RULES = {
  language: "en",
  requests: [
    { intent: "checkin_time", query_tr: "giriş saati", query_original: "check-in time", rule_topic: "party_event", rule_stance: "not_about_guest" },
    { intent: "house_rules", query_tr: "sigara", query_original: "smoking", rule_topic: "smoking", rule_stance: "asks_permission" },
    { intent: "wifi", query_tr: "wifi", query_original: "wifi", rule_topic: "none", rule_stance: "none" },
  ],
  stay_change: STAY_NONE,
};

function modelReturns(content: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
}
const bodyOf = (f: ReturnType<typeof modelReturns>, i = 0) =>
  JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body));

beforeEach(() => __resetUnderstandingCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("şema", () => {
  it("kapalıyken temel / öğe şeması AYNI nesne (bayt bayt eski)", () => {
    expect(understandingSchemaFor({})).toBe(UNDERSTANDING_JSON_SCHEMA);
    expect(understandingSchemaFor({ items: true })).toBe(UNDERSTANDING_JSON_SCHEMA_ITEMS);
    expect(Object.keys(UNDERSTANDING_JSON_SCHEMA.schema.properties.requests.items.properties)).not.toContain("rule_topic");
  });

  it("kural kipi: strict, her istek konu + tutum taşır (kapalı küme + none), tüm alanlar zorunlu", () => {
    const s = understandingSchemaFor({ rules: true });
    expect(s.strict).toBe(true);
    expect(s.name).not.toBe(UNDERSTANDING_JSON_SCHEMA.name);
    const item = s.schema.properties.requests.items as unknown as {
      required: readonly string[];
      properties: Record<string, { enum?: readonly string[] }>;
    };
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.rule_topic.enum).toEqual([...HOUSE_RULE_TOPICS, "none"]);
    expect(item.properties.rule_stance.enum).toEqual([...RULE_STANCES, "none"]);
    expect([...UNDERSTANDING_RULE_TOPICS]).toEqual([...HOUSE_RULE_TOPICS, "none"]);
    expect([...UNDERSTANDING_RULE_STANCES]).toEqual([...RULE_STANCES, "none"]);
    expect(Object.keys(s.schema.properties)).not.toContain("withdrawn");
  });

  it("öğe + kural birlikte: mesaj numarası, vazgeçme VE konu/tutum", () => {
    const s = understandingSchemaFor({ items: true, rules: true });
    const item = s.schema.properties.requests.items;
    expect(Object.keys(item.properties)).toEqual(expect.arrayContaining(["message", "rule_topic", "rule_stance"]));
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(Object.keys(s.schema.properties)).toContain("withdrawn");
    expect([...s.schema.required].sort()).toEqual(Object.keys(s.schema.properties).sort());
  });
});

describe("çözücü", () => {
  it("kural kipinde konu + tutum okunur; none → alan YOK; istek düşmez", () => {
    const u = parseUnderstanding(RAW_RULES, { rules: true });
    expect(u?.requests.map((r) => [r.intent, r.rule])).toEqual([
      ["checkin_time", { topic: "party_event", stance: "not_about_guest" }],
      ["house_rules", { topic: "smoking", stance: "asks_permission" }],
      ["wifi", undefined],
    ]);
  });

  it("tanınmayan konu / tutum, tutumu none olan konu → alan YOK (istek kalır)", () => {
    const u = parseUnderstanding(
      {
        ...RAW_RULES,
        requests: [
          { intent: "pets", query_tr: "evcil", query_original: "pets", rule_topic: "drugs", rule_stance: "asks_permission" },
          { intent: "pets", query_tr: "evcil", query_original: "pets", rule_topic: "pets", rule_stance: "maybe" },
          { intent: "pets", query_tr: "evcil", query_original: "pets", rule_topic: "pets", rule_stance: "none" },
          { intent: "pets", query_tr: "evcil", query_original: "pets" },
        ],
      },
      { rules: true },
    );
    expect(u?.requests).toHaveLength(4);
    expect(u?.requests.every((r) => r.rule === undefined)).toBe(true);
  });

  it("KAPALIYKEN çıktı bayt bayt eski: ham veride alanlar olsa bile konu/tutum YOK", () => {
    const u = parseUnderstanding(RAW_RULES);
    expect(u?.requests.every((r) => !("rule" in r))).toBe(true);
    expect(parseUnderstanding(RAW_RULES, { items: true })?.requests.every((r) => !("rule" in r))).toBe(true);
  });
});

describe("çağrı — kural kipi ayrı şema, istem eki ve önbellek girdisi", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  });

  it("rules: true → kural şeması + istem eki; aynı içerik kapalı kipte AYRI çağrı", async () => {
    const f = modelReturns(RAW_RULES);
    const on = await understandGuestMessages({ guestMessage: "Can we smoke?", rules: true, fetchImpl: f });
    expect(on.status === "ok" && on.value.requests[1].rule).toEqual({ topic: "smoking", stance: "asks_permission" });
    expect(bodyOf(f).response_format.json_schema).toEqual(understandingSchemaFor({ rules: true }));
    expect(bodyOf(f).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_RULES_PROMPT_ADDENDUM}`);

    const off = await understandGuestMessages({ guestMessage: "Can we smoke?", fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
    expect(bodyOf(f, 1).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(off.status === "ok" && off.value.requests.every((r) => !("rule" in r))).toBe(true);
  });

  it("öğe + kural: istem ekleri sırayla (öğe, sonra kural); öğe kipinin önbelleğiyle KARIŞMAZ", async () => {
    const f = modelReturns({ ...RAW_RULES, requests: RAW_RULES.requests.map((r, i) => ({ ...r, message: i + 1 })), withdrawn: [] });
    await understandGuestMessages({ guestMessage: "Can we smoke?", items: true, rules: true, fetchImpl: f });
    expect(bodyOf(f).messages[0].content).toBe(
      `${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}\n${UNDERSTANDING_RULES_PROMPT_ADDENDUM}`,
    );
    expect(bodyOf(f).response_format.json_schema).toEqual(understandingSchemaFor({ items: true, rules: true }));
    await understandGuestMessages({ guestMessage: "Can we smoke?", items: true, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}`);
    // Aynı kipte ikinci çağrı önbellekten (ağ yok).
    await understandGuestMessages({ guestMessage: "Can we smoke?", items: true, rules: true, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("karar noktası kb-retrieve: bayrak açıkken kural kipi, kapalıyken / yanlış yazımda temel şema", async () => {
    const f = modelReturns(RAW_RULES);
    vi.stubGlobal("fetch", f);
    const base = { items: [], guestMessage: "Can we smoke?", history: [] };
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
    __resetUnderstandingCache();
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 1).response_format.json_schema).toEqual(understandingSchemaFor({ rules: true }));
    __resetUnderstandingCache();
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "true");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 2).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
  });
});

describe("bayrak", () => {
  it("yalnız tam '1' + anlama katmanı açıkken", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    expect(houseRulesShadowEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    expect(houseRulesShadowEnabled()).toBe(true);
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "true");
    expect(houseRulesShadowEnabled()).toBe(false);
  });

  it("bayrağı YALNIZ house-rules/flag.ts okur", () => {
    const root = path.resolve(__dirname, "../../");
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && readFileSync(path.join(root, rel), "utf8").includes("process.env.AI_HOUSE_RULES_SHADOW")) readers.push(rel);
      }
    };
    walk("src");
    expect(readers).toEqual(["src/lib/house-rules/flag.ts"]);
  });
});
