import { describe, it, expect, vi, afterEach } from "vitest";
import {
  REPLY_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT_CODE_GREETING,
  REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE,
  REPLY_SYSTEM_PROMPT_KB_FEE_RULE,
  STAY_DEFERRAL_PLAIN_PROMPT_DERIVATION,
  STAY_DEFERRAL_PLAIN_REPLACEMENTS,
  replySystemPromptFor,
} from "@/lib/ai/prompts";
import { replyRequestIdentity } from "@/lib/ai";
import { stayDeferralPlainEnabled } from "@/lib/ai/stay-deferral-plain";
import { hasAvailabilityDeferral } from "@/lib/ai/availability-claims";
import { carriesHandoffNotice } from "@/lib/ai/output-veto";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// KONAKLAMA ERTELEMESİ BİLDİRİMSİZ (Luna ölçümü 09-30; anahtar `AI_STAY_DEFERRAL_PLAIN_ENABLED` VARSAYILAN KAPALI).
//
// K10'dan (09-30) beri "mesajınız kaydedildi / ev sahibiniz görebilir" misafire GİTMEZ (çıktı vetosu `handoff_notice`), ama
// istemin Bölüm 7.5 standart erteleme cümlesi ve üç konaklama örneği bu kuyruğu hâlâ ÖĞRETİYORDU. Canlı hatta 5.1 kuyruğu
// çoğunlukla atıp iki modelin doğruladığı ertelemeyi gönderiyordu (14 konaklama isteğinde 10), gpt-6-luna örneği harfiyen
// izleyip kuyruğu ekliyordu → tutuluyordu (3/14). Anahtar açıkken YALNIZ konaklama ertelemesinin kuyruğu kalkar; devir
// örnekleri (insan talebi, şikâyet, öz-zarar, çıkışı reddetme, sosyal mühendislik) AYNEN kalır — ev sahibine "cevabınızı
// bekliyor" e-postası o cümleye bağlıdır.
// ---------------------------------------------------------------------------

const input: SuggestReplyInput = {
  guestMessage: "Can we check in at 12?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [],
  history: [],
  tone: "warm",
  language: "en",
};

const RULE = 'BİLDİRİM cümlesi YAZMA';
const section75 = (sys: string) => {
  const from = sys.indexOf("BÖLÜM 7.5 — ERKEN GİRİŞ / GEÇ ÇIKIŞ");
  const to = sys.indexOf("BÖLÜM 8", from);
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return sys.slice(from, to);
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

afterEach(() => vi.unstubAllEnvs());

describe("konaklama ertelemesi bildirimsiz — istem türevi", () => {
  it("türetmede kayıp çapa YOK (dört taban: düz, kod selamı, ücret kuralı, ikisi)", () => {
    expect(STAY_DEFERRAL_PLAIN_PROMPT_DERIVATION).toEqual({ base: [], codeGreeting: [], kbFeeRule: [], codeGreetingKbFeeRule: [] });
  });

  it("🚨 anahtar kapalıyken dört istem de bugünkü sabitlerle BAYT BAYT aynı ('true' da kapalı — yalnız '1')", () => {
    expect(replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false })).toBe(REPLY_SYSTEM_PROMPT);
    expect(replySystemPromptFor({ codeGreeting: true, kbFeeRule: false, stayDeferralPlain: false })).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING);
    expect(replySystemPromptFor({ codeGreeting: false, kbFeeRule: true, stayDeferralPlain: false })).toBe(REPLY_SYSTEM_PROMPT_KB_FEE_RULE);
    expect(replySystemPromptFor({ codeGreeting: true, kbFeeRule: true, stayDeferralPlain: false })).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE);
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "");
    for (const v of ["", "0", "true", "yes", " 1"]) {
      vi.stubEnv("AI_STAY_DEFERRAL_PLAIN_ENABLED", v);
      expect(stayDeferralPlainEnabled(), JSON.stringify(v)).toBe(false);
      expect(replyRequestIdentity(input).system, JSON.stringify(v)).toBe(REPLY_SYSTEM_PROMPT);
    }
    expect(REPLY_SYSTEM_PROMPT).not.toContain(RULE);
  });

  it("açıkken Bölüm 7.5'in standart cümleleri kuyruksuz + açık kural; üç konaklama örneği kuyruksuz", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "");
    vi.stubEnv("AI_STAY_DEFERRAL_PLAIN_ENABLED", "1");
    const sys = replyRequestIdentity(input).system;
    expect(sys).toBe(replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: true }));
    // Bölüm 7.5'te "kaydedildi" tabanda 5 kez (dört standart cümle + erken giriş notu); açıkken YALNIZ yeni kuralın alıntısı.
    expect(count(section75(REPLY_SYSTEM_PROMPT), "kaydedildi")).toBe(5);
    expect(count(section75(sys), "kaydedildi")).toBe(1);
    expect(section75(sys)).toContain(RULE);
    expect(section75(sys)).toContain('Tek standart cümle: "Bu ev sahibinizin\n    kararıdır."');
    // replyStance örneği: kuyruksuz erteleme hâlâ "defers".
    expect(sys).toContain('"Bu ev sahibinizin kararıdır." → defers');
    // Konaklama örnekleri (erken giriş, müsaitlik, girişten önce bagaj): kuyruk yok, erteleme var.
    for (const tail of [
      "Whether an earlier arrival is possible is the host's call.\"",
      "Availability is the host's call.\"",
      "Whether luggage drop-off before check-in is possible is the host's call.\"",
    ]) {
      expect(sys, tail).toContain(tail);
    }
    expect(count(sys, "has been recorded and is visible to your host")).toBe(
      count(REPLY_SYSTEM_PROMPT, "has been recorded and is visible to your host") - 2,
    );
    expect(sys).not.toContain("your dates have been recorded");
  });

  it("devir örnekleri ve devir kuralları AYNEN kalır (ev sahibine e-posta bu cümleye bağlı)", () => {
    const sys = replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: true });
    for (const keep of [
      'kibarca "Bu konu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir." de.', // sosyal mühendislik
      'Reply: nazikçe "Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir." de —', // insan talebi
      '"reply":"Tabii ki. Mesajınız kaydedildi; ev sahibiniz görebilir."', // insan talebi örneği
      '"reply":"Bu konu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."', // çıkışı reddetme
      '"reply":"Mesajınız kaydedildi; ev sahibiniz görebilir."', // öz-zarar
      "Klimayla ilgili mesajınız kaydedildi; ev sahibiniz görebilir.", // şikâyet
    ]) {
      expect(REPLY_SYSTEM_PROMPT, keep).toContain(keep);
      expect(sys, keep).toContain(keep);
    }
  });

  it("fark YALNIZ çapalarda: her çapa tabanda tek, türevde yok; uzunluk farkı çapaların toplam farkı", () => {
    const sys = replySystemPromptFor({ codeGreeting: false, kbFeeRule: false, stayDeferralPlain: true });
    let expected = REPLY_SYSTEM_PROMPT;
    for (const [anchor, replacement] of STAY_DEFERRAL_PLAIN_REPLACEMENTS) {
      expect(count(REPLY_SYSTEM_PROMPT, anchor), anchor.slice(0, 50)).toBe(1);
      expect(sys.includes(anchor), anchor.slice(0, 50)).toBe(false);
      expected = expected.replace(anchor, () => replacement);
    }
    expect(sys).toBe(expected);
  });

  it("üç anahtar birlikte: kod selamı + ücret kuralı türevinin üstüne; tek tek kapatınca önceki sabitlere döner", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    vi.stubEnv("AI_KB_FEE_RULE_ENABLED", "1");
    vi.stubEnv("AI_STAY_DEFERRAL_PLAIN_ENABLED", "1");
    const all = replyRequestIdentity(input).system;
    expect(all).toContain(RULE);
    expect(all).toContain("TEK İSTİSNA — BİLGİ TABANINDA YAZAN SABİT HİZMET ÜCRETİ");
    expect(all).toContain('"reply":"Our standard check-in is at 15:00. Whether an earlier arrival is possible is the host\'s call."');
    vi.stubEnv("AI_STAY_DEFERRAL_PLAIN_ENABLED", "");
    expect(replyRequestIdentity(input).system).toBe(REPLY_SYSTEM_PROMPT_CODE_GREETING_KB_FEE_RULE);
  });

  it("kuyruksuz erteleme ürünün erteleme dedektöründe ERTELEME, çıktı vetosunda devir DEĞİL (gönderim yolu açık)", () => {
    for (const reply of [
      "Our standard check-in is at 15:00. Whether an earlier arrival is possible is the host's call.",
      "Normal çıkış saatimiz 11:00. Saat 13:00'teki çıkış isteği müsaitlik ve temizlik programına bağlı; bu ev sahibinizin kararıdır.",
    ]) {
      expect(hasAvailabilityDeferral(reply), reply).toBe(true);
      expect(carriesHandoffNotice(reply), reply).toBe(false);
    }
    // Kuyruklu biçim bugün vetoya takılır (karşılaştırma için).
    expect(carriesHandoffNotice("Whether an earlier arrival is possible is the host's call; your request has been recorded and is visible to your host.")).toBe(true);
  });
});
