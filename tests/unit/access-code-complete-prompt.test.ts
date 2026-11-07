import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  REPLY_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT_CODE_GREETING,
  REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE,
  REPLY_SYSTEM_PROMPT_KB_FEE_RULE,
  REPLY_SYSTEM_PROMPT_DERIVATION_MISSING,
  ACCESS_CODE_COMPLETE_REPLACEMENTS,
  replySystemPromptFor,
} from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { accessCodeCompleteEnabled } from "@/lib/ai/access-code-complete";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// GİRİŞ TARİFİNDE KOD (Luna ölçümü 09-30; anahtar `AI_ACCESS_CODE_COMPLETE_ENABLED` VARSAYILAN KAPALI).
//
// Canlı hatta gpt-6-luna "binanın önündeyiz, anahtarı nereden alacağız?" / "how do we get the keys?" sorusuna kutunun yerini ve
// "kodu girip kapağı çekin" adımını yazıp KODU YAZMADI (bilgi tabanında 4721 yazıyor; cevap gönderildi) — kod açıkça sorulunca
// veriyordu; gpt-5.1 her iki soruda kodu yazıyordu. Anahtar açıkken KURAL-3'e tek cümle girer: giriş / anahtar sorusunda bilgi
// tabanının yazdığı kod tarifle birlikte AYNEN yazılır; onaylanmamış rezervasyon ve QR blokları (kod ASLA) önceliklidir.
// Kod hiçbir yerde uydurulmaz; kodun isteme girip girmemesi zaten kodda (konaklama kapsamı + sır süzgeci).
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "We're outside the building, how do we get the keys?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "en",
};

const RULE = "tarifle birlikte o kodu da AYNEN yaz";
const flags = (codeGreeting: boolean, kbFeeRule: boolean, stayDeferralPlain: boolean, accessCodeComplete: boolean) => ({
  codeGreeting,
  kbFeeRule,
  stayDeferralPlain,
  accessCodeComplete,
});

// K-1029-A (10-29 gece): ev sahibine yönlendirme yasağı VARSAYILAN AÇIK bir istem katmanıdır (kapatma anahtarı
// `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1`). Bu dosya KENDİ katmanını tabana karşı ölçer ve diğer katmanları kapatır — yasak katmanı da
// aynı biçimde kapatılır; kendisi `host-contact-ban-prompt.test.ts`te pinli.
beforeEach(() => vi.stubEnv("AI_HOST_CONTACT_PROMPT_BAN_DISABLED", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("giriş tarifinde kod — istem türevi", () => {
  it("anahtarların TÜM birleşimlerinin HİÇBİRİNDE kayıp çapa yok (yedi katman → 128; şikâyet takibi 10-01, öğe kipi alanı + bırakılan istek önceliği 10-02)", () => {
    const missing = REPLY_SYSTEM_PROMPT_DERIVATION_MISSING();
    expect(Object.keys(missing)).toHaveLength(2048); // + tarafsızlık katmanı (10-21) → dokuz; + cevap parçaları (10-23 A) → on; + ev sahibine yönlendirme yasağı (10-29 K-1029-A) → on bir katman
    for (const [combo, list] of Object.entries(missing)) expect(list, combo).toEqual([]);
  });

  it("🚨 anahtar kapalıyken istem bugünküyle BAYT BAYT aynı ('true' da kapalı — yalnız '1')", () => {
    expect(replySystemPromptFor(flags(false, false, false, false))).toBe(REPLY_SYSTEM_PROMPT);
    expect(replySystemPromptFor(flags(true, false, false, false))).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING);
    expect(replySystemPromptFor(flags(false, true, false, false))).toBe(REPLY_SYSTEM_PROMPT_KB_FEE_RULE);
    expect(replySystemPromptFor(flags(true, true, false, false))).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE);
    for (const k of ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED"]) vi.stubEnv(k, "");
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_ACCESS_CODE_COMPLETE_ENABLED", v);
      expect(accessCodeCompleteEnabled(), JSON.stringify(v)).toBe(false);
      expect(replyRequestIdentity(input).system, JSON.stringify(v)).toBe(REPLY_SYSTEM_PROMPT);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toContain(RULE);
  });

  it("açıkken kural KURAL-3'ün ilk satırının hemen ardına girer; fark YALNIZ orada", () => {
    for (const k of ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED"]) vi.stubEnv(k, "");
    vi.stubEnv("AI_ACCESS_CODE_COMPLETE_ENABLED", "1");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(replySystemPromptFor(flags(false, false, false, true)));
    const first = "  Wi-Fi ağ adı, şifre, kapı kodu, giriş kodu, adres — bu bilgiler yalnızca bilgi tabanında geçiyorsa kullan.\n";
    const at = sys.indexOf(first);
    expect(at).toBeGreaterThan(0);
    expect(sys.indexOf(RULE)).toBeGreaterThan(at);
    expect(sys.indexOf(RULE)).toBeLessThan(sys.indexOf("  Bilgi tabanında yoksa: \"Bu bilgi kayıtlarımda yok"));
    // Onaylanmamış rezervasyon / QR blokları önceliklidir (kural bunu söyler).
    expect(sys).toContain("REZERVASYON ONAYLANMAMIŞ / AKTİF KONAKLAMA blokları varsa onlar geçerlidir");
    let expected = REPLY_SYSTEM_PROMPT;
    for (const [anchor, replacement] of ACCESS_CODE_COMPLETE_REPLACEMENTS) {
      expect(REPLY_SYSTEM_PROMPT.split(anchor).length - 1).toBe(1);
      expected = expected.replace(anchor, () => replacement);
    }
    expect(sys).toBe(expected);
  });

  it("dört anahtar birlikte: hepsinin izi var; bu anahtar kapanınca üçlü birleşime döner", () => {
    for (const k of ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED", "AI_ACCESS_CODE_COMPLETE_ENABLED"]) {
      vi.stubEnv(k, "1");
    }
    const all = replyRequestIdentity(input).system;
    expect(all).toContain(RULE);
    expect(all).toContain("ÜCRET KURALI: Onaylı bilgi tabanındaki sabit hizmet ücretini");
    expect(all).toContain("BİLDİRİM cümlesi YAZMA");
    expect(all).toContain('"reply":"Wi-Fi ağımız'); // kod selamı türevi
    vi.stubEnv("AI_ACCESS_CODE_COMPLETE_ENABLED", "");
    expect(replyRequestIdentity(input).system).toBe(replySystemPromptFor(flags(true, true, true, false)));
    expect(replyRequestIdentity(input).system).not.toContain(RULE);
  });
});
