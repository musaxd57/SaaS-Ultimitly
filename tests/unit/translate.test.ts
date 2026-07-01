import { describe, it, expect } from "vitest";
import { translateText } from "@/lib/ai/translate";

// In the test env OPENAI_API_KEY is empty, so translateText must degrade
// gracefully to returning the original text — never a dummy translation.
describe("translateText (no API key configured)", () => {
  it("returns the original text unchanged", async () => {
    const text = "Merhaba, Wi-Fi şifresi nedir?";
    expect(await translateText(text, "en")).toBe(text);
  });

  it("short-circuits when source equals target", async () => {
    const text = "Hello there";
    expect(await translateText(text, "en", "en")).toBe(text);
  });

  it("handles empty input without throwing", async () => {
    expect(await translateText("", "de")).toBe("");
    expect(await translateText("   ", "de")).toBe("   ");
  });
});
