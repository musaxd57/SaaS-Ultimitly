import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// ANLAMA KATMANI — İNGİLİZCE KÖPRÜ SORGUSU (10-10, kurucu yokken karar #13; anahtar `AI_UNDERSTANDING_EN_QUERY_ENABLED` KAPALI).
// Ölçüm (rag-lab perq dev, çok sorulu 120 mesaj): Türkçe soru → İngilizce yazılmış bilgi kalemi yönünde cevap 26/33 blokta (%79),
// diğer yönler %98–100. Anlama katmanı yalnız Türkçe + misafirin dilinde sorgu yazıyor; İngilizce kaleme köprü yok. Açıkken her
// istek bir `query_en` taşır ve getirmeye Türkçe + özgün dil sorgularından SONRA eklenir. Kapalıyken şema / istem / önbellek
// anahtarı / çözücü çıktısı / sorgu listesi BAYT BAYT eskisi.
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
  parseUnderstanding,
  understandingQueries,
  understandingSchemaFor,
  type MessageUnderstanding,
} from "@/lib/ai/semantic/understanding-schema";
import {
  UNDERSTANDING_ENGLISH_QUERY_ADDENDUM,
  UNDERSTANDING_ITEMS_PROMPT_ADDENDUM,
  UNDERSTANDING_SYSTEM_PROMPT,
  understandGuestMessages,
  understandingEnglishQueryEnabled,
  understandingSystemPromptFor,
  __resetUnderstandingCache,
} from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const RAW_EN = {
  language: "tr",
  requests: [
    { intent: "amenities", query_tr: "musluk suyu filtre sürahi", query_original: "musluk suyu filtre sürahi", query_en: "tap water filter jug" },
    { intent: "appliance_help", query_tr: "vantilatör çalışır bırakma", query_original: "vantilatör çalışır bırakma", query_en: "leave fans running when out" },
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

const requestItem = (s: ReturnType<typeof understandingSchemaFor>) =>
  s.schema.properties.requests.items as unknown as { required: string[]; properties: Record<string, unknown> };

describe("şema", () => {
  it("🚨 kapalıyken temel / öğe şeması AYNI nesne (bayt bayt eski)", () => {
    expect(understandingSchemaFor({})).toBe(UNDERSTANDING_JSON_SCHEMA);
    expect(understandingSchemaFor({ items: true })).toBe(UNDERSTANDING_JSON_SCHEMA_ITEMS);
    expect(understandingSchemaFor({ english: false })).toBe(UNDERSTANDING_JSON_SCHEMA);
  });

  it("açıkken her istek query_en ZORUNLU taşır (strict), ad eki _en; öğe + kural + ilişki alanlarıyla birlikte", () => {
    const s = understandingSchemaFor({ english: true });
    expect(s.strict).toBe(true);
    expect(s.name).toBe(`${UNDERSTANDING_JSON_SCHEMA.name}_en`);
    expect(requestItem(s).required).toEqual(["intent", "query_tr", "query_original", "query_en"]);
    expect(requestItem(s).properties.query_en).toEqual({ type: "string" });
    const all = understandingSchemaFor({ items: true, rules: true, followup: true, english: true });
    expect(requestItem(all).required).toEqual(["intent", "query_tr", "query_original", "message", "rule_topic", "rule_stance", "relation", "query_en"]);
    expect(all.name).toBe(`${UNDERSTANDING_JSON_SCHEMA_ITEMS.name}_rules_rel_en`);
    // Kök şema değişmedi (dil, istekler, konaklama).
    expect(all.schema.required).toEqual(UNDERSTANDING_JSON_SCHEMA_ITEMS.schema.required);
  });
});

describe("çözücü", () => {
  it("açıkken queryEn okunur (temizlenir); boş / eksik değer alan YOK (istek düşmez)", () => {
    const raw = { ...RAW_EN, requests: [...RAW_EN.requests, { intent: "wifi", query_tr: "wifi şifresi", query_original: "wifi şifresi", query_en: "  " }] };
    const u = parseUnderstanding(raw, { english: true });
    expect(u?.requests.map((r) => r.queryEn)).toEqual(["tap water filter jug", "leave fans running when out", undefined]);
    expect(u?.requests).toHaveLength(3);
  });

  it("🚨 kapalıyken model alanı gönderse de OKUNMAZ (çıktı bayt bayt eski)", () => {
    const u = parseUnderstanding(RAW_EN);
    expect(u?.requests.every((r) => !("queryEn" in r))).toBe(true);
    expect(parseUnderstanding(RAW_EN, { items: false, rules: false })?.requests.every((r) => !("queryEn" in r))).toBe(true);
  });
});

describe("getirme sorguları — İngilizce köprü EN SONDA", () => {
  const und = (language: MessageUnderstanding["language"], reqs: [string, string, string?][]): MessageUnderstanding => ({
    language,
    requests: reqs.map(([tr, orig, en]) => ({ intent: "other", queryTr: tr, queryOriginal: orig, ...(en ? { queryEn: en } : {}) })),
    stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
  });

  it("Türkçe misafir: önce Türkçe sorgular, sonra İngilizce köprüler (özgün = Türkçe tekrarlanmaz); istek indeksi korunur", () => {
    expect(understandingQueries(und("tr", [["su filtresi", "su filtresi", "water filter"], ["vantilatör", "vantilatör", "fans"]]))).toEqual([
      { text: "su filtresi", turkish: true, request: 0 },
      { text: "vantilatör", turkish: true, request: 1 },
      { text: "water filter", turkish: false, request: 0 },
      { text: "fans", turkish: false, request: 1 },
    ]);
  });

  it("İngilizce misafir: köprü özgün sorguyla aynıysa tekrar YOK (büyük/küçük harf duyarsız)", () => {
    expect(understandingQueries(und("en", [["otopark", "parking", "Parking"]])).map((q) => q.text)).toEqual(["otopark", "parking"]);
  });

  it("tavan (6) korunur: köprüler Türkçe ve özgün dil sorgularının yerini ALMAZ", () => {
    const q = understandingQueries(und("de", [["a", "a-de", "a-en"], ["b", "b-de", "b-en"], ["c", "c-de", "c-en"]]));
    expect(q.map((x) => x.text)).toEqual(["a", "b", "c", "a-de", "b-de", "c-de"]);
  });

  it("🚨 köprüsüz anlama çıktısında liste bayt bayt eskisi", () => {
    const u = und("de", [["a", "a-de"], ["b", "b-de"]]);
    expect(understandingQueries(u)).toEqual([
      { text: "a", turkish: true, request: 0 },
      { text: "b", turkish: true, request: 1 },
      { text: "a-de", turkish: false, request: 0 },
      { text: "b-de", turkish: false, request: 1 },
    ]);
  });
});

describe("istem", () => {
  it("🚨 kapalıyken istem bayt bayt eski; açıkken ek EN SONDA", () => {
    expect(understandingSystemPromptFor({})).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(understandingSystemPromptFor({ english: false, items: true })).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}`);
    expect(understandingSystemPromptFor({ english: true, items: true })).toBe(
      `${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ITEMS_PROMPT_ADDENDUM}\n${UNDERSTANDING_ENGLISH_QUERY_ADDENDUM}`,
    );
  });

  it("ek: alan adı query_en, kişisel veri / kod / fiyat / tarih yasağı, İngilizce misafirde özgünle aynı", () => {
    expect(UNDERSTANDING_ENGLISH_QUERY_ADDENDUM).toContain("query_en");
    expect(UNDERSTANDING_ENGLISH_QUERY_ADDENDUM).toMatch(/Never include names, phone numbers, codes, prices or dates/);
    expect(UNDERSTANDING_ENGLISH_QUERY_ADDENDUM).toMatch(/identical to query_original when the guest writes English/);
  });
});

describe("çağrı — ayrı şema, istem eki ve önbellek girdisi", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
  });

  it("english: true → köprü şeması + ek; aynı içerik kapalı kipte AYRI çağrı (önbellek karışmaz)", async () => {
    const f = modelReturns(RAW_EN);
    const on = await understandGuestMessages({ guestMessage: "Su filtresi nerede?", english: true, fetchImpl: f });
    expect(on.status === "ok" && on.value.requests[0].queryEn).toBe("tap water filter jug");
    expect(bodyOf(f).response_format.json_schema).toEqual(understandingSchemaFor({ english: true }));
    expect(bodyOf(f).messages[0].content).toBe(`${UNDERSTANDING_SYSTEM_PROMPT}\n${UNDERSTANDING_ENGLISH_QUERY_ADDENDUM}`);

    const off = await understandGuestMessages({ guestMessage: "Su filtresi nerede?", fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
    expect(bodyOf(f, 1).messages[0].content).toBe(UNDERSTANDING_SYSTEM_PROMPT);
    expect(off.status === "ok" && off.value.requests.every((r) => !("queryEn" in r))).toBe(true);

    // Aynı kipte ikinci çağrı önbellekten (ağ yok).
    await understandGuestMessages({ guestMessage: "Su filtresi nerede?", english: true, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("karar noktası kb-retrieve: bayrak açıkken köprü kipi, kapalıyken / yanlış yazımda temel şema", async () => {
    const f = modelReturns(RAW_EN);
    vi.stubGlobal("fetch", f);
    const base = { items: [], guestMessage: "Su filtresi nerede?", history: [] };
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
    __resetUnderstandingCache();
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "1");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 1).response_format.json_schema).toEqual(understandingSchemaFor({ english: true }));
    __resetUnderstandingCache();
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "true");
    await (await retrieveKbForPrompt(base)).understanding;
    expect(bodyOf(f, 2).response_format.json_schema).toEqual(UNDERSTANDING_JSON_SCHEMA);
  });
});

describe("bayrak", () => {
  it("yalnız tam '1'", () => {
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "");
    expect(understandingEnglishQueryEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "true");
    expect(understandingEnglishQueryEnabled()).toBe(false);
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "1");
    expect(understandingEnglishQueryEnabled()).toBe(true);
  });
});

describe("ölçer ikizi + koşu kimliği", () => {
  it("rag-lab ikizi üretimle AYNI sırayı ve metinleri verir (köprüler sonda, istek indeksiyle)", async () => {
    const { understandingQueryRequests } = await import("../eval/rag-lab/core");
    const u = parseUnderstanding(RAW_EN, { english: true });
    expect(understandingQueryRequests(u).map(([t]) => t)).toEqual(understandingQueries(u).map((q) => q.text));
    expect(understandingQueryRequests(u)).toEqual([
      ["musluk suyu filtre sürahi", 0],
      ["vantilatör çalışır bırakma", 1],
      ["tap water filter jug", 0],
      ["leave fans running when out", 1],
    ]);
  });

  it("kip etiketi 'en'; kipi KENDİ veren ölçerde ürün bayrağı kimliğe sızmaz", async () => {
    const { evalRuntime, understandingModeLabel } = await import("../eval/run-meta");
    expect(understandingModeLabel({ items: true, english: true })).toBe("items+en");
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "1");
    expect(evalRuntime().prompts?.understandingMode).toMatch(/(^|\+)en$/);
    expect(evalRuntime({ understanding: { items: true } }).prompts?.understandingMode).toBe("items");
    vi.stubEnv("AI_UNDERSTANDING_EN_QUERY_ENABLED", "");
    expect(evalRuntime().prompts?.understandingMode).not.toMatch(/(^|\+)en$/);
  });
});
