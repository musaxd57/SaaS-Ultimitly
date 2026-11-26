import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// A2 — MODELİN KAYNAK BEYANI GERÇEK KAYNAKLARLA DOĞRULANIR (09-08).
//
// Burada `@/lib/ai` MOCK'LANMAZ: ölçülen şey parser'ın kendisi. Yalnız dış
// sınır (OpenAI HTTP'si) sahte.
//
// 🚨 `verifyUsedSources` uydurma atıfları ZATEN eliyordu — ama SESSİZCE. Kaç
// atıfın elendiği hiçbir yere yazılmadığı için "model olmayan bir kaynağa
// dayandığını söyledi" olayı canlıda GÖRÜNMÜYORDU. `sourceAudit` tam olarak o
// farkı taşır: `declared` (temizlenmiş beyan) ↔ `verified` (gerçek girdiye
// karşı doğrulanan).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

function openAiReturns(content: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }),
          { status: 200 },
        ),
    ),
  );
}

const BASE_OUTPUT = {
  intent: "parking",
  confidence: 0.9,
  reply: "Bina altı otopark ücretsizdir.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  missingInfo: [],
  statedCheckoutTime: null,
};

function input(over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage: "Otopark var mı?",
    property: { name: "Daire 1", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [{ category: "parking", title: "Otopark", content: "Bina altı otopark ücretsizdir." }],
    reservation: null,
    history: [],
    ...over,
  } as SuggestReplyInput;
}

describe("A2 — sourceAudit: beyan ↔ doğrulanan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("gerçek kaynağa atıf: declared == verified", async () => {
    openAiReturns({ ...BASE_OUTPUT, usedSources: ["kb:parking"] });
    const r = await suggestReply(input());
    expect(r.source).toBe("openai");
    expect(r.usedSources).toEqual(["kb:parking"]);
    expect(r.sourceAudit).toEqual({ declared: 1, verified: 1 });
  });

  it("UYDURMA ATIF: olmayan kategoriye atıf → declared 1, verified 0", async () => {
    // Girdide yalnız "parking" var; model "wifi" diyor.
    openAiReturns({ ...BASE_OUTPUT, usedSources: ["kb:wifi"] });
    const r = await suggestReply(input());
    expect(r.usedSources).toEqual([]); // eskiden beri eleniyordu
    expect(r.sourceAudit).toEqual({ declared: 1, verified: 0 }); // artık GÖRÜNÜYOR
  });

  it("karışık beyan: yalnız gerçek olanlar doğrulanır, fark korunur", async () => {
    openAiReturns({
      ...BASE_OUTPUT,
      usedSources: ["kb:parking", "property:door_code", "reservation:door_code"],
    });
    const r = await suggestReply(input());
    expect(r.usedSources).toEqual(["kb:parking"]);
    expect(r.sourceAudit).toEqual({ declared: 3, verified: 1 });
  });

  it("hiç beyan yoksa ikisi de 0 — 'ölçmedik' DEĞİL, 'beyan etmedi'", async () => {
    openAiReturns({ ...BASE_OUTPUT, usedSources: [] });
    const r = await suggestReply(input());
    expect(r.sourceAudit).toEqual({ declared: 0, verified: 0 });
  });

  it("beyan alanı hiç yoksa (şemasız cevap) yine 0/0 — sessizce kaybolmaz", async () => {
    const { ...noSources } = BASE_OUTPUT;
    openAiReturns(noSources);
    const r = await suggestReply(input());
    expect(r.sourceAudit).toEqual({ declared: 0, verified: 0 });
  });

  it("FALLBACK yolunda da yazılır (deterministik üretim → declared == verified)", async () => {
    // Model yok → fallback. Kaynaklar gerçek veriden üretilir, uydurma olamaz.
    vi.stubEnv("OPENAI_API_KEY", "");
    const r = await suggestReply(input({ guestMessage: "Çıkış saati kaçta?" }));
    expect(r.source).toBe("fallback");
    expect(r.sourceAudit).toBeDefined();
    expect(r.sourceAudit?.declared).toBe(r.sourceAudit?.verified);
    expect(r.sourceAudit?.verified).toBe(r.usedSources.length);
  });
});
