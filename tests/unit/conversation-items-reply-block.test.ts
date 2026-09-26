import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildItemsPromptBlock, parseAnsweredRequests, type ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import { ITEM_KIND_LABELS_TR, ITEM_KINDS } from "@/lib/conversation-items/core";
import { REPLY_SYSTEM_PROMPT, buildReplyPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — cevap modelinin bloğu + beyan (kurucu kararları 09-26). Blok YALNIZ öğe kipinde istemin GÖREV
// çerçevesine girer; verilmezse istem bayt bayt aynı ve `answeredRequests` sonuçta YOK. Beyan STRICT: eksik/bozuk ya da
// bırakılan/bilinmeyen kimlik → kapı tutar (karar kodda).
// ---------------------------------------------------------------------------

const ITEMS: ReplyItemsInput = {
  answerable: [{ ref: "R1", kind: "wifi", hint: "wifi şifresi" }],
  held: [{ kind: "payment_invoice" }, { kind: "payment_invoice" }, { kind: "complaint_issue" }],
};

describe("blok", () => {
  it("cevaplanacaklar kimlik + tür + ipucu; bırakılanlar TEKİL tür adı; kural satırı ve beyan tanımı", () => {
    const b = buildItemsPromptBlock(ITEMS);
    expect(b).toContain('  - R1 · Wi-Fi · "wifi şifresi"');
    expect(b.split("  - ödeme / fatura").length - 1).toBe(1);
    expect(b).toContain("  - şikâyet / sorun");
    expect(b).toContain('"answeredRequests"');
    expect(b).toContain("CEVAP VERME, DEĞİNME");
    // 🚨 Birleşim: modelin risk etiketi bırakılan istekleri de kapsar (kod ayırır) — "yalnız cevapladığın kısım" dersek
    // öğelerin kaçırdığı gizli bir riski model de raporlamaz (üçüncü dedektör körleşir).
    expect(b.replace(/\s+/g, " ")).toContain("intent, riskLevel ve riskType'ı her zamanki gibi TÜM cevapsız mesajlara göre ver");
  });

  it("boş listeler '(yok)'; ipucu temizlenir ve kısaltılır (tırnak/ayraç/kontrol karakteri isteme sızmaz)", () => {
    const b = buildItemsPromptBlock({ answerable: [{ ref: "R1", kind: "other", hint: `a"b<c>\u0000d ${"x".repeat(200)}` }], held: [] });
    expect(b).toContain("  (yok)");
    const line = b.split("\n").find((l) => l.startsWith("  - R1"))!;
    expect(line).not.toMatch(/[<>\u0000]/);
    expect(line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).length).toBeLessThanOrEqual(80);
    expect(buildItemsPromptBlock({ answerable: [], held: [{ kind: "wifi" }] })).toContain("CEVAPLANACAK istekler:\n  (yok)");
  });

  it("her türün Türkçe adı var (tek kaynak)", () => {
    for (const k of ITEM_KINDS) expect([k, typeof ITEM_KIND_LABELS_TR[k]]).toEqual([k, "string"]);
  });
});

describe("beyan — STRICT", () => {
  const refs = ["R1", "R2"];
  it("dizi değil / yok → missing", () => {
    expect(parseAnsweredRequests(undefined, refs)).toEqual({ ok: false, reason: "missing" });
    expect(parseAnsweredRequests("R1", refs)).toEqual({ ok: false, reason: "missing" });
    expect(parseAnsweredRequests(null, refs)).toEqual({ ok: false, reason: "missing" });
  });
  it("bilinmeyen ya da bırakılan kimlik → unknown_ref (tek geçersiz eleman bütün beyanı düşürür)", () => {
    expect(parseAnsweredRequests(["R1", "R9"], refs)).toEqual({ ok: false, reason: "unknown_ref" });
    expect(parseAnsweredRequests(["payment_invoice"], refs)).toEqual({ ok: false, reason: "unknown_ref" });
    expect(parseAnsweredRequests([1], refs)).toEqual({ ok: false, reason: "unknown_ref" });
  });
  it("geçerli: tekilleşir; boş dizi geçerli", () => {
    expect(parseAnsweredRequests(["R2", "R1", "R2"], refs)).toEqual({ ok: true, refs: ["R2", "R1"] });
    expect(parseAnsweredRequests([], refs)).toEqual({ ok: true, refs: [] });
  });
});

const input: SuggestReplyInput = {
  guestMessage: "IBAN? Wi-Fi?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ Lale-5G, şifre Lale2025." }],
  tone: "warm",
  language: "tr",
  now: new Date("2026-09-25T10:00:00Z"),
};

describe("istem — öğe kipi değilken bayt bayt aynı", () => {
  it("🚨 conversationItems verilmezse istem aynı ve alanı anmaz; sistem istemi hiç anmaz", () => {
    const base = buildReplyPrompt(input).text;
    expect(buildReplyPrompt({ ...input, conversationItems: undefined }).text).toBe(base);
    expect(base).not.toContain("answeredRequests");
    expect(REPLY_SYSTEM_PROMPT).not.toContain("answeredRequests");
  });
  it("verilirse blok TEK KEZ, GÖREV çerçevesinde; çıkarılınca istem birebir", () => {
    const block = buildItemsPromptBlock(ITEMS);
    const on = buildReplyPrompt({ ...input, conversationItems: ITEMS }).text;
    expect(on.split(block).length - 1).toBe(1);
    expect(on.indexOf(block)).toBeGreaterThan(on.lastIndexOf("GÖREV:"));
    expect(on.replace(block, "")).toBe(buildReplyPrompt(input).text);
  });
});

function openAiReturns(content: Record<string, unknown>) {
  const f = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}
const MODEL = {
  intent: "wifi",
  stayChangeAsked: "none",
  confidence: 0.92,
  reply: "Wi-Fi ağı Lale-5G, şifre Lale2025.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  usedSources: ["kb:wifi"],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
};

describe("suggestReply — beyan yalnız blok verildiyse", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 blok yok: model alanı gönderse de sonuçta YOK", async () => {
    openAiReturns({ ...MODEL, answeredRequests: ["R1"] });
    const r = await suggestReply(input);
    expect("answeredRequests" in r).toBe(false);
  });

  it("blok var: beyan STRICT çözülür; eksik → missing", async () => {
    openAiReturns({ ...MODEL, answeredRequests: ["R1"] });
    expect((await suggestReply({ ...input, conversationItems: ITEMS })).answeredRequests).toEqual({ ok: true, refs: ["R1"] });
    openAiReturns(MODEL);
    expect((await suggestReply({ ...input, conversationItems: ITEMS })).answeredRequests).toEqual({ ok: false, reason: "missing" });
  });
});
