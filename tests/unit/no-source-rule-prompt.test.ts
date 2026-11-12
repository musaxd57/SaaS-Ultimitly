import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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
import { replyRequestIdentity, replyPromptVersion } from "@/lib/ai";
import { noSourceRuleEnabled } from "@/lib/ai/no-source-rule";
import { buildItemsPromptBlock, type ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// KAYNAĞI OLMAYAN İSTEK CEVAPLANMAZ — İSTEM KATMANI (`ai/no-source-rule.ts`; anahtar `AI_NO_SOURCE_RULE_ENABLED` VARSAYILAN KAPALI).
// Kurucu 11-12: "promptların içinde bu yanlışlara sebep olan yazılar". İstem denetimi: bilgisizlik açıklaması / yönlendirme / söz / çekince
// yasak + "hiçbir soruyu atlama" dört yerde + tek çıkış turun tamamını tutuyor → model iki soruluk mesajda uyduruyor. Katman kuralı İSTEK
// BAŞINA kurar ve YALNIZ öğe kipinde uygulanır (istek defteri yoksa atlanan soru iz bırakmadan kaybolurdu — 10-30 pini).
// Kod kapısı değişmez; ölçüm sonucu görülmeden açılmaz.
// ---------------------------------------------------------------------------

const FLAG = "AI_NO_SOURCE_RULE_ENABLED";
const OTHER_LAYERS = [
  "AI_CODE_GREETING_ENABLED",
  "AI_KB_FEE_RULE_ENABLED",
  "AI_STAY_DEFERRAL_PLAIN_ENABLED",
  "AI_ACCESS_CODE_COMPLETE_ENABLED",
  "AI_COMPLAINT_FOLLOWUP_RULE_ENABLED",
  "AI_COURTESY_RULE_ENABLED",
  "AI_NO_APOLOGY_RULE_ENABLED",
  "AI_ANSWER_PARTS_ENABLED",
];
const off = { codeGreeting: false, kbFeeRule: false, stayDeferralPlain: false };
const ITEMS: ReplyItemsInput = {
  answerable: [
    { ref: "R1", kind: "wifi", hint: "wifi şifresi" },
    { ref: "R2", kind: "amenities", hint: "mangal var mı" },
  ],
  held: [],
};
const base: SuggestReplyInput = {
  guestMessage: "Wi-Fi şifresi nedir? Bir de mangal var mı?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  reservation: null,
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ LaleApt, şifre 12345678." }],
  history: [],
  tone: "warm",
  language: "tr",
};
const withItems: SuggestReplyInput = { ...base, conversationItems: ITEMS };

// Taban metnin katmanın değiştirdiği cümleleri (çapalar) — taban değişirse katman sessizce boşa düşmesin.
const OLD_NEVER_SKIP = "Soruyu yanıtsız bırakmak asla kabul edilmez.";
const OLD_NOT_SENT = "Bu durumda yazdığın metin misafire GÖNDERİLMEZ: ürün konuyu ev sahibine devreder ve misafir\n  standart teslim bildirimini alır.";
const OLD_RULE3 = 'Bilgi tabanında yoksa: "Bu bilgi kayıtlarımda yok." (';
const OLD_SILENT = "SESSİZCE ATLAMA";
const NEW_PER_REQUEST = "bu kural İSTEK BAŞINA uygulanır";
const NEW_ABSENCE_IS_CLAIM = '"bulunmuyor / sunmuyoruz / dahil değil / mevcut değil" de bir İDDİADIR';
const NEW_EXAMPLE = "ÖRNEK 2b — İki istekten birinin cevabı kaynaklarında YOK";
const BLOCK_RULE = "KAYNAK ŞARTI:";
const KB_NOTE = "Her kayıt YALNIZ kendi adını taşıdığı şey için geçerlidir";
const OLD_LENGTH = "HER BİRİNİ sırayla, kısa birer cümleyle yanıtla ve hiçbirini atlama.";
const NEW_LENGTH = "cevabı kaynaklarında olan HER BİRİNİ sırayla, kısa birer cümleyle yanıtla.";

afterEach(() => vi.unstubAllEnvs());
const quiet = () => {
  for (const k of OTHER_LAYERS) vi.stubEnv(k, "");
};

describe("anahtar — varsayılan KAPALI, yalnız tam '1' açar", () => {
  it.each(["", "0", "true", "yes", " 1", "1 "])("%j → kapalı", (v) => {
    vi.stubEnv(FLAG, v);
    expect(noSourceRuleEnabled()).toBe(false);
  });
  it("'1' → açık", () => {
    vi.stubEnv(FLAG, "1");
    expect(noSourceRuleEnabled()).toBe(true);
  });
});

describe("anahtar KAPALI — modele giden istem bayt bayt bugünkü", () => {
  it("sistem + kullanıcı istemi ve öğe bloğu: anahtar tanımsız / '0' / 'true' aynı; yeni metinlerin hiçbiri yok", () => {
    quiet();
    const unset = replyRequestIdentity(withItems);
    for (const v of ["0", "true"]) {
      vi.stubEnv(FLAG, v);
      const other = replyRequestIdentity(withItems);
      expect([v, other.system === unset.system, other.user === unset.user]).toEqual([v, true, true]);
    }
    for (const s of [NEW_PER_REQUEST, NEW_ABSENCE_IS_CLAIM, NEW_EXAMPLE]) expect(unset.system).not.toContain(s);
    for (const s of [BLOCK_RULE, KB_NOTE, NEW_LENGTH]) expect(unset.user).not.toContain(s);
    expect(unset.user).toContain(OLD_LENGTH);
    expect(unset.system).toContain(OLD_NEVER_SKIP);
    // Türetme bayrağı açıkça false verilince de taban türev aynı (katman anahtarı yalnız `noSourceRule`).
    expect(replySystemPromptFor({ ...off, itemsMode: true, noSourceRule: false })).toBe(replySystemPromptFor({ ...off, itemsMode: true }));
  });
});

describe("anahtar AÇIK — yalnız öğe kipinde", () => {
  it("🚨 öğe kipi DIŞINDA (istek defteri yok) istem bayt bayt aynı: atlanan soru iz bırakmadan kaybolmasın", () => {
    quiet();
    const before = replyRequestIdentity(base);
    vi.stubEnv(FLAG, "1");
    const after = replyRequestIdentity(base);
    expect(after.system).toBe(before.system);
    expect(after.user).toBe(before.user);
    expect(after.system).toContain(OLD_SILENT); // defterli olmayan yolda "sessizce atlama" kuralı yerinde (10-30 pini)
    expect(replySystemPromptFor({ ...off, noSourceRule: true })).toBe(REPLY_SYSTEM_PROMPT);
  });

  it("🚨 öğe kipinde sistem istemi: kural istek başına, yokluk hükmü de iddia, 'hiçbir soruyu atlama' kaynağı olanla sınırlı, çelişen cümleler gitti", () => {
    quiet();
    vi.stubEnv(FLAG, "1");
    const sys = replyRequestIdentity(withItems).system;
    expect(sys).toContain(NEW_PER_REQUEST);
    expect(sys).toContain(NEW_ABSENCE_IS_CLAIM);
    expect(sys).toContain("Başka bir şey hakkındaki kaydın değerini (mesafe, saat, ücret, koşul) sorulan şeye TAŞIMA");
    expect(sys).toContain("Cevabı kaynaklarında olan soruyu yanıtsız bırakma; cevabı kaynaklarında OLMAYAN soru için KURAL-5 geçerlidir");
    expect(sys).toContain("(cevabı kaynaklarında olmayan soru bunun DIŞINDADIR — KURAL-5)");
    expect(sys).toContain("Cevabı kaynaklarında AÇIKÇA yazmayan soru bu tabloyla puanlanmaz");
    expect(sys).toContain("Bilgi tabanında yoksa o isteği cevaplama — KURAL-5. (");
    expect(sys).toContain("(Bilgi YOKSA KURAL-5: o soruyu yazma.)");
    expect(sys).toContain(NEW_EXAMPLE);
    expect(sys).toContain('"answeredRequests":["R1"]}');
    // Çelişen eski cümleler: hiçbiri kalmadı.
    for (const old of [OLD_NEVER_SKIP, OLD_NOT_SENT, OLD_RULE3, "KURAL-3'teki tek cümleyi yaz", OLD_SILENT]) expect([old, sys.includes(old)]).toEqual([old, false]);
    // Yönlendirme yasağı katmanının cümlesi öğe kipine göre yeniden yazıldı (varsayılan açık katman).
    expect(sys).toContain("ev sahibine kalması gereken bir isteği (karar onun ya da bilgisi yok) cevaplama ve answeredRequests'e koyma");
    // Taban metinde çapaların hepsi duruyor.
    for (const anchor of [OLD_NEVER_SKIP, OLD_NOT_SENT, OLD_RULE3]) expect(REPLY_SYSTEM_PROMPT).toContain(anchor);
  });

  it("parça kipinde iki soruluk örnek eklenmez (çıktı biçimi farklı; `no_info` aynı işi görür), kuralın kendisi eklenir", () => {
    const parts = replySystemPromptFor({ ...off, itemsMode: true, itemsParts: true, hostContactBan: true, noSourceRule: true });
    expect(parts).toContain(NEW_PER_REQUEST);
    expect(parts).not.toContain(NEW_EXAMPLE);
    expect(replySystemPromptFor({ ...off, itemsMode: true, hostContactBan: true, noSourceRule: true })).toContain(NEW_EXAMPLE);
  });

  it("yönlendirme yasağı katmanı kapalıyken onun cümlesine bağlı çapa hiç aranmaz (eksik çapa yok)", () => {
    const sys = replySystemPromptFor({ ...off, itemsMode: true, noSourceRule: true });
    expect(sys).toContain(NEW_PER_REQUEST);
    expect(sys).not.toContain("cevaplama ve answeredRequests'e koyma — o istek ev sahibinde\n    açık kalır");
  });

  it("🚨 bütün anahtar birleşimlerinde türetme EKSİKSİZ (hiçbir çapa boşa düşmez)", () => {
    for (const [name, missing] of Object.entries(REPLY_SYSTEM_PROMPT_DERIVATION_MISSING())) expect([name, missing]).toEqual([name, []]);
  });

  it("sürüm kimliği anahtarla değişir (ölçüm raporu ve üretim izi hangi istemin koştuğunu ayırır); öğe kipi dışında değişmez", () => {
    quiet();
    const offItems = replyPromptVersion({ mode: true, held: false });
    const offPlain = replyPromptVersion({ mode: false, held: false });
    vi.stubEnv(FLAG, "1");
    expect(replyPromptVersion({ mode: true, held: false })).not.toBe(offItems);
    expect(replyPromptVersion({ mode: false, held: false })).toBe(offPlain);
  });
});

describe("kullanıcı istemi + öğe bloğu", () => {
  it("🚨 öğe kipinde: uzunluk ipucu kaynağı olan sorularla sınırlı, bilgi tabanı başlığı 'yazmıyorsa yok değildir' der, blokta KAYNAK ŞARTI var", () => {
    quiet();
    vi.stubEnv(FLAG, "1");
    const user = replyRequestIdentity(withItems).user;
    expect(user).toContain(NEW_LENGTH);
    expect(user).not.toContain(OLD_LENGTH);
    expect(user).toContain(KB_NOTE);
    expect(user).toContain('Burada YAZMAYAN bir şey için "var" da "yok" da deme');
    expect(user).toContain(BLOCK_RULE);
    expect(user).toContain("isteğin TÜRÜNE göre kuruldu");
    expect(user).toContain("o isteği CEVAPLAMA ve answeredRequests'e KOYMA");
  });

  it("öğe bloğu: kapalıyken eski biçim; açıkken kural bloğun SONUNDA; parça kipinde eklenmez", () => {
    const before = buildItemsPromptBlock(ITEMS);
    expect(before).not.toContain(BLOCK_RULE);
    vi.stubEnv(FLAG, "1");
    const on = buildItemsPromptBlock(ITEMS);
    expect(on.startsWith(before)).toBe(true);
    expect(on.slice(before.length)).toContain(BLOCK_RULE);
    expect(on.trimEnd().endsWith('"confidence" değerini yalnız YAZDIĞIN cevaba göre ver.')).toBe(true);
    expect(buildItemsPromptBlock({ ...ITEMS, parts: true })).not.toContain(BLOCK_RULE);
  });

  it("tek soruluk mesajda uzunluk ipucu değişmez (kural çok soruluk ipucuna bağlı)", () => {
    quiet();
    const single = { ...withItems, guestMessage: "Mangal var mı?" };
    const before = replyRequestIdentity(single).user;
    vi.stubEnv(FLAG, "1");
    const after = replyRequestIdentity(single).user;
    expect(after).not.toContain(NEW_LENGTH);
    // Fark yalnız başlık notu + blok kuralı.
    expect(after.replace(/\nHer kayıt YALNIZ[^\n]*\n[^\n]*/u, "").replace(/\nKAYNAK ŞARTI:[\s\S]*?cevaba göre ver\./u, "")).toBe(before);
  });
});

describe("🚨 ölçüm setlerinin konuları katman metninde YOK (teste öğretme yok)", () => {
  // Katmanın eklediği bütün metin: kaynak dosyalarından, katmanın kendi sabitleri okunur.
  const promptsSrc = readFileSync(path.resolve(__dirname, "../../src/lib/ai/prompts.ts"), "utf8");
  const blockSrc = readFileSync(path.resolve(__dirname, "../../src/lib/conversation-items/reply-block.ts"), "utf8");
  const layerText = [
    promptsSrc.slice(promptsSrc.indexOf("const NO_SOURCE_RULE_REPLACEMENTS"), promptsSrc.indexOf("export interface ReplyPromptFlags")),
    promptsSrc.slice(promptsSrc.indexOf("const NO_SOURCE_KB_NOTE"), promptsSrc.indexOf("const derivedPromptCache")),
    blockSrc.slice(blockSrc.indexOf("KAYNAK ŞARTI:"), blockSrc.indexOf("KAYNAK ŞARTI:") + 700),
  ].join("\n");
  it("anti-vakum: okunan metin katmanın kendisi", () => {
    expect(layerText).toContain("İSTEK BAŞINA");
    expect(layerText).toContain("KAYNAK ŞARTI");
    expect(layerText).toContain("Her kayıt YALNIZ");
  });
  // Geliştirme setlerinde "bilgi tabanında cevabı olmayan soru" olarak ölçülen konular (held-pet-unknown-dev · late-message-dev · luna-dev-2).
  it.each(["kahvaltı", "eczane", "market", "ütü", "bebek", "transfer", "kuaför", "saç kurutma", "spor salonu", "pharmacy", "breakfast", "iron"])(
    "%j geçmez",
    (topic) => {
      expect(layerText.toLocaleLowerCase("tr")).not.toContain(topic);
    },
  );
});
