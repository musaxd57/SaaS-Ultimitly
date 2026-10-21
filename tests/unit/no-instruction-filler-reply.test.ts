import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// BAĞLANTI PİNİ (CLAUDE.md "yüklem var, argüman yok" dersi): `stripNoInstructionFiller` saf fonksiyon olarak doğru olsa da cevap yoluna
// bağlı değilse misafire yine "Çıkış için özel talimatımız yok, …" gider. `suggestReply` (kanal, QR, "AI öner", Ayarlar testi, demo hepsi
// buradan geçer) model cevabını silip döndürmeli — kodla selam açıkken de (selamdan ÖNCE silinir).
// ---------------------------------------------------------------------------
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { suggestReply } from "@/lib/ai";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import type { SuggestReplyInput } from "@/lib/ai/types";

const input: SuggestReplyInput = {
  guestMessage: "Çıkışta anahtarı ne yapayım?",
  property: { name: "Lale Daire", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
  reservation: { guestName: "Ayşe Yılmaz", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [{ category: "checkout", title: "Çıkış", content: "Anahtarı masaya bırakmanız yeterli." }],
  tone: "warm",
  language: "tr",
};

function modelSays(reply: string) {
  const content = {
    intent: "checkout",
    confidence: 0.95,
    reply,
    risk: null,
    priority: "standard",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: ["kb:checkout"],
    missingInfo: [],
    statedCheckoutTime: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), {
          status: 200,
        }),
    ),
  );
}

describe("suggestReply — 'talimat yok' yan cümlesi misafire yazılmaz (kurucu 10-17)", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 kurucunun örneği: yan cümle silinir, yönerge kalır", async () => {
    modelSays("Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.");
    const r = await suggestReply(input);
    expect(r.reply).toBe("Anahtarı masaya bırakmanız yeterli."); // ⬅️ ESKİDE yan cümle aynen gidiyordu
    expect(admitsMissingKnowledge(r.reply)).toBe(false);
  });

  it("kodla selam AÇIK: selam eklenir, yan cümle yine silinir", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    modelSays("Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.");
    const r = await suggestReply(input);
    expect(r.reply).toContain("Anahtarı masaya bırakmanız yeterli.");
    expect(r.reply).not.toMatch(/talimat/i);
  });

  it("cihaz bilgisizliği silinmez: cevap aynen döner ve 'bilgim yok' kuralı onu tutar", async () => {
    modelSays("Televizyonla ilgili ayrı bir talimatım bulunmuyor, ev sahibinize ileteceğim.");
    const r = await suggestReply(input);
    expect(r.reply).toBe("Televizyonla ilgili ayrı bir talimatım bulunmuyor, ev sahibinize ileteceğim.");
    expect(admitsMissingKnowledge(r.reply)).toBe(true);
  });

  // Kurucu T1 (10-21, aynen): "'Bilgimiz yok' cümlesini silmek, arkasındaki kanıtsız talimatı veya izni gönderilebilir hâle getirmeyecek."
  it.each([
    "Evcil hayvan için özel talimatımız yok, evcil hayvanlar kabul edilir.",
    "Çıkış için özel talimatımız yok, saat 14:00'e kadar kalabilirsiniz.",
    "Çıkış için özel talimatımız yok, kapıyı çekip çıkmanız yeterli.",
    "Çıkış için özel talimatımız yok. Depozito iadesi 3 gün içinde yapılır.",
  ])("🚨 kurucu T1: bilgi tabanında dayanağı olmayan kalan yönerge silme ile gönderilebilir OLMAZ — %s", async (text) => {
    modelSays(text);
    const r = await suggestReply(input); // bilgi tabanında yalnız "Anahtarı masaya bırakmanız yeterli."
    expect(r.reply).toBe(text); // ⬅️ 10-17 silicisi kalan uydurmayı misafire gönderilebilir yapıyordu
    expect(admitsMissingKnowledge(r.reply)).toBe(true);
  });

  it("kurucu T1 KONTROL: kalan yönerge bilgi tabanında AYNEN varsa silme bugünkü gibi; nezaket cümlesi şartın dışında", async () => {
    modelSays("Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. İyi yolculuklar!");
    const r = await suggestReply(input);
    expect(r.reply).toBe("Anahtarı masaya bırakmanız yeterli. İyi yolculuklar!");
    expect(admitsMissingKnowledge(r.reply)).toBe(false);
  });

  it("KONTROL: 'talimat yok' taşımayan cevap değişmez", async () => {
    modelSays("Anahtarı masaya bırakmanız yeterli, iyi yolculuklar.");
    const r = await suggestReply(input);
    expect(r.reply).toBe("Anahtarı masaya bırakmanız yeterli, iyi yolculuklar.");
  });
});
