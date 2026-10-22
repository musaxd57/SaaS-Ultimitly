import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
import { REPLY_SYSTEM_PROMPT, REPLY_SYSTEM_PROMPT_DERIVATION_MISSING, replySystemPromptFor } from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { courtesyRuleEnabled } from "@/lib/ai/courtesy-rule";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// HÂL HATIR KURALI (kurucu tarifi 10-02 akşam; anahtar `AI_COURTESY_RULE_ENABLED` VARSAYILAN KAPALI). Kök neden: "soru sormadıysa / yalnız
// teşekkür-onay-kapanış → güven 0,4 altı" kuralı hâl hatırı kapanışla aynı kefeye koyuyordu (Ayarlar testinde "nasılsınız" → güven 0,30 →
// ev sahibine). Katman hâl hatırı o kuralın dışında tutar, davranışı kurucunun tarifine bağlar; güveni YÜKSELTME talimatı vermez.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Merhaba, nasılsın?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "tr",
};
const OTHER_LAYERS = [
  "AI_CODE_GREETING_ENABLED",
  "AI_KB_FEE_RULE_ENABLED",
  "AI_STAY_DEFERRAL_PLAIN_ENABLED",
  "AI_ACCESS_CODE_COMPLETE_ENABLED",
  "AI_COMPLAINT_FOLLOWUP_RULE_ENABLED",
];
const RULE = "HÂL HATIR — ölçü";

afterEach(() => vi.unstubAllEnvs());

describe("hâl hatır — cevap istemi katmanı", () => {
  it("🚨 kapalıyken ('true' / '0' / ' 1' dahil) sistem istemi bayt bayt taban", () => {
    for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_COURTESY_RULE_ENABLED", v);
      expect(courtesyRuleEnabled(), JSON.stringify(v)).toBe(false);
      expect(replyRequestIdentity(input).system).toBe(REPLY_SYSTEM_PROMPT);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toContain(RULE);
  });

  it("açıkken: hâl hatır güven 0,4 kuralının DIŞINDA; kurucunun beş durumu ve üç sınırı istemde; güveni yükseltme talimatı YOK", () => {
    for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
    vi.stubEnv("AI_COURTESY_RULE_ENABLED", "1");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, courtesy: true }));
    expect(sys).toContain(RULE);
    expect(sys).toContain("bu kurala GİRMEZ — misafir bir soru sordu");
    expect(sys).toContain("confidence'ı yapay olarak ne\n    yükselt ne düşür");
    for (const s of [
      "İlk temasta yalnız selam + hâl hatır",
      "araya karşı soru KOYMA",
      '"Buradayım." de ve',
      "Haklısınız,\n      sorunuza karşılık vermedim.",
      "asıl konuya karşılık ver; şikâyet kuralları geçerli",
      "aynı cümleyi tekrarlama",
      "DUYGU / kişisel yaşantı UYDURMA",
      "karşı soru yalnız GERÇEK amaçla",
      "TEŞHİS KOYMA",
      "(Hâl hatır bir sorudur.)",
    ]) {
      expect(sys, s).toContain(s);
    }
    // Teşekkür / onay / kapanış kuralı AYNEN durur (yalnız hâl hatır dışarıda).
    expect(sys).toContain("0.4'ün ALTINA koy. Böyle mesajlara otomatik cevap GÖNDERİLMEZ");
    // Kurucu sınırı 1: örnek cevap durum beyanı ("iyiyiz") öğretmez.
    expect(REPLY_SYSTEM_PROMPT).toContain('"reply":"Merhaba, iyiyiz, teşekkür ederiz.');
    expect(sys).not.toContain("iyiyiz");
    expect(sys).toContain('"reply":"Merhaba, teşekkür ederiz. Çıkış saatimiz 11:00.');
  });

  it("kod selamı katmanıyla birlikte: ÖRNEK 24 selamsız ve durum beyansız", () => {
    const sys = replySystemPromptFor({ codeGreeting: true, kbFeeRule: false, stayDeferralPlain: false, courtesy: true });
    expect(sys).toContain(RULE);
    expect(sys).not.toContain("İyiyiz");
    expect(sys).toContain('"reply":"Teşekkür ederiz. Çıkış saatimiz 11:00.');
  });

  it("tüm katman birleşimlerinde kayıp çapa YOK (256 birleşim)", () => {
    const missing = REPLY_SYSTEM_PROMPT_DERIVATION_MISSING();
    expect(Object.keys(missing)).toHaveLength(1024); // + tarafsızlık katmanı (10-21) → dokuz; + cevap parçaları (10-23 A) → on katman
    for (const [name, m] of Object.entries(missing)) expect(m, name).toEqual([]);
  });

  it("fark yalnız üç çapada: taban istemin geri kalanı birebir", () => {
    const sys = replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, courtesy: true });
    const a = "  - Misafir bir soru SORMADIYSA ya da sadece teşekkür/onay/kapanış yazdıysa\n";
    const at = REPLY_SYSTEM_PROMPT.indexOf(a);
    expect(at).toBeGreaterThan(0);
    expect(sys.slice(0, at)).toBe(REPLY_SYSTEM_PROMPT.slice(0, at));
    const tail = "  - Cevabı mümkün olan en kısa, en öz haliyle yaz: tek konu, tek mesaj.\n";
    const tb = REPLY_SYSTEM_PROMPT.indexOf(tail);
    const ts = sys.indexOf(tail);
    expect(tb).toBeGreaterThan(at);
    // Son kontrol maddesi + ÖRNEK 24 dışında kuyruk aynı.
    const norm = (t: string) =>
      t
        .replace(" (Hâl hatır bir sorudur.)", "")
        .replace('"reply":"Merhaba, teşekkür ederiz.', '"reply":"Merhaba, iyiyiz, teşekkür ederiz.');
    expect(norm(sys.slice(ts))).toBe(REPLY_SYSTEM_PROMPT.slice(tb));
  });
});
