import { describe, it, expect, vi, afterEach } from "vitest";
import {
  KB_FEE_RULE_PROMPT_DERIVATION,
  REPLY_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT_CODE_GREETING,
  REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE,
  REPLY_SYSTEM_PROMPT_KB_FEE_RULE,
} from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { kbFeeRuleEnabled } from "@/lib/ai/kb-fee-rule";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// KURAL-4 netleştirmesi — bilgi tabanında YAZAN sabit hizmet ücreti (kurucu onayı 09-30: "iki modelde ölç"; YALNIZ ölçüm).
// Anahtar `AI_KB_FEE_RULE_ENABLED` VARSAYILAN KAPALI: kapalıyken modele giden sistem istemi bayt bayt taban; açıkken TEK blok
// değişir (istisna araya girer, "Para konuları" → "Diğer para konuları"), platform dışı ödeme kuralı ve geri kalan istem aynen.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Otopark ücreti ne kadar?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [{ category: "parking", title: "Otopark", content: "Bina altı otopark günlük 150 TL." }],
  history: [],
  tone: "warm",
  language: "tr",
};

const EXCEPTION = "TEK İSTİSNA — BİLGİ TABANINDA YAZAN SABİT HİZMET ÜCRETİ";

afterEach(() => vi.unstubAllEnvs());

describe("KURAL-4 sabit hizmet ücreti istisnası", () => {
  it("türetmede kayıp çapa YOK (taban + kod selamı tabanı)", () => {
    expect(KB_FEE_RULE_PROMPT_DERIVATION).toEqual({ systemMissing: [], greetingMissing: [] });
  });

  it("🚨 anahtar kapalıyken modele giden sistem istemi bayt bayt TABAN ('true' da kapalı — yalnız '1')", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_KB_FEE_RULE_ENABLED", v);
      expect(kbFeeRuleEnabled(), JSON.stringify(v)).toBe(false);
      expect(replyRequestIdentity(input).system, JSON.stringify(v)).toBe(REPLY_SYSTEM_PROMPT);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toContain(EXCEPTION);
  });

  it("açıkken istisna girer; KURAL-4'ün ilk satırı ve platform dışı ödeme kuralı AYNEN; fark yalnız bu blok", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(REPLY_SYSTEM_PROMPT_KB_FEE_RULE);
    expect(sys).toContain(EXCEPTION);
    expect(sys).toContain("Konaklama / gece fiyatı, erken giriş / geç çıkış ücreti");
    expect(sys).toContain("  Fiyat, iade tutarı, indirim, tazminat rakamı ASLA yazma.\n");
    expect(sys).toContain('  Diğer para konuları her zaman "bu konu ev sahibinizin kararıdır"');
    expect(sys).not.toContain('\n  Para konuları her zaman "bu konu');
    expect(sys).toContain("PLATFORM DIŞI ÖDEME/İLETİŞİM");
    // Fark yalnız KURAL-4'ün başı: önü ve (yönlendirme cümlesinden itibaren) arkası bayt bayt taban.
    const head = REPLY_SYSTEM_PROMPT.indexOf("  Fiyat, iade tutarı, indirim, tazminat rakamı ASLA yazma.");
    const tailFrom = REPLY_SYSTEM_PROMPT.indexOf(' her zaman "bu konu ev sahibinizin kararıdır"');
    expect(head).toBeGreaterThan(0);
    expect(tailFrom).toBeGreaterThan(head);
    expect(sys.slice(0, head)).toBe(REPLY_SYSTEM_PROMPT.slice(0, head));
    expect(sys.endsWith(REPLY_SYSTEM_PROMPT.slice(tailFrom))).toBe(true);
  });

  it("iki anahtar birlikte: kod selamı türevinin üstüne istisna; ücret anahtarı kapanınca kod selamı türevi aynen", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    const both = replyRequestIdentity(input).system;
    expect(both).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE);
    expect(both).toContain(EXCEPTION);
    expect(both).not.toBe(REPLY_SYSTEM_PROMPT_KB_FEE_RULE); // kod selamı türevi de uygulandı
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "");
    expect(replyRequestIdentity(input).system).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING);
  });
});
