import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { suggestReply } from "@/lib/ai";
import { buildReplyPrompt, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { applyPromptKbAudit } from "@/lib/ai/grounding";
import { KB_CHAR_BUDGET } from "@/lib/ai/limits";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// §C — İSTEMİN KENDİ KARAKTER BÜTÇESİ DE SAYILIR (denetim turu 09-12).
//
// 🚨 ÖLÇÜLEN KUSUR: `packKnowledgeBase` `{text, omitted}` döndürüyordu ama
// `buildReplyUserPrompt` yalnız `.text` alıp `omitted`ı ATIYORDU. Yani istem
// modele "12 kalem bu yanıta alınamadı" diye AÇIKÇA yazarken, aynı olayın
// karar kaydı (`RiskEvent.kbDropped`) "0 düştü" diyordu — iki kayıt aynı olay
// hakkında birbiriyle çelişiyordu.
//
// ⚠️ MİSAFİR ZARAR GÖRMÜYORDU (model uyarılıyor, "bilgi yok" demiyor); bozuk
// olan DENETİM KAYDIYDI. Ama A2 sözleşmesi gereği ölçülmüş-ama-YANLIŞ bir sayı
// NULL'dan kötüdür.
//
// 🚨 ÇİFT SAYIM TUZAĞI: `packKnowledgeBase` kendisine verilen `alreadyDropped`
// sayısını KENDİ düşüşüne EKLEYEREK döndürür. Yüzeyin sayısını bu değere
// EKLEMEK iki kez saymak olurdu → DEĞİŞTİRMEK gerekir (test-pinli).
// ---------------------------------------------------------------------------

const kbItem = (i: number, chars: number) => ({
  id: `k${i}`,
  category: "general",
  title: `Konu ${i}`,
  content: "x".repeat(chars),
  updatedAt: new Date("2026-09-12T00:00:00Z"),
});

function input(over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage: "Havlular nerede?",
    property: { name: "Lale 4", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [],
    reservation: null,
    history: [],
    tone: "warm",
    language: "tr",
    ...over,
  };
}

describe("§C — buildReplyPrompt kb muhasebesini DIŞA VERİR", () => {
  it("🚨 pack karakter bütçesi kestiğinde `kbOmitted` > 0", () => {
    // 30 kalem × 1.500 karakter = 45.000 > KB_CHAR_BUDGET (24.000) → kesme ŞART.
    const knowledgeBase = Array.from({ length: 30 }, (_, i) => kbItem(i, 1_500));
    const out = buildReplyPrompt(input({ knowledgeBase }));
    expect(out.kbOmitted).toBeGreaterThan(0);
    // Anti-vakumluk: bütçe gerçekten aşılıyordu.
    expect(knowledgeBase.reduce((s, k) => s + k.content.length, 0)).toBeGreaterThan(KB_CHAR_BUDGET);
    // Ve istem metni de AYNI sayıyı söylüyor (iki kayıt çelişmiyor).
    expect(out.text).toContain(`${out.kbOmitted} kalem`);
  });

  it("🚨 ÖN DÜŞÜŞLER DE İÇERİDE — toplam, ekleme DEĞİL", () => {
    // Yüzey "7 kalem zaten düştü" diyor; pack bunu KENDİ düşüşüne EKLER.
    const knowledgeBase = Array.from({ length: 30 }, (_, i) => kbItem(i, 1_500));
    const withPre = buildReplyPrompt(input({ knowledgeBase, knowledgeBaseDropped: 7 }));
    const without = buildReplyPrompt(input({ knowledgeBase }));
    expect(withPre.kbOmitted).toBe(without.kbOmitted + 7);
  });

  it("bütçe altındaysa yalnız ÖN düşüşü taşır (pack hiçbir şey kesmez)", () => {
    const knowledgeBase = Array.from({ length: 3 }, (_, i) => kbItem(i, 100));
    expect(buildReplyPrompt(input({ knowledgeBase })).kbOmitted).toBe(0);
    expect(buildReplyPrompt(input({ knowledgeBase, knowledgeBaseDropped: 4 })).kbOmitted).toBe(4);
  });

  it("🚨 TEK KAYNAK: `buildReplyUserPrompt` aynı metni verir (ayrışamaz)", () => {
    const knowledgeBase = Array.from({ length: 30 }, (_, i) => kbItem(i, 1_500));
    const i = input({ knowledgeBase, knowledgeBaseDropped: 2 });
    expect(buildReplyUserPrompt(i)).toBe(buildReplyPrompt(i).text);
  });
});

describe("🚨 §C BAĞLANTI PİNİ — suggestReply sayıyı GERÇEKTEN taşır", () => {
  // ⚠️ MUTASYON TURU BU BOŞLUĞU ÖLÇTÜ (M12): `ai/index.ts`ten
  // `kbOmittedInPrompt: prompt.kbOmitted` satırını SİLEN mutant, yukarıdaki saf
  // testlerin hepsi yeşilken HAYATTA KALDI — çünkü hiçbiri `suggestReply`'ı
  // uçtan uca koşturmuyordu. Bu, reponun kendi belgelediği sınıf: YÜKLEM vardı,
  // ARGÜMAN yoktu (QR `history_injection` turunun aynısı).
  const stubModel = (payload: Record<string, unknown>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] }),
            { status: 200 },
          ),
      ),
    );
  const MODEL_OUT = {
    intent: "general",
    confidence: 0.9,
    reply: "Örnek cevap.",
    risk: null,
    priority: "standard",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    missingInfo: [],
  };

  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("pack kestiğinde sonuç alanı DOLU ve istemle AYNI sayıyı taşır", async () => {
    stubModel(MODEL_OUT);
    const knowledgeBase = Array.from({ length: 30 }, (_, i) => kbItem(i, 1_500));
    const i = input({ knowledgeBase, knowledgeBaseDropped: 3 });
    const out = await suggestReply(i);
    expect(out.source).toBe("openai");
    expect(out.kbOmittedInPrompt).toBe(buildReplyPrompt(i).kbOmitted);
    // Anti-vakumluk: gerçekten sıfırdan farklı bir şey ölçüyoruz.
    expect(out.kbOmittedInPrompt).toBeGreaterThan(3);
  });

  it("🚨 MODEL ÇAĞRILMADIYSA alan YOK — uydurma 0 yazılmaz (A2)", async () => {
    // Anahtar yok → fallback yolu; istem hiç kurulmaz.
    vi.stubEnv("OPENAI_API_KEY", "");
    const out = await suggestReply(input({ knowledgeBase: [kbItem(0, 50)] }));
    expect(out.source).toBe("fallback");
    expect(out.kbOmittedInPrompt).toBeUndefined();
  });
});

describe("§C — applyPromptKbAudit: sayaçları GERÇEĞE çeker", () => {
  const base = { kbRetrieved: 30, kbDropped: 7 };

  it("🚨 kbDropped DEĞİŞTİRİLİR (eklenmez) ve kbRetrieved pack düşüşü kadar azalır", () => {
    // İstemin toplam düşüşü 19 → pack'in KENDİ payı 19 − 7 = 12.
    const out = applyPromptKbAudit(base, 19, 30);
    expect(out.kbDropped).toBe(19);
    expect(out.kbRetrieved).toBe(30 - 12);
  });

  it("pack hiçbir şey kesmediyse sayaçlar AYNEN kalır", () => {
    expect(applyPromptKbAudit(base, 7, 30)).toEqual({ kbRetrieved: 30, kbDropped: 7 });
  });

  it("🚨 ÖLÇÜLMEDİYSE DOKUNMAZ — A2: undefined ≠ 0", () => {
    // Model çağrılmadıysa (fallback yolu) istem hiç kurulmaz; uydurma bir
    // sayı yazmak "ölçtük" demek olurdu.
    expect(applyPromptKbAudit(base, undefined, 30)).toEqual(base);
  });

  it("kodun bildiği taraf ölçülmemişse de DOKUNMAZ", () => {
    expect(applyPromptKbAudit({ kbRetrieved: null, kbDropped: null }, 19, 30)).toEqual({
      kbRetrieved: null,
      kbDropped: null,
    });
  });

  it("negatife düşmez (tutarsız girdi sahte sayı üretmez)", () => {
    const out = applyPromptKbAudit({ kbRetrieved: 2, kbDropped: 1 }, 99, 2);
    expect(out.kbRetrieved).toBe(0);
    expect(out.kbDropped).toBe(99);
  });

  it("başka alanlar KORUNUR (nesne kopyalanır, kırpılmaz)", () => {
    const rich = { kbRetrieved: 30, kbDropped: 7, kbPendingApproval: 3, srcDeclared: 2 };
    expect(applyPromptKbAudit(rich, 19, 30)).toMatchObject({ kbPendingApproval: 3, srcDeclared: 2 });
  });
});
