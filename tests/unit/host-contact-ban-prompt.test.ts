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
import { REPLY_SYSTEM_PROMPT, replySystemPromptFor } from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { hostContactPromptBanEnabled } from "@/lib/ai/host-contact-ban-rule";
import { buildItemsPromptBlock, type ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// K-1029-A — EV SAHİBİNE YÖNLENDİRME YASAĞI, İSTEM KATMANI (kurucu 10-29 gece: "ev sahibinize yazın her dilde yasak — istem + kod").
// Diğer istem katmanlarından FARKLI olarak VARSAYILAN AÇIK (kurucunun açık talimatı); kapatma anahtarı `AI_HOST_CONTACT_PROMPT_BAN_DISABLED`
// yalnız "1" ile kapatır (öbür bayraklar gibi tek yazım). Kod katmanı (`host-contact-filler.ts`) istemden BAĞIMSIZ koşar — model yine de
// yazarsa cümle silinir. Diğer istem dosyaları bu katmanı kapatıp kendi katmanlarını tabana karşı ölçer; burada katmanın kendisi pinli.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Havlular nerede?",
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
  "AI_COURTESY_RULE_ENABLED",
  "AI_NO_APOLOGY_RULE_ENABLED",
];
const KILL = "AI_HOST_CONTACT_PROMPT_BAN_DISABLED";
const BAN_RULE = "EV SAHİBİNE YÖNLENDİRME CÜMLESİ YAZMA";
const OLD_REFER = "bilgi yoksa nazikçe alternatif öner ve ev sahibine yönlendir.";
const OLD_RETRY = 'DOĞRU (b): "Şunu dener misiniz: ... Düzelmezse yeniden yazın; o mesaj da kaydedilir."';
const BLOCK_RULE = "o isteği CEVAPLAMA ve answeredRequests'e KOYMA";
const off = { codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false };

afterEach(() => vi.unstubAllEnvs());

describe("anahtar — varsayılan AÇIK, yalnız '1' kapatır", () => {
  it.each(["", "0", "true", "yes", " 1", "1 "])("%j → açık", (v) => {
    vi.stubEnv(KILL, v);
    expect(hostContactPromptBanEnabled()).toBe(true);
  });
  it("'1' → kapalı", () => {
    vi.stubEnv(KILL, "1");
    expect(hostContactPromptBanEnabled()).toBe(false);
  });
});

describe("sistem istemi", () => {
  it("🚨 varsayılan: modele giden istemde yasak kuralı var; eski 'ev sahibine yönlendir' ve 'yeniden yazın' kalıpları YOK", () => {
    for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(replySystemPromptFor({ ...off, hostContactBan: true }));
    expect(sys).toContain(BAN_RULE);
    expect(sys).toContain('"Should anything go wrong, message your host"');
    // Kurucu 10-30: güvenlik talimatı yalnız misafir NET sorduysa; mesajı ev sahibi yazıyor (üçüncü kişi, arka plan, üçüncü taraf yok).
    expect(sys).toContain("Misafir güvenlikle ilgili NET bir soru");
    expect(sys).toContain("MESAJI EV SAHİBİ YAZIYOR (kurucu 10-30)");
    expect(sys).toContain('DOĞRU: "Rezervasyonda olmayan ziyaretçiler onayımıza tabidir."');
    // Kurucu 10-30: başka dairenin bilgisi verilmez, ret yumuşak (sert "paylaşamam" ve ev sahibine yönlendirme yok).
    expect(sys).toContain("BAŞKA DAİRE / BAŞKA MİSAFİR (kurucu 10-30)");
    expect(sys).not.toContain("Gaz, yangın, duman, acil numara gibi güvenlik uyarıları aynen kalır.");
    expect(sys).not.toContain(OLD_REFER);
    expect(sys).not.toContain(OLD_RETRY);
    // Taban istemde üç çapa da var (katman sessizce boşa düşmesin).
    expect(REPLY_SYSTEM_PROMPT).toContain(OLD_REFER);
    expect(REPLY_SYSTEM_PROMPT).toContain(OLD_RETRY);
    expect(REPLY_SYSTEM_PROMPT).not.toContain(BAN_RULE);
  });

  it("🚨 inceleme 10-30 gece F (iki hakem 10-29 ilkesi): ana istem ev sahibine kalan isteği ATLATMAZ — 'o isteğe hiç değinme' yalnız istek defterli öğe bloğunda; QR / defterli olmayan kanalda istek sessizce kaybolmasın", () => {
    for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
    const sys = replyRequestIdentity(input).system;
    expect(sys).not.toContain("o isteğe hiç değinme");
    expect(sys).not.toContain("ev sahibi\n    kendisi cevaplar");
    expect(sys).toContain("SESSİZCE ATLAMA");
  });
  it("🚨 F (yeniden yazma yolu): ses ihlali notu da konuyu atlatmaz", async () => {
    const { SENIOR_REWRITE_NOTES } = await import("@/lib/ai/semantic/senior-rewrite");
    expect(SENIOR_REWRITE_NOTES.hostVoice).not.toMatch(/hiç değinme/);
    expect(SENIOR_REWRITE_NOTES.hostVoice).toContain("SESSİZCE ATLAMA");
    expect(SENIOR_REWRITE_NOTES.hostVoice).toContain("birinci çoğul kişiyle");
  });

  it("kapatma anahtarı ('1') → modele giden istem BAYT BAYT taban", () => {
    for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
    vi.stubEnv(KILL, "1");
    expect(replyRequestIdentity(input).system).toBe(REPLY_SYSTEM_PROMPT);
  });

  it("fark YALNIZ üç çapada: yasak metinleri geri çevrilince taban elde edilir", () => {
    const on = replySystemPromptFor({ ...off, hostContactBan: true });
    const start = on.indexOf("  - EV SAHİBİNE YÖNLENDİRME CÜMLESİ YAZMA");
    const last = 'tanıdığınızsa kendisine doğrudan sorabilirsiniz."\n';
    const end = on.indexOf(last, start) + last.length;
    expect(start).toBeGreaterThan(0);
    const back = (on.slice(0, start) + on.slice(end))
      .replace("bilgi yoksa nazikçe alternatif öner; misafiri ev sahibine yönlendiren cümle yazma.", OLD_REFER)
      .replace('DOĞRU (b): "Şunu dener misiniz: ..."', OLD_RETRY);
    expect(back).toBe(REPLY_SYSTEM_PROMPT);
  });

  it("parça kipinde no_info satırı da yönlendirmeyi 'bilgi yok' sayar; parça kipi dışında bu çapa yok", () => {
    const parts = replySystemPromptFor({ ...off, itemsMode: true, itemsParts: true, hostContactBan: true });
    expect(parts).toContain('ya da bilginin o istek için tek söylediği "ev sahibine yazın / ulaşın / arayın" ise');
    const partsOff = replySystemPromptFor({ ...off, itemsMode: true, itemsParts: true });
    expect(partsOff).not.toContain("ev sahibine yazın / ulaşın / arayın");
    expect(replySystemPromptFor({ ...off, itemsMode: true, hostContactBan: true })).not.toContain("ev sahibine yazın / ulaşın / arayın");
  });
});

describe("öğe kipi bloğu", () => {
  const ITEMS: ReplyItemsInput = { answerable: [{ ref: "R1", kind: "wifi", hint: "wifi şifresi" }], held: [] };
  it("varsayılan: blok yönlendirmeyle cevaplanacak isteği CEVAPLAMA kuralıyla biter", () => {
    expect(buildItemsPromptBlock(ITEMS).trimEnd().endsWith("(istek ev sahibinde açık kalır).")).toBe(true);
    expect(buildItemsPromptBlock(ITEMS)).toContain(BLOCK_RULE);
  });
  it("kapatma anahtarı → blok eski biçim (kural yok)", () => {
    vi.stubEnv(KILL, "1");
    const block = buildItemsPromptBlock(ITEMS);
    expect(block).not.toContain(BLOCK_RULE);
    expect(block.endsWith("hiçbirini cevaplamadıysan [].")).toBe(true);
  });
});
