import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// CEVAP PARÇALARI (kurucu 10-23 A; anahtar `AI_ANSWER_PARTS_ENABLED`). Kurucu: "Mesajı anlamlandır → gerçek ihtiyaçları ayır → her ihtiyaca
// kaynak bul → cevapları ayrı üret → uygun parçaları birleştir → yalnız gerçekten cevaplanan işleri kapat." · "'Sauna hakkında bilgim yok'
// üretilip sonra ayıklanmasın."
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { answerPartsEnabled, composeVerifiedReply, parseAnswerParts, type AnswerPart } from "@/lib/ai/answer-parts";
import { ANSWER_PARTS_REPLACEMENTS, buildReplyPrompt, replySystemPromptFor, REPLY_SYSTEM_PROMPT_DERIVATION_MISSING } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import { kbLine } from "@/lib/ai/retrieval/kb-line";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import type { ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import type { SuggestReplyInput } from "@/lib/ai/types";

const KB = [
  { category: "rules", title: "Havuz ve sauna", content: "Havuz her gün 20:00'de, sauna 22:00'de kapanır." },
  { category: "wifi", title: "Wi-Fi", content: "Ağ Lale-5G, şifre Lale2025." },
];
const SOURCES = [...KB.map((k, i) => ({ id: `kb:${i + 1}`, text: kbLine(k) })), { id: "property", text: "Check-in saati: 15:00\nCheck-out saati: 11:00" }];
const need = (ref: string, q: string[], topics: string[] = []) => ({ ref, terms: needTerms(q), topics });
const NEEDS = [need("R1", ["çıkış saati kaçta"], ["checkout"]), need("R2", ["havuz kaçta kapanıyor"], ["pool"]), need("R3", ["sauna var mı"])];
const p = (ref: string, text: string, evidence: string, status: AnswerPart["status"] = "answered"): AnswerPart => ({ ref, status, text, evidence });

describe("anahtar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("yalnız tam '1' ile açılır", () => {
    expect(answerPartsEnabled()).toBe(false);
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "true");
    expect(answerPartsEnabled()).toBe(false);
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    expect(answerPartsEnabled()).toBe(true);
  });
});

describe("beyan — STRICT", () => {
  const refs = ["R1", "R2"];
  it("dizi değil → missing; bozuk kayıt → malformed; bilinmeyen kimlik → unknown_ref; ikinci kayıt yok sayılır", () => {
    expect(parseAnswerParts(undefined, refs)).toEqual({ ok: false, reason: "missing" });
    expect(parseAnswerParts([{ ref: "R1", status: "maybe" }], refs)).toEqual({ ok: false, reason: "malformed" });
    expect(parseAnswerParts(["R1"], refs)).toEqual({ ok: false, reason: "malformed" });
    expect(parseAnswerParts([{ ref: "R9", status: "answered", text: "x", evidence: "y" }], refs)).toEqual({ ok: false, reason: "unknown_ref" });
    expect(
      parseAnswerParts(
        [
          { ref: "R1", status: "answered", text: " A ", evidence: " B " },
          { ref: "R1", status: "no_info" },
        ],
        refs,
      ),
    ).toEqual({ ok: true, parts: [{ ref: "R1", status: "answered", text: "A", evidence: "B" }] });
  });
});

describe("doğrulama + birleştirme", () => {
  it("🚨 doğrulanan parçalar istek sırasıyla gider; bilgi yok olan HİÇBİR cümle üretmez (açık kalır)", () => {
    const out = composeVerifiedReply({
      parts: [
        p("R2", "Havuz her gün 20:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır."),
        p("R1", "Çıkış saati 11:00.", "Check-out saati: 11:00"),
        p("R3", "", "", "no_info"),
      ],
      needs: NEEDS,
      sources: SOURCES,
    });
    expect(out.reply).toBe("Çıkış saati 11:00.\nHavuz her gün 20:00'de kapanıyor.");
    expect(out.refs).toEqual(["R1", "R2"]);
    expect(out.verdicts).toEqual([
      { ref: "R1", status: "verified", source: "property" },
      { ref: "R2", status: "verified", source: "kb:1" },
      { ref: "R3", status: "no_info" },
    ]);
    expect(out.reply).not.toMatch(/sauna|bilgi/i);
  });

  it("🚨 havuz sorusuna saunanın 22:00'ı: parça gitmez, istek açık kalır; öteki parça gider", () => {
    const out = composeVerifiedReply({
      parts: [p("R1", "Çıkış saati 11:00.", "Check-out saati: 11:00"), p("R2", "Havuz 22:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.")],
      needs: NEEDS.slice(0, 2),
      sources: SOURCES,
    });
    expect(out.reply).toBe("Çıkış saati 11:00.");
    expect(out.refs).toEqual(["R1"]);
    expect(out.verdicts[1]).toEqual({ ref: "R2", status: "rejected", issues: ["value_bound_elsewhere"] });
  });

  it("alıntı istemdeki hiçbir kaynakta yoksa (uydurma / misafir metni) gitmez", () => {
    const out = composeVerifiedReply({ parts: [p("R2", "Havuz 20:00'de kapanıyor.", "Havuz 20:00'de kapanır ve ısıtmalıdır.")], needs: [NEEDS[1]], sources: SOURCES });
    expect(out.verdicts).toEqual([{ ref: "R2", status: "rejected", issues: ["source_not_found"] }]);
    expect(out.reply).toBe("");
  });

  it("beyanı olmayan istek 'missing'; metni ya da alıntısı boş 'answered' reddedilir; çok uzun parça reddedilir", () => {
    const out = composeVerifiedReply({
      parts: [p("R2", "Havuz 20:00'de kapanıyor.", ""), p("R3", "x".repeat(601), "Havuz her gün 20:00'de, sauna 22:00'de kapanır.")],
      needs: NEEDS,
      sources: SOURCES,
    });
    expect(out.verdicts).toEqual([
      { ref: "R1", status: "missing" },
      { ref: "R2", status: "rejected", issues: ["text_missing"] },
      { ref: "R3", status: "rejected", issues: ["too_long"] },
    ]);
    expect(out.reply).toBe("");
  });
});

describe("istem katmanı", () => {
  it("🚨 öğe kipi yokken parça katmanı istemi DEĞİŞTİRMEZ; öğe kipiyle çapa bulunur, her birleşim eksiksiz", () => {
    const base = { codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false };
    expect(replySystemPromptFor({ ...base, itemsParts: true })).toBe(replySystemPromptFor(base));
    const items = replySystemPromptFor({ ...base, itemsMode: true });
    const parts = replySystemPromptFor({ ...base, itemsMode: true, itemsParts: true });
    expect(parts).not.toBe(items);
    expect(parts).toContain('"answers"');
    expect(parts).toContain("CEVAP PARÇALARI");
    expect(items).not.toContain("CEVAP PARÇALARI");
    expect(ANSWER_PARTS_REPLACEMENTS).toHaveLength(1);
    for (const [name, missing] of Object.entries(REPLY_SYSTEM_PROMPT_DERIVATION_MISSING())) expect([name, missing]).toEqual([name, []]);
  });
});

// ─── suggestReply: modelin `answers` alanından kodun metni ─────────────────────────────────────────────────────────────────────

const input: SuggestReplyInput = {
  guestMessage: "Çıkış saat kaçta? Havuz kaçta kapanıyor? Sauna var mı?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: KB,
  tone: "warm",
  language: "tr",
  now: new Date("2026-09-25T10:00:00Z"),
};
const ITEMS: ReplyItemsInput = {
  answerable: [
    { ref: "R1", kind: "checkout_time", hint: "çıkış saati", need: { terms: needTerms(["çıkış saati kaçta"]), topics: ["checkout"] } },
    { ref: "R2", kind: "amenities", hint: "havuz kapanış saati", need: { terms: needTerms(["havuz kaçta kapanıyor"]), topics: ["pool"] } },
    { ref: "R3", kind: "amenities", hint: "sauna var mı", need: { terms: needTerms(["sauna var mı"]), topics: [] } },
  ],
  held: [],
  parts: true,
};
const MODEL = {
  intent: "general",
  stayChangeAsked: "none",
  confidence: 0.92,
  reply: "Çıkış saati 11:00, havuz 20:00'de kapanıyor. Sauna hakkında bilgim yok.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
  answeredRequests: ["R1", "R2", "R3"],
};
function openAiReturns(content: Record<string, unknown>) {
  const f = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

describe("suggestReply — parça kipi", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 misafire giden metin modelin reply'ı DEĞİL, doğrulanan parçalar; 'bilgim yok' cümlesi hiç yok; cevaplandı = doğrulananlar", async () => {
    openAiReturns({
      ...MODEL,
      answers: [
        { ref: "R1", status: "answered", text: "Çıkış saati 11:00.", evidence: "Check-out saati: 11:00" },
        { ref: "R2", status: "answered", text: "Havuz her gün 20:00'de kapanıyor.", evidence: "Havuz her gün 20:00'de, sauna 22:00'de kapanır." },
        { ref: "R3", status: "no_info", text: "", evidence: "" },
      ],
    });
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("Çıkış saati 11:00.\nHavuz her gün 20:00'de kapanıyor.");
    expect(r.reply).not.toMatch(/bilgim yok|sauna/i);
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1", "R2"] });
    expect(r.answerParts?.map((v) => v.status)).toEqual(["verified", "verified", "no_info"]);
  });

  it("🚨 beyan eksikse metin boş ve beyan geçersiz (kapı tutar) — modelin reply'ına geri düşülmez", async () => {
    openAiReturns(MODEL);
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answeredRequests).toEqual({ ok: false, reason: "missing" });
  });

  it("parça kipi kapalıyken (öğe kipi açık) bugünkü davranış: modelin reply'ı + answeredRequests", async () => {
    openAiReturns({ ...MODEL, answers: [{ ref: "R1", status: "answered", text: "X", evidence: "Y" }] });
    const { parts: _p, ...noParts } = ITEMS;
    const r = await suggestReply({ ...input, conversationItems: noParts });
    expect(r.reply).toBe(MODEL.reply);
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1", "R2", "R3"] });
    expect("answerParts" in r).toBe(false);
  });

  it("istem: parça kipinde kaynaklar istemde gösterilen biçimde döner; kapalıyken alan yok", () => {
    const on = buildReplyPrompt({ ...input, conversationItems: ITEMS });
    expect(on.partSources?.map((s) => s.id)).toEqual(["kb:1", "kb:2", "property"]);
    expect(on.partSources?.[2].text).toContain("Check-out saati: 11:00");
    const { parts: _p, ...noParts } = ITEMS;
    expect("partSources" in buildReplyPrompt({ ...input, conversationItems: noParts })).toBe(false);
  });
});
