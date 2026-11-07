import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  CODE_GREETING_PROMPT_DERIVATION,
  REPLY_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT_CODE_GREETING,
  buildReplyPrompt,
} from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import { suggestReplyFallback } from "@/lib/ai/fallback";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ + KODLA SELAM — ÜCRETSİZ KANIT (Codex şartı, 09-28; kural 09-30): kanarya ad KİMLİK konumlarında (tam ad, misafirin
// "ben X" / "adım X" / imzası, bizim hitabımız, geçmişteki kendi selamımız — ikinci tur, R1) HİÇBİR model isteğine girmez; adla
// çakışan anlamlı sözcük ("Deniz manzarası") silinmez — tam gizlilik iddiası yok (kurucu kararı). Selam yalnız ilk cevapta ve tek;
// anahtar kapalıyken istem eskisi gibi. Model çağrısı sahte `fetch` ile yakalanır; ağa çıkılmaz, ücretli değil.
// ---------------------------------------------------------------------------

const GIVEN = "Zqxwvu";
const FULL = "Zqxwvu Kanaryaoglu";
const CANARY_PARTS = ["zqxwvu", "kanaryaoglu"];

function baseInput(over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage: `Merhaba, ben ${FULL}. Wi-Fi şifresi nedir?`,
    property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
    reservation: {
      guestName: FULL,
      guestGivenName: GIVEN,
      arrivalDate: new Date("2026-09-24T12:00:00Z"),
      departureDate: new Date("2026-09-30T12:00:00Z"),
      status: "confirmed",
    },
    guestIdentifier: FULL,
    knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ Lale-5G, şifre Lale2025." }],
    history: [
      { direction: "inbound", body: `Merhaba, ben ${FULL}, bugün geliyoruz.` },
      { direction: "outbound", body: `Merhaba ${GIVEN},\n\nGirişiniz 15:00'ten itibaren.` },
    ],
    conversationState: { isFirstOperatorReply: false },
    tone: "warm",
    language: "tr",
    now: new Date("2026-09-25T10:00:00Z"),
    ...over,
  };
}

const MODEL = {
  intent: "wifi",
  stayChangeAsked: "none",
  confidence: 0.92,
  reply: "Merhaba! Wi-Fi ağı Lale-5G, şifre Lale2025.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  usedSources: ["kb:wifi", "reservation:guestName"],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
};

/** Sahte model: istek gövdelerini toplar. */
function captureModel(content: Record<string, unknown> = MODEL) {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), {
        status: 200,
      });
    }),
  );
  return bodies;
}

const leaks = (text: string) => CANARY_PARTS.filter((p) => text.toLocaleLowerCase("tr").includes(p));

/** İstek gövdesinin YALNIZ kullanıcı mesajı (sistem istemi "yangın" gibi sözcükleri kendi kurallarında taşır). */
function userContent(body: string): string {
  const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
  return parsed.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

// Normal takım anahtarı ZORLA boşaltır; sahte model yolu için test anahtarı (ağa çıkılmaz — `fetch` sahte).
beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("türetilmiş istemler (anahtar açıkken kullanılan)", () => {
  it("🚨 her çapa bulundu — istem değişince sessizce kaymaz", () => {
    expect(CODE_GREETING_PROMPT_DERIVATION.systemMissing).toEqual([]);
    for (const [tone, missing] of Object.entries(CODE_GREETING_PROMPT_DERIVATION.toneMissing)) expect([tone, missing]).toEqual([tone, []]);
  });

  it("sistem isteminde örnek selamlar ve ad kaynağı YOK; örnek sayısı aynı", () => {
    const s = REPLY_SYSTEM_PROMPT_CODE_GREETING;
    for (const gone of ["Merhaba Ayşe", "Hi John", "Hallo Anna", "reservation:guestName", "selamlama tercih et", "İsimle hitabı"]) {
      expect([gone, s.includes(gone)]).toEqual([gone, false]);
    }
    expect(s).toContain("Selam satırı YAZMA");
    expect(s.split('"reply":"').length).toBe(REPLY_SYSTEM_PROMPT.split('"reply":"').length);
  });
});

describe("anahtar KAPALI — istem ve cevap eskisi gibi", () => {
  it("🚨 yeni alanlar (hitap adı / görünen ad) istemi DEĞİŞTİRMEZ; ad eskisi gibi istemde", () => {
    const withNew = buildReplyPrompt(baseInput()).text;
    const withoutNew = buildReplyPrompt(
      baseInput({ guestIdentifier: undefined, reservation: { ...baseInput().reservation!, guestGivenName: undefined } }),
    ).text;
    expect(withNew).toBe(withoutNew);
    expect(withNew).toContain(`Misafir: ${FULL}`);
  });

  it("KONTROL — model isteğinde ad VAR (kanarya testinin anlamlı olduğunun kanıtı); cevap modelinki", async () => {
    const bodies = captureModel();
    const r = await suggestReply(baseInput());
    expect(leaks(bodies.join("\n")).length).toBeGreaterThan(0);
    expect(r.reply).toBe(MODEL.reply);
  });
});

describe("anahtar AÇIK — ad hiçbir model isteğine girmez, selamı kod ekler", () => {
  it("🚨 kanarya: tam ad, hitap adı ve geçmişteki kendi selamımız (ikinci tur) isteğe GİRMEZ", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(baseInput());
    expect(bodies.length).toBe(1);
    expect(leaks(bodies.join("\n"))).toEqual([]);
    expect(bodies[0]).toContain("[Misafir]");
  });

  it("🚨 ilk cevap: 'Merhaba Zqxwvu,' + gövde (modelin 'Merhaba!' selamı silindi — tek selam)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel();
    const r = await suggestReply(baseInput({ conversationState: { isFirstOperatorReply: true }, history: [] }));
    expect(r.reply).toBe(`Merhaba ${GIVEN},\n\nWi-Fi ağı Lale-5G, şifre Lale2025.`);
  });

  it("🚨 sonraki cevap: selam YOK", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel();
    const r = await suggestReply(baseInput());
    expect(r.reply).toBe("Wi-Fi ağı Lale-5G, şifre Lale2025.");
  });

  it("🚨 model adı görmediği için 'reservation:guestName' kaynak beyanı doğrulanmaz", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel();
    expect((await suggestReply(baseInput())).usedSources).toEqual(["kb:wifi"]);
  });

  it("🚨 R1: saldırgan hitap adı ('Otopark-Ücretsiz') geçmişteki selamımızla da modele dönmez", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Otopark-Ücretsiz Yılmaz", guestGivenName: "Otopark-Ücretsiz" },
        guestIdentifier: "Otopark-Ücretsiz Yılmaz",
        guestMessage: "Otopark ücretli mi?",
        history: [{ direction: "outbound", body: "Merhaba Otopark-Ücretsiz,\n\nGirişiniz 15:00'ten itibaren." }],
      }),
    );
    expect(bodies[0]).not.toContain("Otopark-Ücretsiz");
    expect(bodies[0]).toContain("Otopark ücretli mi?"); // misafirin sorusu SİLİNMEZ (tam sözcük eşleşmesi değil)
  });

  // R2 (Codex önerisi 09-28) → KURAL 09-30 (kurucu kararı): ad YALNIZ kimlik konumunda maskelenir; anlamlı sözcük silinmez. Adı
  // "Yangın Kaya" olan misafirin "Dairede yangın var" mesajı modele AYNEN gider (acil sözcüğü görünür, not gerekmez). Not yalnız
  // kimlik konumundaki maske bir acil sözcüğünü gizlediğinde ("Ben Yangın, …" — ad mı olay mı belirsiz → güvenli taraf).
  const YANGIN = {
    reservation: { ...baseInput().reservation!, guestName: "Yangın Kaya", guestGivenName: "Yangın" },
    guestIdentifier: "Yangın Kaya",
    history: [],
  };

  it("🚨 'Dairede yangın var' (ad 'Yangın Kaya'): acil sözcüğü modele GİDER (silinmez), kod notu gerekmez", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(baseInput({ ...YANGIN, guestMessage: "Dairede yangın var!" }));
    const user = userContent(bodies[0]).toLocaleLowerCase("tr");
    expect(user).toContain("dairede yangın var!");
    expect(user).not.toContain("kod notu");
    expect(user).not.toContain("kaya");
  });

  it("🚨 R2 'Merhaba, adım Yangın Kaya' (adın kendisi): ad silinir, olay SANILMAZ — KOD NOTU YOK", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(baseInput({ ...YANGIN, guestMessage: "Merhaba, adım Yangın Kaya. Wi-Fi şifresi nedir?" }));
    const user = userContent(bodies[0]).toLocaleLowerCase("tr");
    expect(user).toContain("merhaba, adım [misafir]. wi-fi şifresi nedir?");
    expect(user).not.toContain("kod notu");
    expect(user).not.toContain("yangın");
  });

  it("R2 kimlik konumundaki maske acil sözcüğünü gizlerse not; geçmişte cevapsız mesaj sayılır, cevaplanmış eski mesaj SAYILMAZ", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    let bodies = captureModel();
    await suggestReply(
      baseInput({ ...YANGIN, history: [{ direction: "inbound", body: "Ben Yangın, mutfakta duman var" }], guestMessage: "Lütfen acele edin" }),
    );
    expect(userContent(bodies[0])).toContain("KOD NOTU (kesin)");
    bodies = captureModel();
    await suggestReply(
      baseInput({
        ...YANGIN,
        history: [
          { direction: "inbound", body: "Ben Yangın, dün mutfakta duman vardı" },
          { direction: "outbound", body: "Geçmiş olsun, ekip ilgilendi." },
        ],
        guestMessage: "Wi-Fi şifresi nedir?",
      }),
    );
    expect(userContent(bodies[0])).not.toContain("KOD NOTU");
  });

  it("🚨 kurucu kararı 09-30: adla çakışan anlamlı sözcük silinmez ('Deniz manzarası', '15 Nisan'); kimlik ifadesi maskelenir", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    let bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Deniz Kaya", guestGivenName: "Deniz" },
        guestIdentifier: "Deniz Kaya",
        history: [
          { direction: "inbound", body: "Merhaba, ben Deniz, yarın geliyoruz." },
          { direction: "outbound", body: "Merhaba Deniz,\n\nGirişiniz 15:00'ten itibaren." },
        ],
        guestMessage: "Deniz manzarası var mı?",
      }),
    );
    let user = userContent(bodies[0]);
    expect(user).toContain("Deniz manzarası var mı?");
    expect(user).toContain("Merhaba, ben [Misafir], yarın geliyoruz.");
    expect(user).not.toContain("Merhaba Deniz");
    bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Nisan Er", guestGivenName: "Nisan" },
        guestIdentifier: "Nisan Er",
        history: [],
        guestMessage: "15 Nisan'da gelebilir miyiz? Adım Nisan Er.",
      }),
    );
    user = userContent(bodies[0]);
    expect(user).toContain("15 Nisan'da gelebilir miyiz? Adım [Misafir].");
  });

  it("🚨 bizim geçmiş mesajımızda selam satırı DIŞINDAKİ hitap da maskelenir ('Deniz Hanım, …'); misafir satırında aynı biçim değil", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Deniz Kaya", guestGivenName: "Deniz" },
        guestIdentifier: "Deniz Kaya",
        history: [
          { direction: "inbound", body: "Deniz Hanım bizimle mi kalacak?" },
          { direction: "outbound", body: "Deniz Hanım, girişiniz 15:00'ten itibaren." },
        ],
        guestMessage: "Otopark var mı?",
      }),
    );
    const user = userContent(bodies[0]);
    expect(user).toContain("[Misafir] Hanım, girişiniz 15:00'ten itibaren.");
    expect(user).toContain("Deniz Hanım bizimle mi kalacak?");
  });

  it("anahtar KAPALIYKEN not yok, istem bugünkü gibi (ad ve mesaj aynen)", async () => {
    const bodies = captureModel();
    await suggestReply(baseInput({ ...YANGIN, guestMessage: "Dairede yangın var!" }));
    const user = userContent(bodies[0]);
    expect(user).toContain("Dairede yangın var!");
    expect(user).not.toContain("KOD NOTU");
  });

  it("resmî tonda da 'Merhaba Zqxwvu,'; kısa tonda selam yok; İngilizce misafire 'Hello Zqxwvu,'", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel({ ...MODEL, reply: "Wi-Fi ağı Lale-5G." });
    const first = { conversationState: { isFirstOperatorReply: true }, history: [] };
    expect((await suggestReply(baseInput({ ...first, tone: "formal" }))).reply).toBe(`Merhaba ${GIVEN},\n\nWi-Fi ağı Lale-5G.`);
    expect((await suggestReply(baseInput({ ...first, tone: "short" }))).reply).toBe("Wi-Fi ağı Lale-5G.");
    captureModel({ ...MODEL, reply: "Hi there! The Wi-Fi network is Lale-5G.", detectedLanguage: "en" });
    expect((await suggestReply(baseInput({ ...first, guestMessage: "Hi, what is the Wi-Fi password please?" }))).reply).toBe(
      `Hello ${GIVEN},\n\nThe Wi-Fi network is Lale-5G.`,
    );
  });

  it("kanalın ayrı adı yoksa selam adsız ('Merhaba,') — ilk kelime tahmini YOK", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel();
    const r = await suggestReply(
      baseInput({
        conversationState: { isFirstOperatorReply: true },
        history: [],
        reservation: { ...baseInput().reservation!, guestGivenName: null },
      }),
    );
    expect(r.reply).toBe("Merhaba,\n\nWi-Fi ağı Lale-5G, şifre Lale2025.");
  });

  it("yedek şablon (model çalışmazken) aynı hitap kuralı: kanal adı yoksa 'Merhaba,'", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const noGiven = baseInput({ reservation: { ...baseInput().reservation!, guestGivenName: null } });
    expect(suggestReplyFallback({ ...noGiven, guestMessage: "Giriş saati nedir?" }).reply).toMatch(/^Merhaba,/);
    expect(suggestReplyFallback({ ...baseInput(), guestMessage: "Giriş saati nedir?" }).reply).toMatch(new RegExp(`^Merhaba ${GIVEN},`));
  });
});

describe("anahtar AÇIK — bağlantıların her parçası (mutasyon pinleri)", () => {
  it("🚨 istem: selam kuralı yerine 'selam yazma' kuralı + GÖREV satırı; adıyla selam / 'Sayın' kalmaz", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const warm = buildReplyPrompt(baseInput()).text;
    expect(warm).not.toContain("misafiri adıyla selamla");
    expect(warm).toContain("SELAM: reply selam / hitapla BAŞLAMAZ");
    expect(warm).toContain("Cevaba selam ya da hitapla BAŞLAMA");
    expect(buildReplyPrompt(baseInput({ tone: "formal" })).text).not.toContain('"Sayın" hitabıyla başla');
    expect(buildReplyPrompt(baseInput({ tone: "luxury" })).text).not.toContain("isim yalnızca mesajın başında");
  });

  it("🚨 modele giden SİSTEM istemi türetilmiş olan (örnek selamlar yok)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(baseInput());
    expect(bodies[0]).not.toContain("Merhaba Ayşe");
    expect(bodies[0]).toContain("Selam satırı YAZMA");
  });

  it("🚨 hitap adı tam adın ilk sözcüğü DEĞİLSE de silinir (soyad önde yazılmış ad)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Kanaryaoglu Zqxwvu", guestGivenName: GIVEN },
        guestIdentifier: "Kanaryaoglu Zqxwvu",
      }),
    );
    expect(leaks(bodies.join("\n"))).toEqual([]);
  });

  it("🚨 rezervasyonsuz konuşmada görünen ad da silinir", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(baseInput({ reservation: null }));
    expect(leaks(bodies.join("\n"))).toEqual([]);
  });

  it("🚨 yer tutucu ve anonim adlar SİLME ANAHTARI olmaz ('rezervasyon' / 'eski' sözcükleri kalır)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Rezervasyon HM4K2", guestGivenName: null },
        guestIdentifier: "Eski misafir",
        guestMessage: "Rezervasyon numaram HM4K2, eski odamızı sorabilir miyim?",
        history: [],
      }),
    );
    expect(bodies[0]).toContain("Rezervasyon numaram HM4K2, eski odamızı sorabilir miyim?");
  });

  it("ilk cevap bilgisi yoksa (tek mesajlık önizleme) ilk cevap sayılır — selam eklenir", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel();
    const r = await suggestReply(baseInput({ conversationState: undefined, history: [] }));
    expect(r.reply).toBe(`Merhaba ${GIVEN},\n\nWi-Fi ağı Lale-5G, şifre Lale2025.`);
  });

  it("🚨 geçmişteki KODUN selam satırı istemden çıkar — silme anahtarı olamayan kısa ad ('Su') modele dönmez (09-28 inceleme)", () => {
    const input = baseInput({
      reservation: { ...baseInput().reservation!, guestName: "Su Kanaryaoglu", guestGivenName: "Su" },
      guestIdentifier: "Su Kanaryaoglu",
      history: [
        { direction: "inbound", body: "Hola,\n\nLlegamos hoy." }, // misafirin KENDİ selam satırı: dokunulmaz (yalnız bizim giden mesajımız)
        { direction: "outbound", body: "Merhaba Su,\n\nGirişiniz 15:00'ten itibaren." },
      ],
    });
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const on = buildReplyPrompt(input).text;
    expect(on).not.toContain("Merhaba Su");
    expect(on).toContain("Girişiniz 15:00'ten itibaren.");
    expect(on).toContain("[MİSAFİR]: Hola,\n\nLlegamos hoy.");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    expect(buildReplyPrompt(input).text).toContain("Merhaba Su,"); // anahtar kapalı: geçmiş aynen
  });

  it("🚨 GÖREV satırı '[Misafir]' işaretini açıklar; üslup rehberi selamı EMREDEMEZ (anahtar kapalıyken eski cümle)", () => {
    const input = baseInput({ styleProfile: "Her mesaja 'Merhaba [isim]' ile başlar, samimi yazar." });
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const on = buildReplyPrompt(input).text;
    expect(on).toContain('"[Misafir]" misafirin gizlenmiş adıdır — cevapta YAZMA');
    expect(on).toContain("rehber selam ya da hitaptan söz etse de selam / hitap YAZMA");
    expect(on).not.toContain("Üslubunu (selamlama/kapanış");
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    const off = buildReplyPrompt(input).text;
    expect(off).toContain("Üslubunu (selamlama/kapanış, uzunluk, samimiyet, emoji) bu tarza uydur.");
    expect(off).not.toContain("[Misafir]");
  });

  it("selam dili: kodun KESİN tespiti modelin beyanından önce gelir (model 'en' dese de Türkçe misafire 'Merhaba')", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureModel({ ...MODEL, detectedLanguage: "en", reply: "Wi-Fi ağı Lale-5G." });
    const r = await suggestReply(
      baseInput({ conversationState: { isFirstOperatorReply: true }, history: [], guestMessage: "Merhaba, Wi-Fi şifresini öğrenebilir miyim lütfen?" }),
    );
    expect(r.reply).toBe(`Merhaba ${GIVEN},\n\nWi-Fi ağı Lale-5G.`);
  });
});

