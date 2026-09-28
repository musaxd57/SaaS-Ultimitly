import { describe, it, expect, afterEach, vi } from "vitest";
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
// ADSIZ YAPAY ZEKÂ + KODLA SELAM — ÜCRETSİZ KANIT (Codex şartı, 09-28): kanarya ad (tam ad, hitap adı ya da türevi) HİÇBİR model
// isteğine girmez — sohbet geçmişindeki kendi selamımız dahil (ikinci tur, R1); selam yalnız ilk cevapta ve tek; anahtar kapalıyken
// istem eskisi gibi. Model çağrısı sahte `fetch` ile yakalanır; ağa çıkılmaz, ücretli değil.
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

  it("🚨 R2: güvenlik sözcüğü taşıyan ad SİLME ANAHTARI olmaz — 'yangın' modele gider", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const bodies = captureModel();
    await suggestReply(
      baseInput({
        reservation: { ...baseInput().reservation!, guestName: "Yangın Kaya", guestGivenName: "Yangın" },
        guestIdentifier: "Yangın Kaya",
        guestMessage: "Dairede yangın var!",
        history: [],
      }),
    );
    expect(bodies[0]).toContain("Dairede yangın var!");
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
