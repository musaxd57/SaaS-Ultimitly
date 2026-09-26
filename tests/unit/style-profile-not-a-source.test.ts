import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// F13 KALINTISI (09-26): üslup rehberi bilgi kaynağı DEĞİLDİR — sistem istemi ve kaynak doğrulaması da öyle demeli.
//
// F13 (4832ab5) kullanıcı istemindeki rehber bloğunu "YALNIZ ÜSLUP … BİLGİ KAYNAĞI DEĞİLDİR" yaptı ama SİSTEM istemi
// hâlâ şunu söylüyordu:
//   · KURAL-1: bilgi kaynağı (3) = ev sahibinin geçmiş cevapları "konuşma geçmişi veya sana verilen 'EV SAHİBİ
//     REHBERİ' içinde";
//   · usedSources: "EV SAHİBİ REHBERİ'nden (Kural-1 kaynak 3) alınan olgular da 'history' olarak etiketlenir".
// İki istem çelişiyordu (sistem istemi genelde ağır basar). Kaynak doğrulaması da (`verifyUsedSources`) sohbet geçmişi
// BOŞKEN rehber varsa "history" beyanını doğrulanmış sayıyordu → rehberden alınmış bir "olgu" arayüzde kanıtlı görünürdü.
// ---------------------------------------------------------------------------

function kural1(): string {
  const start = REPLY_SYSTEM_PROMPT.indexOf("KURAL-1 [");
  const end = REPLY_SYSTEM_PROMPT.indexOf("KURAL-2 [");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return REPLY_SYSTEM_PROMPT.slice(start, end);
}

describe("sistem istemi: rehber bilgi kaynağı değil", () => {
  it("🚨 KURAL-1'in bilgi kaynakları arasında EV SAHİBİ REHBERİ YOK; geçmiş cevap kaynağı bu sohbetin geçmişi", () => {
    const k = kural1();
    expect(k).not.toMatch(/REHBER/);
    // (3) satırı: kaynak YALNIZ bu sohbetin geçmişi (satır sonuna kadar; rehber ya da başka yer sayılmaz).
    expect(k).toMatch(/\(3\)[^\n]*BU SOHBETTE[^\n]*\(konuşma geçmişi\)\.\n/);
  });

  it("🚨 usedSources talimatı rehberden alınan olguyu 'history' diye etiketletmez", () => {
    const start = REPLY_SYSTEM_PROMPT.indexOf("usedSources: Cevabındaki");
    expect(start).toBeGreaterThan(-1);
    const block = REPLY_SYSTEM_PROMPT.slice(start, REPLY_SYSTEM_PROMPT.indexOf("missingInfo:", start));
    expect(block).toContain('"history"');
    expect(block).not.toMatch(/REHBER/);
  });
});

function openAiReturns(content: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), {
          status: 200,
        }),
    ),
  );
}

const OUTPUT = {
  intent: "parking",
  confidence: 0.9,
  reply: "Bina önünde park yeri var.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  missingInfo: [],
  statedCheckoutTime: null,
  usedSources: ["history"],
};

function input(over: Partial<SuggestReplyInput>): SuggestReplyInput {
  return {
    guestMessage: "Otopark var mı?",
    property: { name: "Lale Suites", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [],
    reservation: null,
    history: [],
    tone: "warm",
    language: "tr",
    ...over,
  } as SuggestReplyInput;
}

describe("kullanıcı istemi: rehber bloğu KURAL-1 ile aynı üç kaynağı sayar", () => {
  it("bilgi kaynakları arasında bu sohbetin geçmişi de var (rehber bloğu onu dışlamıyor)", () => {
    const p = buildReplyUserPrompt(input({ styleProfile: "- Kısa yazar" }));
    expect(p).toMatch(/KURAL-1'in üç\s+kaynağından/);
    expect(p).toMatch(/bu sohbetin geçmişi\)/);
  });
});

describe("kaynak doğrulaması: 'history' yalnız gerçek sohbet geçmişi varken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 geçmiş BOŞ + rehber var → 'history' beyanı DOĞRULANMAZ (rehber dayanak değil)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    openAiReturns(OUTPUT);
    const r = await suggestReply(input({ styleProfile: "- Kısa ve samimi yazar" }));
    expect(r.source).toBe("openai");
    expect(r.usedSources).toEqual([]);
    expect(r.sourceAudit).toEqual({ declared: 1, verified: 0 });
  });

  it("gerçek sohbet geçmişi varken 'history' doğrulanır (kural yalnız rehberi keser)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    openAiReturns(OUTPUT);
    const r = await suggestReply(
      input({
        history: [
          { direction: "inbound", body: "Otopark var mı?" },
          { direction: "outbound", body: "Bina önünde park yeri var." },
        ],
      }),
    );
    expect(r.usedSources).toEqual(["history"]);
    expect(r.sourceAudit).toEqual({ declared: 1, verified: 1 });
  });
});
