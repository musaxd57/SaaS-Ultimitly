import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// "VAR / YOK" (OLUMLULUK) KARARI — kod yalnız DAR ve KESİN durumda tutar, gerisi okuyucuda (kurucu 11-26: "model koddan belirgin biçimde daha
// iyi … ama herşeyi modele bırakmamalıyız"; ölçüm `docs/olcum/olumluluk-ve-model-gucu-2026-11-26.md` aday A2; tasarım
// `docs/TASARIM-2026-11-26-okuyucu-maskesiz-iki-soru-olumluluk.md`).
//  · Okuyucu OKURKEN: değersiz parçanın üç olumluluk dalı yalnız iki taraf da yan cümle düzeyinde tek yönlü ve yönler tersken tutar.
//  · Okuyucu OKUMADIYSA (düştü / zaman aşımı / cevabında yok / tavan → `unread`) ya da kapalıysa: kodun eski hükmü BİREBİR.
//  · Ücret kutbu ve değer başına olumluluk değişmez.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { composeVerifiedReply, type AnswerPart } from "@/lib/ai/answer-parts";
import { checkAnswerBinding, polarityReversalCertain } from "@/lib/ai/answer-binding";
import { suggestReply } from "@/lib/ai";
import { kbLine } from "@/lib/ai/retrieval/kb-line";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import type { ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { loadTable, needOf, outcomeOf, productVerdict, readerMissingVerdict, sourcesOf } from "../eval/polarity-table-core";

const p = (ref: string, text: string, evidence: string): AnswerPart => ({ ref, status: "answered", text, evidence });

// İki yönlü kalem (ölçümün ana mekanizması: 2288 "bütün kalem" okuması) — tablonun GERÇEK satırı (g3 koşusundaki haksız ret, birebir).
const TABLE = loadTable();
const rowOf = (id: string) => TABLE.rows.find((r) => r.id === id)!;
const NT6 = rowOf("a-g3-nt6-R2");
const PARKING = sourcesOf(TABLE, NT6.kbSet);
const parkingNeed = needOf(NT6);
const RIGHT = p("R1", NT6.part, NT6.evidence);
const PARKING_ITEM = PARKING.find((s) => s.text.includes("sokak parkı"))!;

describe("polarityReversalCertain — kodun kesin olduğu dar durum (saf)", () => {
  it("iki taraf da yan cümle düzeyinde tek yönlü ve yönler ters → kesin", () => {
    expect(polarityReversalCertain("Evet, evcil hayvan kabul edilir.", kbLine({ category: "rules", title: "Evcil hayvan", content: "Evcil hayvan kabul edilmez." }))).toBe(true);
    expect(polarityReversalCertain("Smoking is allowed.", "- [RULES] Sigara: Sigara içmek yasaktır.")).toBe(true);
  });

  it("kalem iki yönlüyse, parça iki yönlüyse ya da yönler aynıysa → kesin DEĞİL (karar okuyucuya)", () => {
    expect(polarityReversalCertain("Street parking is not available.", PARKING_ITEM.text)).toBe(false);
    expect(polarityReversalCertain("Smoking is not allowed inside, but it is allowed on the balcony.", "- [RULES] Sigara: Sigara içmek yasaktır.")).toBe(false);
    expect(polarityReversalCertain("Evcil hayvan kabul edilmez.", "- [RULES] Evcil hayvan: Evcil hayvan kabul edilmez.")).toBe(false);
    // Kalem başlığı olumluluk okumasına girmez ("Sigara yok" başlığı içeriği iki yönlü yapmaz).
    expect(polarityReversalCertain("Smoking is allowed.", "- [RULES] Sigara yok: Sigara içmek yasaktır.")).toBe(true);
  });
});

describe("checkAnswerBinding — olumluluk bulgusunun kaynağı işaretlenir", () => {
  it("değersiz parçanın dalı → polarityFromValueless; ücret kutbu → işaret YOK (her zaman tutar)", () => {
    const valueless = checkAnswerBinding({ part: RIGHT.text, evidence: RIGHT.evidence, sourceText: PARKING_ITEM.text, needTerms: parkingNeed.terms, needTopics: parkingNeed.topics });
    expect(valueless.issues).toContain("polarity_mismatch");
    expect(valueless.polarityFromValueless).toBe(true);
    const src = kbLine({ category: "amenities", title: "Havuz", content: "Havuz kullanımı misafirler için ücretsizdir." });
    const fee = checkAnswerBinding({ part: "Havuz kullanımı ücretlidir.", evidence: "Havuz kullanımı misafirler için ücretsizdir.", sourceText: src, needTerms: needTerms(["havuz ücretli mi"]), needTopics: [] });
    expect(fee.issues).toContain("polarity_mismatch");
    expect(fee).not.toHaveProperty("polarityFromValueless");
  });
});

describe("composeVerifiedReply — okuyucu kipinde dar olumluluk", () => {
  it("🚨 iki yönlü kalemde DOĞRU iki yönlü cevap: okuyucu okuyacaksa kod tutmaz (bulgu izde), karar okuyucuda", () => {
    const v = composeVerifiedReply({ parts: [RIGHT], needs: [parkingNeed], sources: PARKING, meaningJudge: "reader" }).verdicts[0];
    expect(v).toMatchObject({ status: "verified", source: PARKING_ITEM.id });
    expect(v.status === "verified" && v.advisory).toContain("polarity_mismatch");
  });

  it("🚨 okuyucu OKUMADIYSA (unread) kodun eski hükmü aynen: polarity_mismatch ile tutulur", () => {
    const v = composeVerifiedReply({ parts: [RIGHT], needs: [parkingNeed], sources: PARKING, meaningJudge: "reader", holds: new Map([["R1", "unread" as const]]) }).verdicts[0];
    expect(v).toMatchObject({ status: "rejected", issues: ["polarity_mismatch"] });
  });

  it("okuyucu başka sebeple tuttuysa okuyucunun sebebi; okuyucu kipi kapalıyken (kod kipi) eski hüküm", () => {
    const held = composeVerifiedReply({ parts: [RIGHT], needs: [parkingNeed], sources: PARKING, meaningJudge: "reader", holds: new Map([["R1", "unsupported" as const]]) }).verdicts[0];
    expect(held).toMatchObject({ status: "rejected", issues: ["reader_unsupported"] });
    const code = composeVerifiedReply({ parts: [RIGHT], needs: [parkingNeed], sources: PARKING }).verdicts[0];
    expect(code).toMatchObject({ status: "rejected", issues: expect.arrayContaining(["polarity_mismatch"]) });
  });

  it("🚨 kodun KESİN olduğu ters cevap okuyucu 'evet' dese de tutulur (iki katman, biri yeter)", () => {
    const pets = [{ id: "kb:1", text: kbLine({ category: "rules", title: "Evcil hayvan", content: "Evcil hayvan kabul edilmez." }) }];
    const v = composeVerifiedReply({
      parts: [p("R1", "Evet, evcil hayvan kabul edilir.", "Evcil hayvan kabul edilmez.")],
      needs: [{ ref: "R1", terms: needTerms(["evcil hayvan kabul ediliyor mu"]), topics: [] }],
      sources: pets,
      meaningJudge: "reader",
    }).verdicts[0];
    expect(v).toMatchObject({ status: "rejected", issues: ["polarity_mismatch"] });
  });
});

// ─── olumluluk tablosu (`evals/olumluluk-tablosu.json`, 99 satır) ─────────────────────────────────────────────────────────────────
describe("🚨 olumluluk tablosu — okuyucu yokken BİREBİR, okuyucu varken haksız tutma 0", () => {
  const table = TABLE;
  const count = (verdict: typeof productVerdict) => {
    const c = { dogru_tutma: 0, haksiz_tutma: 0, kacirma: 0, dogru_gecirme: 0 };
    for (const row of table.rows) c[outcomeOf(row, verdict(table, row))]++;
    return c;
  };

  it("okuyucu OKUMADIĞINDA kodun hükmü 26 Kasım öğleden önceki ölçümle satır satır aynı (40 · 28 · 6 · 25)", () => {
    expect(count(readerMissingVerdict)).toEqual({ dogru_tutma: 40, haksiz_tutma: 28, kacirma: 6, dogru_gecirme: 25 });
    // Satır satır: kayıtlı ölçüm (`docs/olcum/olumluluk-tablosu-2026-11-26.json`, ürün kodu değişmeden önce, commit 40ee05b1).
    const stored = JSON.parse(readFileSync(path.resolve(__dirname, "../../docs/olcum/olumluluk-tablosu-2026-11-26.json"), "utf8")) as {
      rows: { id: string; product: { held: boolean; issues: string[]; advisory: string[] } }[];
    };
    expect(stored.rows).toHaveLength(table.rows.length);
    for (const s of stored.rows) {
      const row = table.rows.find((r) => r.id === s.id)!;
      const v = readerMissingVerdict(table, row);
      expect([s.id, v.held, v.issues]).toEqual([s.id, s.product.held, s.product.issues]);
      if (s.product.held) expect([s.id, v.advisory]).toEqual([s.id, s.product.advisory]);
    }
  });

  it("okuyucu OKURKEN kodun haksız tutması 28 → 0; kodun hâlâ tek başına tuttuğu ters cevaplar (aday A2'nin 12'si + ücret kutbu)", () => {
    const c = count(productVerdict);
    expect(c.haksiz_tutma).toBe(0);
    expect(c.dogru_tutma + c.kacirma).toBe(46);
    expect(c.dogru_tutma).toBeGreaterThanOrEqual(12);
    expect(c).toEqual(PINNED_WITH_READER);
  });
});

/** Ücretsiz yeniden ölçümün (`tests/eval/polarity-table-replay.ts`, `urun_okuyucu_varken`) sayıları — bilinçli değişirse güncellenir. */
// 15 = aday A2'nin 12'si + ücret kutbunun 3'ü (ölçümün sarmalayıcısı ücret kutbunu da kaldırıyordu; ürün onu KODDA bırakır). 31 ters cevap okuyucuya.
const PINNED_WITH_READER = { dogru_tutma: 15, haksiz_tutma: 0, kacirma: 31, dogru_gecirme: 53 };

// ─── uçtan uca: suggestReply parça kipinde (okuyucu her parçayı okuyor mu, düşerse kod geri geliyor mu) ─────────────────────────
const KB = TABLE.kbSets[NT6.kbSet];
const ITEMS: ReplyItemsInput = {
  answerable: [{ ref: "R1", kind: "parking", hint: "park yeri", need: { terms: parkingNeed.terms, topics: parkingNeed.topics, queries: parkingNeed.queries } }],
  held: [],
  parts: true,
};
const input: SuggestReplyInput = {
  guestMessage: "Where can we park the car?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: KB,
  tone: "warm",
  language: "en",
  now: new Date("2026-09-25T10:00:00Z"),
};
const MODEL = {
  intent: "general",
  stayChangeAsked: "none",
  confidence: 0.92,
  reply: "x",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
  answeredRequests: ["R1"],
  answers: [{ ref: "R1", status: "answered", text: RIGHT.text, evidence: RIGHT.evidence }],
};
const yes = { ref: "R1", answers_request: "yes", supported_by_notes: true, binding_ok: true, exception_without_rule: false, in_guest_language: true, notes_conflict: false, only_known_case: false, quote: "" };
function route(reader: () => Response) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
      const body = String(init?.body ?? "");
      if (body.includes('"part_reader"')) {
        seen.push(body);
        return reader();
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(MODEL) } }] }), { status: 200 });
    }),
  );
  return seen;
}
const says = (row: Record<string, unknown>) => () =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts: [row] }) } }] }), { status: 200 });

describe("suggestReply — parça kipi + okuyucu, dar olumluluk", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 kodun artık tutmadığı parça okuyucuya GİDER; okuyucu 'evet' derse gönderilir", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const seen = route(says(yes));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("free street parking in front of the building");
    expect(r.reply).toBe(RIGHT.text);
    expect(r.answerParts?.[0]).toMatchObject({ status: "verified", advisory: expect.arrayContaining(["polarity_mismatch"]) });
  });

  it("okuyucu 'notlarla desteklenmiyor' derse tutulur (okuyucunun sebebiyle)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    route(says({ ...yes, supported_by_notes: false }));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answerParts?.[0]).toMatchObject({ status: "rejected", issues: ["reader_unsupported"] });
  });

  it("🚨 okuyucu DÜŞERSE (sunucu hatası) kodun eski hükmü geri gelir: polarity_mismatch ile tutulur", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    route(() => new Response("down", { status: 500 }));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answerParts?.[0]).toMatchObject({ status: "rejected", issues: ["polarity_mismatch"] });
  });

  it("🚨 okuyucu yeni alanları vermezse (eski şema) okunmadı sayılır → kodun eski hükmü", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const { in_guest_language: _l, notes_conflict: _c, ...old } = yes;
    route(says(old));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(r.reply).toBe("");
    expect(r.answerParts?.[0]).toMatchObject({ status: "rejected", issues: ["polarity_mismatch"] });
  });

  it("🚨 okuyucu anahtarı KAPALIYKEN davranış bugünküyle aynı: okuyucu çağrılmaz, parça kodda polarity_mismatch ile tutulur", async () => {
    const seen = route(says(yes));
    const r = await suggestReply({ ...input, conversationItems: ITEMS });
    expect(seen).toHaveLength(0);
    expect(r.reply).toBe("");
    expect(r.answerParts?.[0]).toMatchObject({ status: "rejected", issues: expect.arrayContaining(["polarity_mismatch"]) });
  });
});
