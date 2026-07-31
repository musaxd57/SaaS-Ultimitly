import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { reportError } from "@/lib/report-error";
import { countGuestAsks, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReportError = vi.mocked(reportError);

const baseInput = (guestMessage: string): SuggestReplyInput => ({
  guestMessage,
  property: {
    name: "Galata Loft",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    address: "Galata",
    city: "İstanbul",
  },
  reservation: {
    guestName: "John Smith",
    arrivalDate: new Date("2026-08-01"),
    departureDate: new Date("2026-08-05"),
    status: "confirmed",
  },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
});

// ---------------------------------------------------------------------------
// ÇOK-SORULU MESAJ (denetim 07-31).
//
// Bulunan çelişki: misafir "saat kaçta çıkış / nasılsınız / çöp nerde" gibi kısa
// bloklar hâlinde 6 soru sorduğunda toplam kelime sayısı ~20-30 kalıyordu →
// uzunluk ipucu ORTA dala düşüp modele "2-4 cümle" diyordu. Üstüne "tek konu,
// tek mesaj" kuralı öncelik listesinde ÜSTTEYDİ. Yani modele soruyu ATLAMAYI
// söyleyen kural, hepsini yanıtlamayı söyleyenden güçlüydü.
//
// Bu dosya iki şeyi pinler: sayım doğru mu, ve istem gerçekten uzunluk kuralını
// ezen talimatı taşıyor mu.
// ---------------------------------------------------------------------------
describe("countGuestAsks — soru işareti OLMADAN da ayrı istekleri sayar", () => {
  it("satır satır yazılmış, işaretsiz sorular tek tek sayılır", () => {
    // Kullanıcının verdiği gerçek örnek — hiçbir soru işareti yok.
    expect(countGuestAsks("saat kaçta çıkış var\nnasılsınız\nçöp nerde")).toBe(3);
  });

  it("tek satırda üst üste sorulan işaretli sorular sayılır", () => {
    expect(countGuestAsks("wifi şifresi ne, çöpü nereye atıyoruz? geç çıkış olur mu?")).toBe(2);
  });

  it("iki sinyalin BÜYÜĞÜ alınır (satır sayısı vs soru işareti)", () => {
    // 4 satır ama 2 soru işareti → 4.
    expect(countGuestAsks("merhaba\nçıkış saati?\nçöp?\notopark var mı")).toBe(4);
  });

  it("normal tek satırlık mesaj 1 döner — tipik mesajın davranışı DEĞİŞMEZ", () => {
    expect(countGuestAsks("Wifi şifresi nedir?")).toBe(1);
    expect(countGuestAsks("merhaba")).toBe(1);
  });

  it("boş mesaj 0 döner (sıfıra bölme/negatif yok)", () => {
    expect(countGuestAsks("   ")).toBe(0);
  });

  it("satır arasındaki boşluklar ayrı istek sayılmaz", () => {
    expect(countGuestAsks("çıkış saati kaçta\n\n\nçöp nerede")).toBe(2);
  });
});

describe("istem, çok-soruluda uzunluk kuralını EZİYOR", () => {
  it("çok-soruluda 'HER BİRİNİ' talimatı ve kural iptali istemde var", () => {
    const prompt = buildReplyUserPrompt(
      baseInput("saat kaçta çıkış var\nnasılsınız\nçöp nerde\nwifi şifresi neydi"),
    );
    expect(prompt).toContain("4 ayrı konu/soru");
    expect(prompt).toContain("HER BİRİNİ");
    // Çelişen iki kuralın adı geçmeli ki model hangisinin düştüğünü bilsin.
    expect(prompt).toContain("GEÇERSİZDİR");
    // Liste yasağı çok-soruluda da sürüyor (üslup korunur).
    expect(prompt).toContain("madde işareti kullanma");
  });

  it("TEK soruluda eski uzunluk ipucu aynen korunur (regresyon pini)", () => {
    // 5-39 kelime arası tek satır → ORTA dal. (3 kelimelik mesaj kısa dala düşer.)
    const prompt = buildReplyUserPrompt(
      baseInput("Merhaba, dairenin wifi şifresini bir daha yazabilir misiniz acaba"),
    );
    expect(prompt).toContain("dengeli bir cevap ver");
    expect(prompt).not.toContain("ayrı konu/soru");
  });

  it("çok kısa mesajın 1-2 cümle ipucu bozulmadı", () => {
    const prompt = buildReplyUserPrompt(baseInput("wifi?"));
    expect(prompt).toContain("1-2 cümlelik");
  });
});

describe("sistem istemindeki çelişki kapandı", () => {
  it("'tek konu, tek mesaj' artık istisnasını söylüyor", async () => {
    const { REPLY_SYSTEM_PROMPT } = await import("@/lib/ai/prompts");
    const idx = REPLY_SYSTEM_PROMPT.indexOf("tek konu, tek mesaj");
    expect(idx).toBeGreaterThan(-1);
    // İstisna, kuralın hemen ardında olmalı — başka bir bölümde kaybolmamalı.
    expect(REPLY_SYSTEM_PROMPT.slice(idx, idx + 400)).toContain("İSTİSNA");
  });

  it("çok-soruluyu gösteren bir eğitim örneği var (blok blok, işaretsiz)", async () => {
    const { REPLY_SYSTEM_PROMPT } = await import("@/lib/ai/prompts");
    expect(REPLY_SYSTEM_PROMPT).toContain("ÖRNEK 24");
    expect(REPLY_SYSTEM_PROMPT).toContain("ÇOK SORULU");
  });
});

// ---------------------------------------------------------------------------
// KARAKTER TAVANI — sessiz kesme kapatıldı.
//
// İki farklı "2000" vardı ve yalnız biri güvenliydi:
//  · max_completion_tokens=2000 → finish_reason=length → fallback → kapı reddeder ✅
//  · reply.slice(0,2000)        → TAM ve geçerli JSON, ama metin cümlenin
//    ortasından kesiliyor ve `source` hâlâ "openai" olduğu için kapı bu YARIM
//    mesajı otomatik gönderebiliyordu ❌ (log yok, alarm yok)
// ---------------------------------------------------------------------------
describe("uzun model yanıtı sessizce kesilip gönderilemez", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
    mockReportError.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const respond = (reply: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      intent: "wifi",
                      confidence: 0.95,
                      reply,
                      priority: "standard",
                      riskLevel: "none",
                      detectedLanguage: "tr",
                    }),
                  },
                },
              ],
            }),
          ),
      ),
    );

  it("tavanı AŞAN yanıt otomatik gönderilemez: güven 0.5'e kısılır ve rapor edilir", async () => {
    respond("A".repeat(4500));
    const result = await suggestReply(baseInput("Wifi şifresi nedir?"));

    expect(result.source).toBe("openai");
    // Kapı confidence >= 0.75 ister → 0.5 gönderimi bloklar, taslak host'ta kalır.
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.reply.length).toBe(4000);
    expect(mockReportError).toHaveBeenCalled();
    expect(mockReportError.mock.calls.some((c) => String(c[0]).includes("char cap"))).toBe(true);
  });

  it("tavanın ALTINDAKİ normal yanıt hiç etkilenmez (güven korunur, kesme yok)", async () => {
    const body = "Wi-Fi ağı NuveApt, şifresi 12345678.";
    respond(body);
    const result = await suggestReply(baseInput("Wifi şifresi nedir?"));

    expect(result.source).toBe("openai");
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.reply).toBe(body);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("6 soruluk gerçekçi bir cevap tavanın ÇOK altında kalır (tavan meşru cevabı kesmez)", async () => {
    // Kullanıcının senaryosu: 6 sorunun tam cevabı ~400-900 karakter.
    const realistic =
      "Merhaba, iyiyiz, teşekkür ederiz. Çıkış saatimiz 11:00. Çöpü zemin kattaki yeşil " +
      "konteynere bırakabilirsiniz. Wi-Fi ağı NuveApt, şifresi 12345678. Otopark için bina " +
      "altındaki ücretsiz misafir otoparkını kullanabilirsiniz. Havlular banyodaki dolapta.";
    expect(realistic.length).toBeLessThan(2000);
    respond(realistic);
    const result = await suggestReply(baseInput("çıkış\nçöp\nwifi\notopark\nhavlu\nnasılsınız"));
    expect(result.reply).toBe(realistic);
    expect(result.confidence).toBeCloseTo(0.95);
  });
});
