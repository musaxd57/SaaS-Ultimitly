import { describe, it, expect, afterEach, vi } from "vitest";
import { namelessRetrievalInput } from "@/lib/ai/kb-retrieve";

// ADSIZ YAPAY ZEKÂ — getirme girdisi (sözcüksel arama + GÖMME sorguları) anahtar açıkken adsız; kapalıyken AYNI nesne döner.
afterEach(() => vi.unstubAllEnvs());

const input = {
  items: [],
  guestMessage: "Ben Zqxwvu Kanaryaoglu, Wi-Fi?",
  history: [{ direction: "inbound" as const, body: "Merhaba, ben Zqxwvu." }],
};

describe("getirme girdisi", () => {
  it("anahtar kapalı → girdi AYNEN (aynı nesne)", () => {
    expect(namelessRetrievalInput(input as never, ["Zqxwvu Kanaryaoglu"])).toBe(input);
  });

  it("🚨 anahtar açık → güncel mesaj VE geçmiş adsız (ince soruda geçmiş gömme sorgusuna girer)", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const out = namelessRetrievalInput(input as never, ["Zqxwvu Kanaryaoglu"]) as typeof input;
    expect(out.guestMessage).toBe("Ben [Misafir], Wi-Fi?");
    expect(out.history[0].body).toBe("Merhaba, ben [Misafir].");
  });

  it("🚨 kural 09-30: geçmişte BİZİM satırımızda hitap maskelenir, misafirin satırında aynı biçim anlamlı sözcüktür (kaldırılmaz)", () => {
    // Getirme girdisi anlama katmanına da taşınır; her tüketici yazarına göre maskelenmiş geçmişi görür (katman kendi maskesini de
    // uygular — iki kat güvence; yeni bir tüketici geçmişi doğrudan kullanırsa ad yine yazarına göre kapalıdır).
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const out = namelessRetrievalInput(
      {
        items: [],
        guestMessage: "Deniz manzarası var mı?",
        history: [
          { direction: "outbound" as const, body: "Deniz Hanım, giriş 15:00." },
          { direction: "inbound" as const, body: "Deniz Hanım bizimle mi?" },
        ],
      } as never,
      ["Deniz Kaya"],
    ) as { guestMessage: string; history: { body: string }[] };
    expect(out.guestMessage).toBe("Deniz manzarası var mı?");
    expect(out.history[0].body).toBe("[Misafir] Hanım, giriş 15:00.");
    expect(out.history[1].body).toBe("Deniz Hanım bizimle mi?");
  });
});
