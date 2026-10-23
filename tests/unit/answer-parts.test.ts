import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// CEVAP PARÇALARI (kurucu 10-23 A; anahtar `AI_ANSWER_PARTS_ENABLED`). Kurucu: "Mesajı anlamlandır → gerçek ihtiyaçları ayır → her ihtiyaca
// kaynak bul → cevapları ayrı üret → uygun parçaları birleştir → yalnız gerçekten cevaplanan işleri kapat." · "'Sauna hakkında bilgim yok'
// üretilip sonra ayıklanmasın."
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { answerPartsEnabled, CODE_KEPT_ISSUES, composeVerifiedReply, foldPartText, groundEvidence, parseAnswerParts, partTextKey, type AnswerPart } from "@/lib/ai/answer-parts";
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
  it("dizi değil → missing; bozuk / tanınmayan / tekrar eden kayıt TEK TEK atlanır (tek 'R0' öteki parçaları düşürmez)", () => {
    expect(parseAnswerParts(undefined, refs)).toEqual({ ok: false, reason: "missing" });
    expect(
      parseAnswerParts(
        [
          { ref: "R0", status: "answered", text: "x", evidence: "y" },
          { ref: "R2", status: "maybe" },
          "R1",
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

describe("Codex S3 (10-23 sabah-3) — okuyucu koşarken anlam denetimi okuyucunun, kaynak geçerliliği kodun", () => {
  const sauna = p("R2", "Havuz 22:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.");

  it("🚨 anlam bulgusu (değer başka hizmete bağlı) okuyucu koşarken TUTMAZ: parça okuyucuya gider, bulgu ize yazılır; kod kipinde tutar", () => {
    const byReader = composeVerifiedReply({ parts: [sauna], needs: [NEEDS[1]], sources: SOURCES, meaningJudge: "reader" });
    expect(byReader.verdicts).toEqual([{ ref: "R2", status: "verified", source: "kb:1", advisory: ["value_bound_elsewhere"] }]);
    expect(byReader.verified.map((v) => v.ref)).toEqual(["R2"]);
    // Varsayılan (ve okuyucusuz) kip bugünkü kural.
    expect(composeVerifiedReply({ parts: [sauna], needs: [NEEDS[1]], sources: SOURCES }).verdicts[0]).toEqual({
      ref: "R2",
      status: "rejected",
      issues: ["value_bound_elsewhere"],
    });
  });

  it("🚨 okuyucu tutarsa parça gitmez; kodun gördüğü bulgu tutma kaydında kalır (ölçüm: ikisi aynı şeyi mi gördü)", () => {
    const out = composeVerifiedReply({ parts: [sauna], needs: [NEEDS[1]], sources: SOURCES, meaningJudge: "reader", holds: new Map([["R2", "binding" as const]]) });
    expect(out.reply).toBe("");
    expect(out.refs).toEqual([]);
    expect(out.verdicts).toEqual([{ ref: "R2", status: "rejected", issues: ["reader_binding"], advisory: ["value_bound_elsewhere"] }]);
  });

  it("🚨 kaynak geçerliliği okuyucu koşarken de KODDA: uydurma saat · alıntı kalemde yok · alıntı başka kaynakta hiç yok · konusu bilinmeyen ihtiyaç", () => {
    const judge = (part: AnswerPart, n = NEEDS[1]) => composeVerifiedReply({ parts: [part], needs: [n], sources: SOURCES, meaningJudge: "reader" }).verdicts[0];
    expect(judge(p("R2", "Havuz 21:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır."))).toMatchObject({
      status: "rejected",
      issues: expect.arrayContaining(["value_not_in_evidence"]),
    });
    expect(judge(p("R2", "Havuz 20:00'de kapanıyor.", "Havuz 20:00'de kapanır ve ısıtmalıdır."))).toEqual({ ref: "R2", status: "rejected", issues: ["source_not_found"] });
    const unknown = { ref: "R2", terms: [] as string[], topics: [] as string[] };
    expect(judge(p("R2", "20:00.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır."), unknown)).toMatchObject({
      status: "rejected",
      issues: expect.arrayContaining(["subject_unknown"]),
    });
    // Okuyucu kipinde tutan bulgu listesi YALNIZ koddaki denetimlerden (anlam bulgusu karışmaz).
    const v = judge(p("R2", "Havuz 21:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır."));
    expect(v.status === "rejected" && v.issues.every((i) => CODE_KEPT_ISSUES.has(i as never))).toBe(true);
  });

  it("sorulan yön / tesis (kapsam) de okuyucunun sorusu: okuyucu kipinde ize yazılır, kod kipinde tutar", () => {
    const n = { ref: "R1", terms: needTerms(["havuz kaçta açılıyor"]), topics: [], queries: ["havuz kaçta açılıyor"] };
    const src = [{ id: "kb:1", text: kbLine({ category: "amenities", title: "Havuz", content: "Havuz ısıtmalıdır." }) }];
    const part = p("R1", "Havuz ısıtmalıdır.", "Havuz ısıtmalıdır.");
    expect(composeVerifiedReply({ parts: [part], needs: [n], sources: src }).verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    expect(composeVerifiedReply({ parts: [part], needs: [n], sources: src, meaningJudge: "reader" }).verdicts[0]).toEqual({
      ref: "R1",
      status: "verified",
      source: "kb:1",
      advisory: ["aspect_missing"],
    });
  });

  it("kodda kalan küme bilinçli: yapı + kaynak geçerliliği + sayı (Codex S3 listesi; büyürse / küçülürse bu test bilerek güncellenir)", () => {
    expect([...CODE_KEPT_ISSUES].sort()).toEqual(["evidence_missing", "evidence_not_in_source", "subject_unknown", "value_conflict", "value_not_in_evidence"]);
  });
});

describe("#199 kör set incelemesi 10-23 — alıntı iki kalemi birleştirebilir; çevrilmiş kalem başlığı alıntıyı düşürmez", () => {
  const TWO = [
    { id: "kb:1", text: kbLine({ category: "amenities", title: "Havuz", content: "Havuz hafta içi 09:00–20:00 arası açıktır." }) },
    { id: "kb:2", text: kbLine({ category: "amenities", title: "Havuz hafta sonu", content: "Hafta sonu havuz 09:00–23:00 arası açıktır." }) },
  ];

  it("🚨 her cümlesi bir kalemde birebir geçen alıntı dayanaklıdır: dayanak ilk cümlenin kalemi, bağ denetimine o cümle gider", () => {
    expect(groundEvidence(TWO, "Havuz hafta içi 09:00–20:00 arası açıktır. Hafta sonu havuz 09:00–23:00 arası açıktır.")).toEqual({
      source: TWO[0],
      quote: "Havuz hafta içi 09:00–20:00 arası açıktır.",
      cited: [TWO[0], TWO[1]],
    });
    const out = composeVerifiedReply({
      parts: [p("R1", "Havuz hafta içi 20:00'de, hafta sonu 23:00'te kapanıyor.", "Havuz hafta içi 09:00–20:00 arası açıktır. Hafta sonu havuz 09:00–23:00 arası açıktır.")],
      needs: [{ ref: "R1", terms: needTerms(["havuz kaçta kapanıyor"]), topics: [] }],
      sources: TWO,
      meaningJudge: "reader",
    });
    expect(out.verdicts[0]).toMatchObject({ status: "verified", source: "kb:1" });
    // Okuyucu alıntının geçtiği İKİ kalemi de görür (index.ts notları `cited`dan da kurar).
    expect(out.verified[0]).toMatchObject({ source: "kb:1", alsoCited: ["kb:2"] });
  });

  it("🚨 ikinci kalem konu sözcüğünü anmasa da (\"Cumartesi ve pazar …\") alıntılandıysa değeri aranır: sayı denetimi geçer, anlam okuyucuya", () => {
    const split = [
      TWO[0],
      { id: "kb:2", text: kbLine({ category: "amenities", title: "Hafta sonu", content: "Cumartesi ve pazar 09:00–23:00 arası açıktır." }) },
    ];
    const out = composeVerifiedReply({
      parts: [p("R1", "Havuz hafta içi 20:00'de, cumartesi ve pazar 23:00'te kapanıyor.", "Havuz hafta içi 09:00–20:00 arası açıktır. Cumartesi ve pazar 09:00–23:00 arası açıktır.")],
      needs: [{ ref: "R1", terms: needTerms(["havuz kaçta kapanıyor"]), topics: [] }],
      sources: split,
      meaningJudge: "reader",
    });
    expect(out.verdicts[0]).toMatchObject({ status: "verified", source: "kb:1" });
    expect(out.verified[0]).toMatchObject({ alsoCited: ["kb:2"] });
  });

  it("🚨 bir cümlesi bile kaynakta yoksa (uydurma ek) alıntı dayanaksız; tek sözcüklük parça dayanak sayılmaz", () => {
    expect(groundEvidence(TWO, "Havuz hafta içi 09:00–20:00 arası açıktır. Havuz gece 24:00'e kadar ısıtılır.")).toBeNull();
    expect(groundEvidence(TWO, "Evet. Havuz hafta içi 09:00–20:00 arası açıktır.")).toBeNull();
    expect(groundEvidence(TWO, "")).toBeNull();
    // Uydurma değer yine kodda düşer (çok parçalı alıntı değer denetimini gevşetmez).
    const out = composeVerifiedReply({
      parts: [p("R1", "Havuz hafta sonu 23:30'da kapanıyor.", "Havuz hafta içi 09:00–20:00 arası açıktır. Hafta sonu havuz 09:00–23:00 arası açıktır.")],
      needs: [{ ref: "R1", terms: needTerms(["havuz kaçta kapanıyor"]), topics: [] }],
      sources: TWO,
      meaningJudge: "reader",
    });
    expect(out.verdicts[0]).toMatchObject({ status: "rejected", issues: expect.arrayContaining(["value_not_in_evidence"]) });
  });

  it("🚨 misafirin diline çevrilmiş kalem başlığı ('Интернет: …') atılıp kalan alıntı birebir aranır; başlıksız biçim aynen", () => {
    const wifi = [{ id: "kb:1", text: kbLine({ category: "wifi", title: "İnternet", content: "Wi-Fi adı Lale-5G, şifre Lale2025." }) }];
    expect(groundEvidence(wifi, "Интернет: Wi-Fi adı Lale-5G, şifre Lale2025.")).toEqual({ source: wifi[0], quote: "Wi-Fi adı Lale-5G, şifre Lale2025.", cited: [wifi[0]] });
    expect(groundEvidence(wifi, "İnternet: Wi-Fi adı Lale-5G, şifre Lale2025.")).toEqual({
      source: wifi[0],
      quote: "İnternet: Wi-Fi adı Lale-5G, şifre Lale2025.",
      cited: [wifi[0]],
    });
    // Başlık atıldıktan sonra kalan metin de kaynakta yoksa dayanaksız; rakam taşıyan "başlık" atılmaz.
    expect(groundEvidence(wifi, "Интернет: şifre Lale2026.")).toBeNull();
    expect(groundEvidence(wifi, "Oda 12: Wi-Fi adı Lale-5G, şifre Lale2025.")).toBeNull();
  });

  it("🚨 Haiku 10-23: başlık atma koşul SIZDIRMAZ — koşullu 'başlık' atılmaz, kalan yalnız kalem içeriğinin BAŞINDA aranır, harf tabanı atılmış metinde", () => {
    const pool = [{ id: "kb:1", text: kbLine({ category: "amenities", title: "Havuz", content: "Havuz 23:00'e kadar açıktır. Şezlong ücretsizdir." }) }];
    expect(groundEvidence(pool, "Hafta sonu: Havuz 23:00'e kadar açıktır.")).toBeNull();
    expect(groundEvidence(pool, "Weekend: Havuz 23:00'e kadar açıktır.")).toBeNull();
    expect(groundEvidence(pool, "Cumartesi: Havuz 23:00'e kadar açıktır.")).toBeNull();
    // Çevrilmiş başlık geçer; içeriğin ORTASINDAN alıntı başlıkla geçmez.
    expect(groundEvidence(pool, "Бассейн: Havuz 23:00'e kadar açıktır.")).toMatchObject({ source: pool[0], quote: "Havuz 23:00'e kadar açıktır." });
    expect(groundEvidence(pool, "Бассейн: Şezlong ücretsizdir.")).toBeNull();
    // Çok parçalı alıntıda harf tabanı başlığı atılmış metne uygulanır ("Hafta sonu: 23:00." başlıkla 9 harf, kendisi 0).
    expect(groundEvidence(pool, "Havuz 23:00'e kadar açıktır. Pool: 23:00.")).toBeNull();
  });
});

describe("kurucu etiket notu 10-23: evet / hayır sorusunda cevap 'Evet,' / 'Hayır,' ile başlar, günü açık yazar", () => {
  it("parça kipinin istem satırı bu kuralı taşır (misafirin dilinde)", () => {
    expect(ANSWER_PARTS_REPLACEMENTS[0][1]).toContain('text "Evet," ya da "Hayır," ile başlar (misafirin dilinde)');
    expect(ANSWER_PARTS_REPLACEMENTS[0][1]).toContain("günü / dönemi açıkça yaz");
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
/** Okuyucunun "hepsi evet" hükmü (okuyucuya giden her istek kimliği için) — kodun doğrulamasını sınayan testler okuyucuya takılmaz. */
function readerAllYes(body: string): Response {
  const refs = [...new Set([...body.matchAll(/(R\d+) · (?:TOPIC|REQUEST)/g)].map((m) => m[1]))];
  const parts = refs.map((ref) => ({ ref, answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, quote: "" }));
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts }) } }] }), { status: 200 });
}
/**
 * Cevap çağrısı + parça okuyucusu (Opus 10-23 G1: parça kipi okuyucusuz bütün parçaları TUTAR — kodun doğrulamasını sınayan testler okuyucuyu
 * açık ve "hepsi evet" çalıştırır; okuyucunun kendi davranışı aşağıdaki ayrı blokta).
 */
function openAiReturns(content: Record<string, unknown>) {
  vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
  const f = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    if (body.includes('"part_reader"')) return readerAllYes(body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 });
  });
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

describe("suggestReply — parça kipi, Haiku 10-23 düzeltmeleri", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const R1 = { ref: "R1", status: "answered", text: "Çıkış saati 11:00.", evidence: "Check-out saati: 11:00" };

  it("🚨 modelin serbest reply'ı boş olsa da doğrulanan parça gider (yedeğe düşmez)", async () => {
    openAiReturns({ ...MODEL, reply: "", answers: [R1] });
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.source).toBe("openai");
    expect(r.reply).toBe("Çıkış saati 11:00.");
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1"] });
  });

  it("hiçbir parça doğrulanmadıysa metin BOŞ — kodun selamı da eklenmez", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    openAiReturns({ ...MODEL, answers: [{ ref: "R1", status: "no_info", text: "", evidence: "" }] });
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answeredRequests).toEqual({ ok: true, refs: [] });
  });

  it("kaynak beyanı yalnız doğrulanan parçanın kaynağı (atılan serbest metnin beyanı değil)", async () => {
    openAiReturns({ ...MODEL, usedSources: ["kb:rules", "kb:wifi", "property:checkOutTime"], answers: [R1] });
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.usedSources).toEqual(["property:checkOutTime"]);
  });

  it("🚨 birleşik metin de gönderim tavanına (2000) tabi: aşarsa güven ≤ 0.5 → otomatik gitmez", async () => {
    // Dört kalem dört AYRI bahçe (eski veri "Bahçe bir / iki misafirlere" aynı konuya dört farklı kişi sayısı veriyordu → artık çelişki
    // sayılıp tutulur, Opus güvenlik 10-23 F6; bu testin konusu tavan).
    const body = (i: number) => `${["Ön", "Arka", "Yan", "Çatı"][i]} bahçe misafirlere açıktır ve ${"bahçede dinlenebilir, kitap okuyabilir, çay içebilirsiniz; ".repeat(8)}`.trim();
    const kb = [0, 1, 2, 3].map((i) => ({ category: "amenities", title: `Bahçe ${i}`, content: body(i) }));
    const items: ReplyItemsInput = {
      answerable: [0, 1, 2, 3].map((i) => ({ ref: `R${i + 1}`, kind: "amenities" as const, hint: "bahçe", need: { terms: needTerms(["bahçe"]), topics: [] } })),
      held: [],
      parts: true,
    };
    openAiReturns({ ...MODEL, answers: [0, 1, 2, 3].map((i) => ({ ref: `R${i + 1}`, status: "answered", text: body(i), evidence: body(i) })) });
    const r = await suggestReply({ ...input, knowledgeBase: kb, conversationItems: items });
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1", "R2", "R3", "R4"] });
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  it("🚨 istek sorguları doğrulayıcıya ulaşır: saat sorusuna saatsiz parçanın kod bulgusu ize yazılır, kararı okuyucu verir (Codex S3)", async () => {
    const withQueries: ReplyItemsInput = {
      ...ITEMS,
      answerable: ITEMS.answerable.map((a) => (a.ref === "R2" ? { ...a, need: { ...a.need!, queries: ["havuz kapanış saati"] } } : a)),
    };
    const kb = [{ category: "rules", title: "Havuz", content: "Havuz ısıtmalıdır." }];
    const heated = [{ ref: "R2", status: "answered", text: "Havuz ısıtmalıdır.", evidence: "Havuz ısıtmalıdır." }];
    // Okuyucu "sorulanı cevaplamıyor" der → gitmez; kodun gördüğü bulgu tutma kaydında.
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    routedFetch(
      { ...MODEL, answers: heated },
      readerSays([{ ref: "R2", answers_request: "no", supported_by_notes: true, binding_ok: true, exception_without_rule: false, quote: "Havuz ısıtmalıdır." }]),
    );
    const held = await suggestReply({ ...input, knowledgeBase: kb, conversationItems: withQueries });
    expect(held.reply).toBe("");
    expect(held.answerParts?.find((v) => v.ref === "R2")).toEqual({ ref: "R2", status: "rejected", issues: ["reader_not_answered"], advisory: ["aspect_missing"] });
    // Okuyucu "evet" derse kod bulgusu tutmaz, yalnız izde kalır (ölçüm: okuyucu ile kodun ayrıştığı vaka görünür).
    openAiReturns({ ...MODEL, answers: heated });
    const r = await suggestReply({ ...input, knowledgeBase: kb, conversationItems: withQueries });
    expect(r.answerParts?.find((v) => v.ref === "R2")).toMatchObject({ status: "verified", advisory: ["aspect_missing"] });
    // Kontrol: sorgu yokken bulgu da yok.
    openAiReturns({ ...MODEL, answers: heated });
    const plain = await suggestReply({ ...input, knowledgeBase: kb, conversationItems: ITEMS });
    expect(plain.reply).toBe("Havuz ısıtmalıdır.");
    expect(plain.answerParts?.find((v) => v.ref === "R2")).not.toHaveProperty("advisory");
  });

  it("mülk bilgisindeki kodun '(belirtilmemiş …)' işareti alıntılanabilir kaynak değildir", () => {
    const on = buildReplyPrompt({ ...input, conversationItems: ITEMS });
    expect(on.partSources?.find((s) => s.id === "property")?.text).not.toContain("belirtilmemiş");
  });
});

describe("Opus 10-23: kaynak listesi", () => {
  const ONLY_GENERAL = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Havuz", content: "Havuz 20:00'de kapanır." }) }];
  const WITH_VARIANT = [...ONLY_GENERAL, { id: "kb:2", text: kbLine({ category: "rules", title: "Hafta sonu", content: "Hafta sonları havuz 23:00'e kadar açıktır." }) }];
  const part = p("R2", "Havuz 20:00'de kapanıyor.", "Havuz 20:00'de kapanır.");

  it("🚨 koşullu değişke BAŞKA kalemdeyse genel değer onu anmadan gitmez (öteki kaynaklar da okunur — O6)", () => {
    // Kontrol: değişke istemde yokken genel değer doğrulanır.
    expect(composeVerifiedReply({ parts: [part], needs: [NEEDS[1]], sources: ONLY_GENERAL }).refs).toEqual(["R2"]);
    const out = composeVerifiedReply({ parts: [part], needs: [NEEDS[1]], sources: WITH_VARIANT });
    expect(out.refs).toEqual([]);
    expect(out.verdicts).toEqual([{ ref: "R2", status: "rejected", issues: ["variant_omitted"] }]);
    // Değişkeyi de anan parça gider (değeri öteki kalemden doğrulanır).
    const both = p("R2", "Havuz 20:00'de kapanıyor; hafta sonları 23:00'e kadar açık.", "Havuz 20:00'de kapanır.");
    expect(composeVerifiedReply({ parts: [both], needs: [NEEDS[1]], sources: WITH_VARIANT }).refs).toEqual(["R2"]);
  });

  it("🚨 bütçeden düşen kalem kaynak listesinde YOK (model görmediği metne dayanamaz)", () => {
    const big = (t: string) => ({ category: "rules", title: t, content: `${t} kuralları: ${"ayrıntılı açıklama satırı. ".repeat(500)}` });
    const kb = [big("Bahçe"), big("Teras"), { category: "rules", title: "Havuz", content: "Havuz 20:00'de kapanır." }];
    const on = buildReplyPrompt({ ...input, knowledgeBase: kb, conversationItems: ITEMS });
    expect(on.kbOmitted).toBeGreaterThan(0);
    const ids = on.partSources?.map((s) => s.id) ?? [];
    // Bütçeye giren kalemler (ilk kalem her zaman girer) ve mülk bilgisi; düşen kalem listede yok, sıra numarası kendi yerinde kalır.
    expect(ids[0]).toBe("kb:1");
    expect(ids).toContain("property");
    expect(ids.length).toBe(1 + (3 - on.kbOmitted));
    for (const s of on.partSources ?? []) if (s.id.startsWith("kb:")) expect(on.text).toContain(s.text);
  });
});

// ─── Opus e2e 10-23 (parça kipinin uçtan uca incelemesi, `scratchpad/opus-e2e-parts.md`) ─────────────────────────────────────────

describe("Opus e2e 10-23 F2 — sorulan YÖN: doğru ama sorulanı cevaplamayan parça isteği kapatmaz", () => {
  const src = (content: string, category = "rules") => [{ id: "kb:1", text: kbLine({ category, title: "Bilgi", content }) }];
  const needQ = (ref: string, queries: string[], topics: string[] = []) => ({ ref, terms: needTerms(queries), topics, queries });

  it("🚨 'Havuz kaçta açılıyor?' ↔ 'Havuz ısıtmalıdır.' gitmez, açık kalır; saatli cevap gider", () => {
    const n = needQ("R1", ["havuz kaçta açılıyor", "Havuz kaçta açılıyor?"], ["pool"]);
    const off = composeVerifiedReply({ parts: [p("R1", "Havuz ısıtmalıdır.", "Havuz ısıtmalıdır.")], needs: [n], sources: src("Havuz ısıtmalıdır.") });
    expect(off.refs).toEqual([]);
    expect(off.reply).toBe("");
    expect(off.verdicts).toEqual([{ ref: "R1", status: "rejected", issues: ["aspect_missing"] }]);
    const ok = composeVerifiedReply({ parts: [p("R1", "Havuz 09:00'da açılır.", "Havuz 09:00'da açılır.")], needs: [n], sources: src("Havuz 09:00'da açılır.") });
    expect(ok.refs).toEqual(["R1"]);
  });

  it("🚨 'Otopark ücreti ne kadar?' ↔ konum cevabı gitmez; 'ücretsizdir' / tutar gider", () => {
    const kb = src("Otopark binanın arkasındadır, ücretsizdir.", "parking");
    const n = needQ("R1", ["otopark ücreti ne kadar"], ["parking"]);
    const where = composeVerifiedReply({ parts: [p("R1", "Otopark binanın arkasındadır.", "Otopark binanın arkasındadır")], needs: [n], sources: kb });
    expect(where.refs).toEqual([]);
    expect(where.verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    const free = composeVerifiedReply({ parts: [p("R1", "Otopark ücretsizdir.", "Otopark binanın arkasındadır, ücretsizdir.")], needs: [n], sources: kb });
    expect(free.refs).toEqual(["R1"]);
    const paid = src("Otopark günlük 200 TL'dir.", "parking");
    expect(composeVerifiedReply({ parts: [p("R1", "Otopark günlük 200 TL'dir.", "Otopark günlük 200 TL'dir.")], needs: [n], sources: paid }).refs).toEqual(["R1"]);
  });

  it("konuyu yok sayan / yasaklayan cevap saat ve ücret sorusunu da cevaplar; başka niteliğin olumsuzu cevaplamaz", () => {
    const pets = needQ("R1", ["evcil hayvan ücreti"], ["pets"]);
    const no = "Evcil hayvan kabul edilmemektedir.";
    expect(composeVerifiedReply({ parts: [p("R1", no, no)], needs: [pets], sources: src(no) }).refs).toEqual(["R1"]);
    const pool = needQ("R1", ["havuz açılış saati"], ["pool"]);
    const none = "Havuz yoktur.";
    expect(composeVerifiedReply({ parts: [p("R1", none, none)], needs: [pool], sources: src(none) }).refs).toEqual(["R1"]);
    const notHeated = "Havuz ısıtmalı değildir.";
    expect(composeVerifiedReply({ parts: [p("R1", notHeated, notHeated)], needs: [pool], sources: src(notHeated) }).verdicts).toEqual([
      { ref: "R1", status: "rejected", issues: ["aspect_missing"] },
    ]);
  });

  it("saatsiz ama sorulanı cevaplayan söyleyiş: '7/24 açık' / 'kış aylarında kapalı' gider", () => {
    const n = needQ("R1", ["havuz kaçta açılıyor"], ["pool"]);
    for (const t of ["Havuz 7/24 açıktır.", "Havuz kış aylarında kapalıdır."]) {
      expect(composeVerifiedReply({ parts: [p("R1", t, t)], needs: [n], sources: src(t) }).refs).toEqual(["R1"]);
    }
  });

  it("aşırı uygulama yok: yön sorulmadıysa (var mı / nerede / ne zaman) bugünkü kural; sorgu yoksa yön aranmaz", () => {
    const kb = src("Otopark binanın arkasındadır. Havuz ısıtmalıdır.");
    const where = needQ("R1", ["otopark nerede", "Where is the parking?"], ["parking"]);
    expect(composeVerifiedReply({ parts: [p("R1", "Otopark binanın arkasındadır.", "Otopark binanın arkasındadır.")], needs: [where], sources: kb }).refs).toEqual(["R1"]);
    const exists = needQ("R1", ["havuz var mı"], ["pool"]);
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz ısıtmalıdır.", "Havuz ısıtmalıdır.")], needs: [exists], sources: kb }).refs).toEqual(["R1"]);
    // "ne kadar" tek başına ücret değildir (mesafe / derinlik de olur).
    const far = needQ("R1", ["otopark ne kadar uzakta"], ["parking"]);
    expect(composeVerifiedReply({ parts: [p("R1", "Otopark binanın arkasındadır.", "Otopark binanın arkasındadır.")], needs: [far], sources: kb }).refs).toEqual(["R1"]);
    const noQueries = { ref: "R1", terms: needTerms(["havuz kaçta açılıyor"]), topics: ["pool"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz ısıtmalıdır.", "Havuz ısıtmalıdır.")], needs: [noQueries], sources: kb }).refs).toEqual(["R1"]);
  });

  it("çok dilli sorgu: İngilizce / Almanca / Rusça saat ve ücret sorusu", async () => {
    const { askedAspects } = await import("@/lib/ai/answer-binding");
    expect(askedAspects(["What time does the pool open?"])).toEqual(["time"]);
    expect(askedAspects(["Um wie viel Uhr schließt die Sauna?"])).toEqual(["time"]);
    expect(askedAspects(["Во сколько закрывается бассейн?"])).toEqual(["time"]);
    expect(askedAspects(["How much is parking?"])).toEqual(["price"]);
    expect(askedAspects(["Is parking free?"])).toEqual(["price"]);
    expect(askedAspects(["Was kostet das Parken?"])).toEqual(["price"]);
    expect(askedAspects(["Сколько стоит парковка?"])).toEqual(["price"]);
    // Çakışmalar: telefon şarj aleti, sigarasız daire, merkeze uzaklık, yol tarifi — yön değil.
    expect(askedAspects(["Is there a phone charger?", "Is the apartment smoke-free?", "Далеко до центра?", "Yolu tarif eder misiniz?", "Feel free to"])).toEqual([]);
  });
});

describe("Opus e2e 10-23 F3 — tek sorguda iki tesis: yalnız birini cevaplayan parça isteği kapatmaz", () => {
  const kb = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Saatler", content: "Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açıktır." }) }];
  const n = { ref: "R1", terms: needTerms(["sauna ve havuz kaçta açık"]), topics: ["pool"], queries: ["sauna ve havuz kaçta açık"] };

  it("🚨 yalnız havuz → gitmez, açık kalır; ikisi birden → gider", () => {
    const one = composeVerifiedReply({ parts: [p("R1", "Havuz 09:00-20:00 arası açıktır.", "Havuz 09:00-20:00 arası")], needs: [n], sources: kb });
    expect(one.refs).toEqual([]);
    expect(one.verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["subject_partial"] });
    const both = composeVerifiedReply({
      parts: [p("R1", "Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açıktır.", "Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açıktır.")],
      needs: [n],
      sources: kb,
    });
    expect(both.refs).toEqual(["R1"]);
  });

  it("çeviri çifti aynı tesis kimliğini taşır; tek tesisli sorgu bugünkü kural", () => {
    const en = { ...n, queries: ["havuz kaçta açık", "When does the pool open?"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz 09:00-20:00 arası açıktır.", "Havuz 09:00-20:00 arası")], needs: [en], sources: kb }).refs).toEqual(["R1"]);
  });

  it("🚨 Haiku 10-23 gece-3: aynı işe düşen iki tek-tesisli sorgu da iki tesis sayılır (şüphede tut)", () => {
    const two = { ...n, queries: ["havuz kapanış saati", "sauna kapanış saati"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz 09:00-20:00 arası açıktır.", "Havuz 09:00-20:00 arası")], needs: [two], sources: kb }).refs).toEqual([]);
  });

  it("anlama katmanının gerçek sorgu biçimi (anahtar sözcük): 'havuz sauna kapanış saati' iki tesis ister; 'otopark ücreti' ücret ister", () => {
    const merged = { ...n, queries: ["havuz sauna kapanış saati", "havuz sauna kapanış saati"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz 09:00-20:00 arası açıktır.", "Havuz 09:00-20:00 arası")], needs: [merged], sources: kb }).verdicts[0]).toEqual({
      ref: "R1",
      status: "rejected",
      issues: ["subject_partial"],
    });
    // Anahtar sözcük sorgusunda saat sorusu "saati / saatleri" ile gelir.
    const heated = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Havuz", content: "Havuz ısıtmalıdır." }) }];
    const hours = { ref: "R1", terms: needTerms(["havuz açılış saati"]), topics: ["pool"], queries: ["havuz açılış saati", "pool opening hours"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Havuz ısıtmalıdır.", "Havuz ısıtmalıdır.")], needs: [hours], sources: heated }).refs).toEqual([]);
    // Çeviri ikinci tesisi başka adla anarsa ("sauna" ↔ "spa") anılmayan tesis istenmiş sayılır — şüphede TUT (bilinen sınır, güvenli yön).
    const spa = { ...n, queries: ["havuz ve sauna saatleri", "pool and spa hours"] };
    const both = "Havuz 09:00-20:00 arası, sauna 10:00-22:00 arası açıktır.";
    expect(composeVerifiedReply({ parts: [p("R1", both, both)], needs: [spa], sources: kb }).refs).toEqual([]);
    const park = [{ id: "kb:1", text: kbLine({ category: "parking", title: "Otopark", content: "Otopark binanın arkasındadır, ücretsizdir." }) }];
    const fee = { ref: "R1", terms: needTerms(["otopark ücreti"]), topics: ["parking"], queries: ["otopark ücreti", "parking fee"] };
    expect(composeVerifiedReply({ parts: [p("R1", "Otopark binanın arkasındadır.", "Otopark binanın arkasındadır")], needs: [fee], sources: park }).refs).toEqual([]);
  });
});

describe("Haiku 10-23 gece-3 — sorulan saatin YÖNÜ, '24 saat önceden', çok dilli 7/24, tekrar anahtarı", () => {
  const src = (content: string) => [{ id: "kb:1", text: kbLine({ category: "rules", title: "Bilgi", content }) }];
  const needQ = (queries: string[]) => ({ ref: "R1", terms: needTerms(queries), topics: ["pool"], queries });

  it("🚨 'kapanış saati' ↔ tek açılış saati gitmez; 'açılış saati' ↔ tek kapanış saati gitmez; aralık ikisini de cevaplar", () => {
    const kb = src("Havuz: 09:00 - 20:00 arası açıktır. Havuz 09:00'da açılır. Havuz 20:00'de kapanır.");
    const close = needQ(["havuz kapanış saati"]);
    const open = needQ(["havuz açılış saati"]);
    const opens = "Havuz 09:00'da açılır.";
    const closes = "Havuz 20:00'de kapanır.";
    expect(composeVerifiedReply({ parts: [p("R1", opens, opens)], needs: [close], sources: kb }).verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    expect(composeVerifiedReply({ parts: [p("R1", closes, closes)], needs: [open], sources: kb }).verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    expect(composeVerifiedReply({ parts: [p("R1", closes, closes)], needs: [close], sources: kb }).refs).toEqual(["R1"]);
    const range = "Havuz: 09:00 - 20:00 arası açıktır.";
    expect(composeVerifiedReply({ parts: [p("R1", range, range)], needs: [close], sources: kb }).refs).toEqual(["R1"]);
    // Yönsüz soru ("havuz saatleri") her saati kabul eder.
    expect(composeVerifiedReply({ parts: [p("R1", opens, opens)], needs: [needQ(["havuz saatleri"])], sources: kb }).refs).toEqual(["R1"]);
    // İki yönlü soru ("açılış kapanış saatleri") tek yönle KAPANMAZ — öbür yarısı sessizce kaybolurdu (Opus taze göz 10-23 F2); aralık ya da
    // iki yönlü iki saat cevaplar.
    const both = needQ(["havuz açılış kapanış saatleri"]);
    expect(composeVerifiedReply({ parts: [p("R1", opens, opens)], needs: [both], sources: kb }).verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    expect(composeVerifiedReply({ parts: [p("R1", range, range)], needs: [both], sources: kb }).refs).toEqual(["R1"]);
    // İki yön ilk kapanışla gelse de iki yön sayılır (mutasyon E24: ilk yön seçiliyordu → tek kapanış saati geçerdi).
    expect(composeVerifiedReply({ parts: [p("R1", closes, closes)], needs: [needQ(["havuz kapanış ve açılış saatleri"])], sources: kb }).verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["aspect_missing"] });
    // İki saatli aralık "-e kadar" taşısa da açılış sorusunu cevaplar (mutasyon E21: tek saat şartı).
    const range2 = "Havuz 09:00'dan 20:00'ye kadar açıktır.";
    expect(composeVerifiedReply({ parts: [p("R1", range2, range2)], needs: [needQ(["havuz açılış saati"])], sources: src(range2) }).refs).toEqual(["R1"]);
  });

  it("🚨 '24 saat önceden' her zaman açık sayılmaz; '24 saat açık' ve başka dillerde 24 saat açık sayılır", () => {
    const close = needQ(["havuz kapanış saati"]);
    const advance = "Havuz 24 saat önceden ısıtılır.";
    expect(composeVerifiedReply({ parts: [p("R1", advance, advance)], needs: [close], sources: src(advance) }).refs).toEqual([]);
    const hours = needQ(["pool opening hours"]);
    for (const t of ["Havuz 24 saat açıktır.", "La piscina está abierta las 24 horas.", "Der Pool ist 24 Stunden geöffnet.", "Бассейн открыт 24 часа.", "La piscine est ouverte 24h/24."]) {
      expect([t, composeVerifiedReply({ parts: [p("R1", t, t)], needs: [hours], sources: src(t) }).refs]).toEqual([t, ["R1"]]);
    }
  });

  it("çok dilli saat / ücret sorusu ekleri: 'hangi saatte', 'kaçtan', 'Frühstückszeit', 'breakfast time', Arapça fiyat", async () => {
    const { askedAspects } = await import("@/lib/ai/answer-binding");
    for (const q of ["havuz hangi saatte açılıyor", "kahvaltı kaçtan itibaren", "Frühstückszeit", "breakfast time"]) expect([q, askedAspects([q])]).toEqual([q, ["time"]]);
    for (const q of ["أسعار الموقف", "تكلفة الموقف"]) expect([q, askedAspects([q])]).toEqual([q, ["price"]]);
    // Aşırı uygulama: "Fahrzeit" (yol süresi) saat sorusu değil.
    expect(askedAspects(["Fahrzeit zum Strand"])).toEqual([]);
  });

  it("🚨 tekrar anahtarı selamsız metinden; '1.500 TL' ile '1,500 TL' ayrı metin", () => {
    const kb = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Havuz", content: "Havuz 09:00'da açılır." }) }];
    const needs = [
      { ref: "R1", terms: needTerms(["havuz açılış saati"]), topics: ["pool"], queries: ["havuz açılış saati"] },
      { ref: "R2", terms: needTerms(["havuz kaçta açılıyor"]), topics: ["pool"], queries: ["havuz kaçta açılıyor"] },
    ];
    const out = composeVerifiedReply({ parts: [p("R1", "Havuz 09:00'da açılır.", "Havuz 09:00'da açılır."), p("R2", "Merhaba! Havuz 09:00'da açılır.", "Havuz 09:00'da açılır.")], needs, sources: kb });
    expect(out.refs).toEqual(["R1", "R2"]);
    expect(out.reply).toBe("Havuz 09:00'da açılır.");
    const fee = [{ id: "kb:1", text: kbLine({ category: "parking", title: "Otopark", content: "Otopark ücreti 1.500 TL, kısa süreli 1,500 TL." }) }];
    const fneeds = [
      { ref: "R1", terms: needTerms(["otopark ücreti"]), topics: ["parking"], queries: ["otopark ücreti"] },
      { ref: "R2", terms: needTerms(["otopark ücreti kısa süre"]), topics: ["parking"], queries: ["otopark ücreti kısa süre"] },
    ];
    const both = composeVerifiedReply({
      parts: [p("R1", "Otopark ücreti 1.500 TL.", "Otopark ücreti 1.500 TL"), p("R2", "Otopark ücreti 1,500 TL.", "kısa süreli 1,500 TL")],
      needs: fneeds,
      sources: fee,
    });
    // İkisi doğrulanırsa iki satır da gider (birleşip biri kaybolmaz).
    if (both.refs.length === 2) expect(both.reply.split("\n")).toHaveLength(2);
  });
});

describe("Opus e2e 10-23 F7 — aynı metin bir kez gider; sonraki parçanın selamı atılır", () => {
  it("🚨 iki istek aynı cümleyle cevaplandı: ikisi de kapanır, metin BİR kez", () => {
    const kb = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Havuz", content: "Havuz 09:00-20:00 arası açıktır." }) }];
    const needs = [
      { ref: "R1", terms: needTerms(["havuz kaçta açılıyor"]), topics: ["pool"], queries: ["havuz kaçta açılıyor"] },
      { ref: "R2", terms: needTerms(["havuz kaçta kapanıyor"]), topics: ["pool"], queries: ["havuz kaçta kapanıyor"] },
    ];
    const t = "Havuz 09:00-20:00 arası açıktır.";
    const out = composeVerifiedReply({ parts: [p("R1", t, t), p("R2", `${t} `, t)], needs, sources: kb });
    expect(out.refs).toEqual(["R1", "R2"]);
    expect(out.reply).toBe(t);
  });

  it("ikinci parçanın baştaki selamı atılır, ilkinin selamı kalır", () => {
    const out = composeVerifiedReply({
      parts: [p("R1", "Merhaba! Çıkış saati 11:00.", "Check-out saati: 11:00"), p("R2", "Merhaba, havuz her gün 20:00'de kapanıyor.", "Havuz her gün 20:00'de")],
      needs: [NEEDS[0], NEEDS[1]],
      sources: SOURCES,
    });
    expect(out.refs).toEqual(["R1", "R2"]);
    expect(out.reply).toBe("Merhaba! Çıkış saati 11:00.\nHavuz her gün 20:00'de kapanıyor.");
  });
});

describe("Opus e2e 10-23 F9 — bilgi tabanıyla çelişen standart saat parça kaynağı değildir", () => {
  it("🚨 mülk 15:00 ↔ bilgi tabanı 14:00: mülk kaynağında giriş saati satırı yok, çıkış saati (çelişmeyen) kalır", () => {
    const kb = [{ category: "rules", title: "Giriş", content: "Giriş saati 14:00'tür." }];
    const on = buildReplyPrompt({ ...input, knowledgeBase: kb, conversationItems: ITEMS });
    const property = on.partSources?.find((s) => s.id === "property")?.text ?? "";
    expect(on.timeConflicts.map((c) => c.field)).toContain("checkInTime");
    expect(property).not.toContain("Check-in saati");
    expect(property).toContain("Check-out saati: 11:00");
    // Kontrol: çelişki yokken satır kaynakta.
    expect(buildReplyPrompt({ ...input, conversationItems: ITEMS }).partSources?.find((s) => s.id === "property")?.text).toContain("Check-in saati: 15:00");
  });
});

// ---------------------------------------------------------------------------
// Kurucu 10-23 sabah — Soru 9 (genel kural + istisna) ve Soru 11 (parça okuyucusu) birleştirmede.
// ---------------------------------------------------------------------------
describe("Soru 9 — genel kural + istisna okuyucunun sorusu: okuyucu 'tek başına istisna' derse parça tutulur, bağımsız parça gider", () => {
  const POOL_KB = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Havuz", content: "Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır." }) }, ...SOURCES.slice(2)];
  const poolNeed = { ref: "R1", terms: needTerms(["havuz 22:00'ye kadar açık mı"]), topics: ["pool"], queries: ["havuz 22:00'ye kadar açık mı"] };
  const outNeed = { ref: "R2", terms: needTerms(["çıkış saati kaçta"]), topics: ["checkout"], queries: ["çıkış saati kaçta"] };
  const weekendOnly = p("R1", "Havuz hafta sonu 23:00'e kadar açık.", "Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.");
  const checkout = p("R2", "Çıkış saati 11:00.", "Check-out saati: 11:00");

  it("🚨 kurucunun örneği: kod parçayı DOĞRULAR (değer doğru yerde), okuyucunun 'exception_only' hükmü tutar; çıkış saati GİDER", () => {
    expect(composeVerifiedReply({ parts: [weekendOnly, checkout], needs: [poolNeed, outNeed], sources: POOL_KB }).refs).toEqual(["R1", "R2"]);
    const out = composeVerifiedReply({ parts: [weekendOnly, checkout], needs: [poolNeed, outNeed], sources: POOL_KB, holds: new Map([["R1", "exception_only" as const]]) });
    expect(out.refs).toEqual(["R2"]);
    expect(out.reply).toBe("Çıkış saati 11:00.");
    expect(out.verdicts[0]).toEqual({ ref: "R1", status: "rejected", issues: ["reader_exception_only"] });
  });
});

describe("Soru 11 — okuyucu yalnız TUTAR", () => {
  const twoParts = [
    p("R1", "Çıkış saati 11:00.", "Check-out saati: 11:00"),
    p("R2", "Havuz her gün 20:00'de kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır."),
  ];
  const needs = [NEEDS[0], NEEDS[1]];

  it("🚨 okuyucunun tuttuğu parça gitmez, isteği açık kalır; öteki parça gider", () => {
    const out = composeVerifiedReply({ parts: twoParts, needs, sources: SOURCES, holds: new Map([["R2", "not_answered" as const]]) });
    expect(out.refs).toEqual(["R1"]);
    expect(out.reply).toBe("Çıkış saati 11:00.");
    expect(out.verdicts[1]).toEqual({ ref: "R2", status: "rejected", issues: ["reader_not_answered"] });
    expect(out.verified.map((v) => v.ref)).toEqual(["R1"]);
  });

  it("🚨 okuyucu kodun tuttuğu parçayı serbest BIRAKAMAZ (tutma haritası yalnız düşürür; uydurma değer yine tutulur)", () => {
    const fake = p("R2", "Havuz 23:00'te kapanıyor.", "Havuz her gün 20:00'de, sauna 22:00'de kapanır.");
    const out = composeVerifiedReply({ parts: [fake], needs: [NEEDS[1]], sources: SOURCES, holds: new Map() });
    expect(out.refs).toEqual([]);
    expect(out.verdicts[0].status).toBe("rejected");
  });

  it("okuyucunun bilmediği istek kimliği hiçbir şeyi değiştirmez", () => {
    const out = composeVerifiedReply({ parts: twoParts, needs, sources: SOURCES, holds: new Map([["R9", "binding" as const]]) });
    expect(out.refs).toEqual(["R1", "R2"]);
  });
});

/** Cevap çağrısı ile parça okuyucusu çağrısını ayıran sahte ağ (okuyucu şeması `part_reader`). */
function routedFetch(reply: Record<string, unknown>, reader: (body: string) => Response) {
  const f = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    if (body.includes('"part_reader"')) return reader(body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const readerSays = (parts: Record<string, unknown>[]) => () =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts }) } }] }), { status: 200 });

describe("suggestReply — parça okuyucusu (AI_SENIOR_READER_ENABLED, parça kipinde)", () => {
  const answers = [
    { ref: "R1", status: "answered", text: "Çıkış saati 11:00.", evidence: "Check-out saati: 11:00" },
    { ref: "R2", status: "answered", text: "Havuz her gün 20:00'de kapanıyor.", evidence: "Havuz her gün 20:00'de, sauna 22:00'de kapanır." },
    { ref: "R3", status: "no_info", text: "", evidence: "" },
  ];
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 Opus 10-23 G1: okuyucu KAPALIYKEN çağrılmaz ve parça kipi BÜTÜN parçaları tutar (Soru 9 ve 'sorulanı cevaplıyor mu' yalnız okuyucuda)", async () => {
    const f = routedFetch({ ...MODEL, answers }, readerSays([]));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe("");
    expect(r.answeredRequests).toEqual({ ok: true, refs: [] });
    expect(r.answerParts?.filter((v) => v.status === "rejected").map((v) => v.status === "rejected" && v.issues)).toEqual([["reader_unread"], ["reader_unread"]]);
  });

  it("🚨 okuyucu açık: yalnız KODUN doğruladığı parçaları okur (no_info parça okuyucuya gitmez); 'no' dediği parça düşer", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    let seen = "";
    const f = routedFetch({ ...MODEL, answers }, (body) => {
      seen = body;
      return readerSays([
        { ref: "R1", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, quote: "" },
        { ref: "R2", answers_request: "no", supported_by_notes: true, binding_ok: true, exception_without_rule: false, quote: "Havuz her gün 20:00'de kapanıyor." },
      ])();
    });
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(f).toHaveBeenCalledTimes(2);
    expect(seen).toContain("R1 · TOPIC");
    expect(seen).toContain("R2 · TOPIC");
    expect(seen).not.toContain("R3 · TOPIC");
    // Okuyucu parçanın dayandığı kalemi ve aynı konuyu anan öteki kalemleri görür (havuz kalemi); konuyu anmayan Wi-Fi kalemi R2'nin notlarında yok.
    const r2 = seen.slice(seen.indexOf("R2 · TOPIC"));
    expect(r2).toContain("Havuz her gün 20:00");
    expect(r2).not.toContain("Lale2025");
    expect(r.reply).toBe("Çıkış saati 11:00.");
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1"] });
    expect(r.answerParts?.[1]).toEqual({ ref: "R2", status: "rejected", issues: ["reader_not_answered"] });
    expect(r.verifiedParts?.map((v) => v.ref)).toEqual(["R1"]);
  });

  it("🚨 okuyucu düşerse (HTTP hatası) BÜTÜN parçalar tutulur — belirsizlikte tut", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    routedFetch({ ...MODEL, answers }, () => new Response("boom", { status: 500 }));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answeredRequests).toEqual({ ok: true, refs: [] });
    expect(r.answerParts?.filter((v) => v.status === "rejected").map((v) => v.status === "rejected" && v.issues)).toEqual([["reader_unread"], ["reader_unread"]]);
  });

  it("🚨 okuyucu dayanılan kalemin yanında AYNI KONUYU anan öteki kalemi de görür (istisna / genel kural başka kalemde olabilir — Opus 10-23 F10)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    // Değersiz kural kalemi (saat taşısa kod parçayı "değişke düştü" diye tutar, okuyucuya hiç gitmez).
    const kb = [...KB, { category: "rules", title: "Havuz kuralları", content: "Havuzda cam şişe kullanılmaz." }];
    let seen = "";
    routedFetch({ ...MODEL, answers }, (body) => {
      seen = body;
      return readerSays([])();
    });
    await suggestReply({ ...input, knowledgeBase: kb, conversationItems: ITEMS });
    const r2 = seen.slice(seen.indexOf("R2 · TOPIC"));
    expect(r2).toContain("Havuz her gün 20:00");
    expect(r2).toContain("Havuzda cam şişe kullanılmaz");
  });

  it("🚨 Codex S2: okuyucu isteği misafirin KENDİ sözleriyle görür (genişletilmiş arama sorgusu değil) + önceki konuşma iki taraflı", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const items: ReplyItemsInput = {
      ...ITEMS,
      answerable: ITEMS.answerable.map((a) =>
        a.ref === "R2" ? { ...a, need: { ...a.need!, queries: ["havuz çalışma saatleri kapanış saati", "Havuz kaçta kapanıyor?"] } } : a,
      ),
    };
    let seen = "";
    routedFetch({ ...MODEL, answers }, (body) => {
      seen = body;
      return readerSays([])();
    });
    await suggestReply({
      ...input,
      history: [
        { direction: "inbound", body: "Sitede havuz var mı?" },
        { direction: "outbound", body: "Evet, bahçe katında havuz var." },
      ],
      conversationItems: items,
    });
    const r2 = seen.slice(seen.indexOf("R2 · TOPIC"));
    expect(r2).toContain("REQUEST (guest's words): <<<Havuz kaçta kapanıyor?>>>");
    expect(r2).not.toContain("havuz çalışma saatleri kapanış saati");
    expect(seen).toContain("GUEST: <<<Sitede havuz var mı?>>>");
    // Bugün satırı her zaman (rezervasyonsuz konuşmada konaklama günü yazılmaz).
    expect(seen).toContain("DATES: Today (property time zone)");
    expect(seen).toContain("HOST: <<<Evet, bahçe katında havuz var.>>>");
  });

  it("🚨 #199: alıntı iki kalemden geliyorsa okuyucu İKİSİNİ de not olarak görür (ikincisi konu sözcüğünü anmasa da)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const kb = [
      { category: "amenities", title: "Havuz", content: "Havuz hafta içi 09:00–20:00 arası açıktır." },
      { category: "amenities", title: "Hafta sonu", content: "Cumartesi ve pazar 09:00–23:00 arası açıktır." },
    ];
    const two = [
      {
        ref: "R2",
        status: "answered",
        text: "Havuz hafta içi 20:00'de, cumartesi ve pazar 23:00'te kapanıyor.",
        evidence: "Havuz hafta içi 09:00–20:00 arası açıktır. Cumartesi ve pazar 09:00–23:00 arası açıktır.",
      },
    ];
    let seen = "";
    routedFetch({ ...MODEL, answers: two }, (body) => {
      seen = body;
      return readerAllYes(body);
    });
    const r = await suggestReply({ ...input, knowledgeBase: kb, conversationItems: { ...ITEMS, answerable: ITEMS.answerable.filter((a) => a.ref === "R2") } });
    const r2 = seen.slice(seen.indexOf("R2 · TOPIC"));
    expect(r2).toContain("Havuz hafta içi 09:00–20:00 arası açıktır.");
    expect(r2).toContain("Cumartesi ve pazar 09:00–23:00 arası açıktır.");
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R2"] });
  });

  it("🚨 Codex 10-23: okuyucu 'only_known_case' derse parça GİDER ama ihtiyaç kapanmaz (ev sahibinde açık); öteki parça kapanır", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    routedFetch(
      { ...MODEL, answers },
      readerSays([
        { ref: "R1", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, only_known_case: false, quote: "" },
        { ref: "R2", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, only_known_case: true, quote: "" },
      ]),
    );
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("Çıkış saati 11:00.\nHavuz her gün 20:00'de kapanıyor.");
    expect(r.answeredRequests).toEqual({ ok: true, refs: ["R1"] });
    expect(r.answerParts?.find((v) => v.ref === "R2")).toMatchObject({ status: "verified", openAfterSend: true });
    // Okuyucu tutarsa "açık kalsın" işareti anlamsız: parça gitmez (tutma önce gelir).
    routedFetch(
      { ...MODEL, answers },
      readerSays([
        { ref: "R1", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, only_known_case: false, quote: "" },
        { ref: "R2", answers_request: "partly", supported_by_notes: true, binding_ok: true, exception_without_rule: false, only_known_case: true, quote: "Havuz" },
      ]),
    );
    const held = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(held.reply).toBe("Çıkış saati 11:00.");
    expect(held.answerParts?.find((v) => v.ref === "R2")).toMatchObject({ status: "rejected", issues: ["reader_partial"] });
  });

  it("doğrulanmış parça yoksa okuyucu çağrılmaz", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const none = answers.map((a) => ({ ...a, status: "no_info", text: "", evidence: "" }));
    const f = routedFetch({ ...MODEL, answers: none }, readerSays([]));
    await suggestReply({ ...input, conversationItems: ITEMS });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("Opus 10-23 G3 — tekrar anahtarı ve son metin denetimi AYNI karşılaştırma biçimi", () => {
  it("🚨 Türkçe noktalı / noktasız i ve dilsiz büyütme farkı parçayı son metinde 'kayıp' göstermez", () => {
    const key = partTextKey("Merhaba, internet 100 Mbps.");
    for (const finalText of ["Merhaba, internet 100 Mbps.", "Merhaba Alex,\n\nİnternet 100 Mbps.", "Hi!\nInternet 100 Mbps."]) {
      expect(foldPartText(finalText).includes(key), finalText).toBe(true);
    }
  });

  it("sondaki noktalama farkı tek metin sayılır (tekrar eden parça bir kez gider ve son metinde bulunur)", () => {
    expect(partTextKey("Havuz 22:00'de kapanır!")).toBe(partTextKey("Havuz 22:00'de kapanır."));
    expect(foldPartText("Havuz 22:00'de kapanır.").includes(partTextKey("Havuz 22:00'de kapanır!"))).toBe(true);
  });

  it("ayraç sökülmez: '1.500 TL' ile '1,500 TL' farklı kalır", () => {
    expect(partTextKey("Ücret 1.500 TL.")).not.toBe(partTextKey("Ücret 1,500 TL."));
  });
});
