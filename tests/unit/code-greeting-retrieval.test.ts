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
});
