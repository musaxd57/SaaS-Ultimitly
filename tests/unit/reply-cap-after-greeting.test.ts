import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { suggestReply, replyOverAutosendCap } from "@/lib/ai";
import { reportError } from "@/lib/report-error";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// QR / KAPI Q1 (Codex 11-10) — GÖNDERİM TAVANI SON METNE BAKAR. Tavan (2.000) modelin ham metnine uygulanıyor, kodun selamı ("Merhaba
// Ayşe,") SONRADAN ekleniyordu: 1.990 karakterlik cevap selamla tavanı aşıyor, yine de "kesilmedi" sayılıp kendiliğinden gidebiliyordu.
// QR kaydı o metni 2.000'de kesiyordu — sonu kesik cümlede olumsuzluk ("güvenli değil|dir") kaybolabiliyordu. Bütün biçimlendirmeden
// sonra tavanı aşan metin artık kesilmiş metinle aynı hükmü alır: güven ≤ 0,5 → taslak olarak ev sahibine kalır, misafire gitmez.
// ---------------------------------------------------------------------------

const CAP = 2000;
/** Tam `n` karakterlik, sonu olumsuz cümleyle biten cevap (kesilirse anlamı değişen metin). */
function replyOfLength(n: number): string {
  const tail = " Balkon korkuluğuna yaslanmak güvenli değildir.";
  const unit = "Klima kumandası komodinin üst çekmecesindedir. ";
  let body = "";
  while (body.length + unit.length + tail.length <= n) body += unit;
  body = body.trimEnd();
  const pad = n - body.length - tail.length;
  return `${body}${" ".repeat(0)}${tail}${"!".repeat(Math.max(0, pad))}`.padEnd(n, "!");
}

function openAiReturns(reply: string, confidence = 0.92) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    intent: "general",
                    confidence,
                    reply,
                    risk: null,
                    priority: "standard",
                    actionSuggestion: null,
                    riskLevel: "none",
                    detectedLanguage: "tr",
                    riskType: null,
                    missingInfo: [],
                    statedCheckoutTime: null,
                    usedSources: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ),
  );
}

function input(over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage: "Klima kumandası nerede?",
    property: { name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [{ category: "faq", title: "Klima", content: "Klima kumandası komodinin üst çekmecesindedir." }],
    reservation: { guestName: "Ayşe Yılmaz", guestGivenName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
    history: [],
    tone: "warm",
    language: "tr",
    ...over,
  } as SuggestReplyInput;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(reportError).mockClear();
});

describe("gönderim tavanı selam eklendikten SONRAKİ metne uygulanır (Q1)", () => {
  it("saf kural: tam tavan geçer, bir fazlası geçmez", () => {
    expect(replyOverAutosendCap("a".repeat(CAP))).toBe(false);
    expect(replyOverAutosendCap("a".repeat(CAP + 1))).toBe(true);
    expect(replyOverAutosendCap("")).toBe(false);
  });

  it("🚨 ham metin tavanın ALTINDA (1.995) ama kodun selamıyla ÜSTÜNE çıkıyorsa cevap kendiliğinden gitmez: güven ≤ 0,5; metin KESİLMEZ", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const raw = replyOfLength(1995);
    expect(raw.length).toBe(1995);
    openAiReturns(raw);
    const r = await suggestReply(input());
    expect(r.source).toBe("openai");
    expect(r.reply.startsWith("Merhaba")).toBe(true); // selam eklendi
    expect(r.reply.length).toBeGreaterThan(CAP);
    expect(r.reply).toContain("güvenli değildir"); // taslak tam metindir — olumsuzluk yerinde
    expect(r.confidence).toBeLessThanOrEqual(0.5); // ⬅️ ESKİDE 0,92 (kapıdan geçebilir, QR kaydında 2.000'de kesilirdi)
    expect(vi.mocked(reportError).mock.calls.some((c) => String(c[0]).includes("over autosend cap"))).toBe(true);
  });

  it("KONTROL: aynı 1.995 karakterlik cevap selam EKLENMEDEN (anahtar kapalı) tavanın altında kalır → güven aynen", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    openAiReturns(replyOfLength(1995));
    const r = await suggestReply(input());
    expect(r.reply.length).toBe(1995);
    expect(r.confidence).toBe(0.92);
  });

  it("KONTROL: selamla birlikte tavanı AŞMAYAN cevap (1.900 + selam) aynen gider → güven aynen", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    openAiReturns(replyOfLength(1900));
    const r = await suggestReply(input());
    expect(r.reply.startsWith("Merhaba")).toBe(true);
    expect(r.reply.length).toBeLessThanOrEqual(CAP);
    expect(r.confidence).toBe(0.92);
    expect(vi.mocked(reportError).mock.calls.some((c) => String(c[0]).includes("over autosend cap"))).toBe(false);
  });

  it("KONTROL: ilk cevap DEĞİLSE selam eklenmez → 1.995 karakter tavanın altında, güven aynen", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    openAiReturns(replyOfLength(1995));
    const r = await suggestReply(input({ conversationState: { isFirstOperatorReply: false } } as Partial<SuggestReplyInput>));
    expect(r.reply.length).toBe(1995);
    expect(r.confidence).toBe(0.92);
  });

  it("ham metin zaten tavanın üstündeyse eski kural aynen: güven ≤ 0,5 (tek rapor)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    openAiReturns(replyOfLength(2100));
    const r = await suggestReply(input());
    expect(r.confidence).toBeLessThanOrEqual(0.5);
    expect(vi.mocked(reportError).mock.calls.filter((c) => String(c[0]).includes("over autosend cap"))).toHaveLength(1);
  });
});
