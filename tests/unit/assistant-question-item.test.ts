import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Kurucu 10-23: kaynak / asistan sorusu ("Bunu nereden biliyorsun?", "Bot musun?") ayrı istek `about_assistant` — otomatik cevaplanmaz,
// panelde açık, e-posta yok; aynı mesajın bağımsız soruları cevaplanır. Anahtar `AI_ASSISTANT_QUESTION_ITEM_ENABLED` (yalnız öğe kipinde);
// KAPALIYKEN şema, istem, çözücü ve arama sorguları BAYT BAYT eski.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import {
  UNDERSTANDING_INTENTS,
  UNDERSTANDING_JSON_SCHEMA_ITEMS,
  parseUnderstanding,
  understandingQueries,
  understandingSchemaFor,
} from "@/lib/ai/semantic/understanding-schema";
import {
  UNDERSTANDING_ASSISTANT_QUESTION_ADDENDUM,
  understandingAssistantQuestionEnabled,
  understandingSystemPromptFor,
} from "@/lib/ai/semantic/understand";
import { ITEM_KIND_LABELS_TR, NO_NOTIFY_KINDS, buildItemsForMessage, isItemKind } from "@/lib/conversation-items/core";

afterEach(() => vi.unstubAllEnvs());

const STAY = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
const raw = {
  language: "tr",
  requests: [
    { intent: "wifi", message: 1, query_tr: "wifi şifresi", query_original: "Wi-Fi şifresi neydi?" },
    { intent: "about_assistant", message: 1, query_tr: "bilgiyi nereden buluyorsun", query_original: "Bu bilgiyi nereden buluyorsun?" },
  ],
  stay_change: STAY,
  withdrawn: [],
};

describe("anahtar KAPALI — bayt bayt eski", () => {
  it("anahtar yalnız tam '1' ile açılır", () => {
    expect(understandingAssistantQuestionEnabled()).toBe(false);
    vi.stubEnv("AI_ASSISTANT_QUESTION_ITEM_ENABLED", "true");
    expect(understandingAssistantQuestionEnabled()).toBe(false);
    vi.stubEnv("AI_ASSISTANT_QUESTION_ITEM_ENABLED", "1");
    expect(understandingAssistantQuestionEnabled()).toBe(true);
  });

  it("temel niyet kümesi DEĞİŞMEDİ; öğe şeması aynı nesne; istem eksiz", () => {
    expect(UNDERSTANDING_INTENTS).not.toContain("about_assistant");
    expect(understandingSchemaFor({ items: true })).toBe(UNDERSTANDING_JSON_SCHEMA_ITEMS);
    expect(understandingSystemPromptFor({ items: true })).not.toContain("QUESTIONS ABOUT THE ASSISTANT ITSELF");
  });

  it("kapalıyken çözücü o niyetli kalemi bugünkü gibi DÜŞÜRÜR", () => {
    const u = parseUnderstanding(raw, { items: true });
    expect(u?.requests.map((r) => r.intent)).toEqual(["wifi"]);
  });
});

describe("anahtar AÇIK (öğe kipi)", () => {
  it("şema niyeti tanır, ad eki '_asst'; öğe kipi değilse eklenmez", () => {
    const s = understandingSchemaFor({ items: true, assistant: true }) as { name: string; schema: { properties: { requests: { items: { properties: { intent: { enum: string[] } } } } } } };
    expect(s.name).toBe("guest_message_understanding_items_asst");
    expect(s.schema.properties.requests.items.properties.intent.enum).toContain("about_assistant");
    expect(understandingSchemaFor({ assistant: true })).not.toHaveProperty("name", expect.stringContaining("_asst"));
  });

  it("vazgeçme listesi de kaynak sorusunu taşır (misafir 'boşverin' deyince öğe kapanabilsin); anahtar kapalıyken liste eski kümede", () => {
    type W = { schema: { properties: { withdrawn: { items: { properties: { intent: { enum: string[] } } } } } } };
    expect((understandingSchemaFor({ items: true, assistant: true }) as unknown as W).schema.properties.withdrawn.items.properties.intent.enum).toContain("about_assistant");
    expect((understandingSchemaFor({ items: true }) as unknown as W).schema.properties.withdrawn.items.properties.intent.enum).not.toContain("about_assistant");
    const w = { ...raw, withdrawn: [{ intent: "about_assistant", message: 0 }] };
    expect(parseUnderstanding(w, { items: true, assistant: true })?.withdrawn).toEqual([{ intent: "about_assistant", message: 0 }]);
    expect(parseUnderstanding(w, { items: true })?.withdrawn).toEqual([]);
  });

  it("istem eki yalnız öğe kipinde", () => {
    expect(understandingSystemPromptFor({ items: true, assistant: true })).toContain(UNDERSTANDING_ASSISTANT_QUESTION_ADDENDUM);
    expect(understandingSystemPromptFor({ assistant: true })).not.toContain("QUESTIONS ABOUT THE ASSISTANT ITSELF");
  });

  it("çözücü niyeti tutar; kaynak sorusu ARAMA SORGUSU değildir", () => {
    const u = parseUnderstanding(raw, { items: true, assistant: true });
    expect(u?.requests.map((r) => r.intent)).toEqual(["wifi", "about_assistant"]);
    expect(understandingQueries(u).map((q) => q.text)).not.toContain("bilgiyi nereden buluyorsun");
    expect(understandingQueries(u).map((q) => q.text)).toContain("wifi şifresi");
  });

  it("öğe: hassas (cevaplanmaz, panelde açık), e-posta muaf, kalıcı tür olarak tanınır", () => {
    const items = buildItemsForMessage({ requests: [{ intent: "wifi" }, { intent: "about_assistant" }], lexicalLabels: [] });
    expect(items.map((i) => [i.kind, i.sensitivity])).toEqual([
      ["wifi", "none"],
      ["about_assistant", "sensitive"],
    ]);
    expect(NO_NOTIFY_KINDS.has("about_assistant")).toBe(true);
    expect(isItemKind("about_assistant")).toBe(true);
    expect(ITEM_KIND_LABELS_TR.about_assistant).toBe("asistan / bilgi kaynağı sorusu");
  });
});
