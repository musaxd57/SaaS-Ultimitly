import { describe, it, expect, afterEach, vi } from "vitest";
import { REPLY_SYSTEM_PROMPT_DERIVATION_MISSING, replySystemPromptFor, type ReplyPromptFlags } from "@/lib/ai/prompts";
import { hostVoiceKbFirstPersonEnabled } from "@/lib/ai/host-voice-kb-rule";
import { replyPromptVersion } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Bilgi tabanındaki üçüncü şahıs ev sahibi cümlesi → birinci kişi (kurucu 11-06 gece; 11-07 ücretli ölçüm onayı). Anahtar KAPALI başlar;
// kapalıyken istem bayt bayt aynı. K-1029-A katmanına bağlı: o katman acil durdurmayla kapalıysa bu katman da boş.
// ---------------------------------------------------------------------------

const BASE: ReplyPromptFlags = { codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, hostContactBan: true };
const EXAMPLE = 'DOĞRU: "Bize her gün 09:00–22:00 arasında ulaşabilirsiniz."';

describe("anahtar AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED — varsayılan KAPALI, yalnız '1' açar", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("boş / 'true' / '0' kapalı; '1' açık", () => {
    vi.stubEnv("AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED", "");
    expect(hostVoiceKbFirstPersonEnabled()).toBe(false);
    vi.stubEnv("AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED", "true");
    expect(hostVoiceKbFirstPersonEnabled()).toBe(false);
    vi.stubEnv("AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED", "1");
    expect(hostVoiceKbFirstPersonEnabled()).toBe(true);
  });
});

describe("istem katmanı", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("kapalıyken istem bayt bayt aynı (katman yokmuş gibi)", () => {
    expect(replySystemPromptFor({ ...BASE, hostVoiceKb: false })).toBe(replySystemPromptFor(BASE));
    expect(replySystemPromptFor(BASE)).not.toContain(EXAMPLE);
  });

  it("açıkken örnek K-1029-A'nın örnek satırının hemen ardına girer; başka hiçbir şey değişmez", () => {
    const off = replySystemPromptFor(BASE);
    const on = replySystemPromptFor({ ...BASE, hostVoiceKb: true });
    expect(on).toContain(EXAMPLE);
    expect(on).toContain('Bilgi tabanı: "Ev sahibine her gün 09:00–22:00 arasında ulaşılabilir."');
    const anchor = 'DOĞRU: "Rezervasyonda olmayan ziyaretçiler onayımıza tabidir."\n';
    const added = on.slice(on.indexOf(anchor) + anchor.length, on.indexOf(EXAMPLE) + EXAMPLE.length + 1);
    expect(on.replace(added, "")).toBe(off);
    // Örnek misafir metni ev sahibinin ağzından: DOĞRU satırında üçüncü şahıs yok.
    expect(EXAMPLE).not.toMatch(/ev sahib/i);
  });

  it("K-1029-A acil durdurmayla kapalıysa katman da boş (çapa yok, eksik çapa da yok)", () => {
    const banOff: ReplyPromptFlags = { ...BASE, hostContactBan: false };
    expect(replySystemPromptFor({ ...banOff, hostVoiceKb: true })).toBe(replySystemPromptFor(banOff));
  });

  it("öğe + parça kipinde de çapa bulunur; anahtarların hiçbir birleşiminde eksik çapa yok", () => {
    expect(replySystemPromptFor({ ...BASE, itemsMode: true, itemsParts: true, hostVoiceKb: true })).toContain(EXAMPLE);
    const missing = Object.entries(REPLY_SYSTEM_PROMPT_DERIVATION_MISSING()).filter(([, m]) => m.length > 0);
    expect(missing).toEqual([]);
  });

  it("anahtar istem kimliğini değiştirir (ölçüm raporu ve üretim izi iki sürümü ayırır)", () => {
    vi.stubEnv("AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED", "");
    const off = replyPromptVersion();
    vi.stubEnv("AI_HOST_VOICE_KB_FIRST_PERSON_ENABLED", "1");
    expect(replyPromptVersion()).not.toBe(off);
  });
});
