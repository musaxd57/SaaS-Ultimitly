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
import { REPLY_SYSTEM_PROMPT, ITEMS_HELD_REPLACEMENTS, replySystemPromptFor } from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// BIRAKILAN İSTEK ÖNCELİĞİ (konuşma öğeleri, 10-02 Luna ölçümü; ONAY BEKLİYOR): taban istem para / ödeme / ev sahibiyle görüşme
// için TEK cevap kalıbı öğretir; öğe kipinde bırakılan istek varken model (Luna medium) o kalıpla bırakılan isteğe değiniyor, cevabın
// tamamı tutuluyordu. Katman ÇAĞRI BAŞINA: yalnız bu turda bırakılan istek varken; yoksa sistem istemi bayt bayt aynı.
// ---------------------------------------------------------------------------

const LAYER_FLAGS = ["AI_CODE_GREETING_ENABLED", "AI_KB_FEE_RULE_ENABLED", "AI_STAY_DEFERRAL_PLAIN_ENABLED", "AI_ACCESS_CODE_COMPLETE_ENABLED", "AI_COMPLAINT_FOLLOWUP_RULE_ENABLED"];
const base: SuggestReplyInput = {
  guestMessage: "Can you send me your IBAN? And what's the wifi password?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "tr",
};
const RULE = "KONUŞMA ÖĞELERİ: kullanıcı isteminde EV SAHİBİNE BIRAKILAN istekler listelenmişse";

afterEach(() => vi.unstubAllEnvs());

describe("bırakılan istek önceliği — sistem istemi katmanı", () => {
  it("öğe yok / bırakılan yok → sistem istemi BAYT BAYT taban (anahtarlar kapalı)", () => {
    for (const k of LAYER_FLAGS) vi.stubEnv(k, "");
    expect(replyRequestIdentity(base).system).toBe(REPLY_SYSTEM_PROMPT);
    const noHeld = { ...base, conversationItems: { answerable: [{ ref: "R1", kind: "wifi" as const, hint: "wifi" }], held: [] } };
    expect(replyRequestIdentity(noHeld).system).toBe(REPLY_SYSTEM_PROMPT);
    expect(REPLY_SYSTEM_PROMPT).not.toContain(RULE);
  });

  it("🚨 bu turda (ya da önceki turda) bırakılan istek varken kural KURAL ÖNCELİĞİ listesinin ardına girer; fark yalnız orada", () => {
    for (const k of LAYER_FLAGS) vi.stubEnv(k, "");
    for (const held of [[{ kind: "payment_invoice" as const }], [{ kind: "human_request" as const, earlier: true }]]) {
      const withHeld = { ...base, conversationItems: { answerable: [{ ref: "R1", kind: "wifi" as const, hint: "wifi" }], held } };
      const sys = replyRequestIdentity(withHeld).system;
      expect(sys).toBe(replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, itemsHeld: true }));
      expect(sys).toContain(RULE);
      const anchor = ITEMS_HELD_REPLACEMENTS[0][0];
      const at = REPLY_SYSTEM_PROMPT.indexOf(anchor) + anchor.length;
      expect(at).toBeGreaterThan(anchor.length);
      expect(sys.slice(0, at)).toBe(REPLY_SYSTEM_PROMPT.slice(0, at));
      expect(sys.endsWith(REPLY_SYSTEM_PROMPT.slice(at))).toBe(true);
    }
  });

  it("kural taban istemin öğrettiği üç kalıbı adıyla anar ve Kural-4'ün önünde olduğunu söyler", () => {
    const sys = replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false, itemsHeld: true }).replace(/\s+/g, " ");
    for (const s of ["bu konu ev sahibinizin kararıdır", "Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor", "Mesajınız kaydedildi; ev sahibiniz görebilir", "Kural-4'ün ve niyet listesinin cevap kalıplarının ÖNÜNDEDİR"]) {
      expect(sys).toContain(s);
    }
    // Taban istem bu üç kalıbı GERÇEKTEN öğretiyor (kural boşa anmıyor — kalıp metni değişirse bu pin kırılır).
    const flat = REPLY_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain('"Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor; bu konu ev sahibinizin kararıdır."');
    expect(flat).toContain('"Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir."');
  });
});
