import { describe, it, expect, vi, afterEach } from "vitest";
import { REPLY_SYSTEM_PROMPT, replySystemPromptFor, NO_APOLOGY_REPLACEMENTS, REPLY_SYSTEM_PROMPT_DERIVATION_MISSING } from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { suggestReplyFallback } from "@/lib/ai/fallback";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// TARAFSIZLIK / ÖZÜR YASAĞI (kurucu 10-21: "sofra kirli derse özür dilemesin, haklısınız üzgünüm demesin"; anahtar
// `AI_NO_APOLOGY_RULE_ENABLED` KAPALI). Taban istem şikâyette "Bunun için özür dileriz" kalıbını ÖĞRETİYORDU — katman açıkken hiçbir
// talimat ya da örnek özür öğretmez; kapalıyken istem bayt bayt aynı.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

const base = { codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false };
const input: SuggestReplyInput = {
  guestMessage: "Masa kirliydi.",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: null,
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
};

/** Örneklerin "reply" alanları (istemde JSON satırları). */
const exampleReplies = (prompt: string) => [...prompt.matchAll(/"reply":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
const APOLOGY = /özür dile|kusura bakma|apolog|sorry|entschuldig|lo sentimos|désolé/i;
/** Kurucu 10-22 (T-a): "üzgünüz de gitmesin" — üzüntü / anlayış cümlesi de özür sayılır. */
const SYMPATHY = /üzgün|rahatsızlık için|regret|inconvenience|tut uns leid/i;

describe("tarafsızlık katmanı", () => {
  it("kapalıyken taban istem bayt bayt aynı", () => {
    expect(replySystemPromptFor(base)).toBe(REPLY_SYSTEM_PROMPT);
  });

  it("taban istem bugün örneklerde özür ÖĞRETİYOR (katmanın sebebi — anti-vakum)", () => {
    expect(exampleReplies(REPLY_SYSTEM_PROMPT).filter((r) => APOLOGY.test(r)).length).toBeGreaterThanOrEqual(4);
    expect(REPLY_SYSTEM_PROMPT).toContain("Kısa bir ÖZÜR cümlesi serbesttir");
  });

  it("açıkken: hiçbir örnek cevap özür içermez; özür izni veren talimat kalmaz; TARAFSIZLIK kuralı var", () => {
    const on = replySystemPromptFor({ ...base, noApology: true });
    expect(exampleReplies(on).filter((r) => APOLOGY.test(r))).toEqual([]);
    expect(on).not.toContain("Kısa bir ÖZÜR cümlesi serbesttir");
    expect(on).not.toContain("Kısa özür ≠ kusur kabulü");
    expect(on).not.toContain('NEZAKET KALIPLARI: "özür dileriz"');
    expect(on).toContain("TARAFSIZLIK (kurucu kuralı)");
    expect(on).toContain("Ödemeyi reddeden, iade / tazminat isteyen");
  });

  it("açıkken (10-22 T-a): üzüntü / anlayış cümlesi de yasak; örneklerde yok; şikâyette empati satırı yok", () => {
    const on = replySystemPromptFor({ ...base, noApology: true });
    expect(on).toContain('"üzgünüz", "yaşadığınız rahatsızlık için üzgünüz"');
    expect(on).toContain('"sorry for the inconvenience"');
    expect(on).toContain("Şikâyette empati / üzüntü / özür cümlesi YOK");
    expect(on).not.toContain("Empati EN FAZLA BİR cümle");
    expect(exampleReplies(on).filter((r) => SYMPATHY.test(r))).toEqual([]);
  });

  it("yedek (fallback) şikâyet taslağı: açıkken özürsüz (TR + EN), kapalıyken bugünkü metin", () => {
    const complaint = (guestMessage: string) => suggestReplyFallback({ ...input, guestMessage }).reply;
    const tr = "Klima çalışmıyor, çok sıcak, berbat bir durum.";
    const en = "The air conditioning is broken and it is terrible.";
    expect(complaint(tr)).toMatch(APOLOGY);
    vi.stubEnv("AI_NO_APOLOGY_RULE_ENABLED", "1");
    for (const m of [tr, en]) {
      const reply = complaint(m);
      expect(reply).not.toMatch(APOLOGY);
      expect(reply).not.toMatch(SYMPATHY);
      expect(reply).toMatch(/ilettim|notified/);
    }
  });

  it("bütün anahtar birleşimlerinde çapa eksiği yok", () => {
    const missing = Object.entries(REPLY_SYSTEM_PROMPT_DERIVATION_MISSING()).filter(([, m]) => m.length > 0);
    expect(missing).toEqual([]);
    expect(NO_APOLOGY_REPLACEMENTS.length).toBeGreaterThanOrEqual(8);
  });

  it("bağlantı: ortam anahtarı cevap isteğine ulaşır (sistem + sıcak ton rehberi)", () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const off = replyRequestIdentity(input);
    expect(off.system).not.toContain("TARAFSIZLIK (kurucu kuralı)");
    expect(off.user).toContain('Nezaket kalıpları ("özür dileriz"');
    vi.stubEnv("AI_NO_APOLOGY_RULE_ENABLED", "1");
    const on = replyRequestIdentity(input);
    expect(on.system).toContain("TARAFSIZLIK (kurucu kuralı)");
    expect(on.user).not.toContain('Nezaket kalıpları ("özür dileriz"');
  });

  it("yalnız tam '1' açar", () => {
    vi.stubEnv("AI_NO_APOLOGY_RULE_ENABLED", "true");
    expect(replyRequestIdentity(input).system).not.toContain("TARAFSIZLIK (kurucu kuralı)");
  });
});
