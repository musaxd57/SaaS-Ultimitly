import { describe, it, expect } from "vitest";
import {
  CHUNK_MAX_CHARS,
  CHUNK_TARGET_CHARS,
  chunkItem,
  chunkKey,
  chunkText,
} from "@/lib/ai/retrieval/chunker";
import { longGuide } from "../helpers/kb-retrieval-scenarios";

const src = (content: string) => ({
  id: "kb_1",
  category: "general",
  title: "Rehber",
  content,
  updatedAt: new Date("2026-09-01T10:00:00Z"),
});

describe("chunker — deterministik, metni değiştirmez", () => {
  it("kısa kalem TEK parçadır ve metin BİREBİR aynıdır (legacy satırıyla parite)", () => {
    const text = "Bina altı otopark ücretsizdir.";
    const chunks = chunkItem(src(text));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].chunkCount).toBe(1);
  });

  it("tavan boyundaki kalem hâlâ tek parça; bir karakter üstü bölünür", () => {
    const sentence = "Bu bir cümledir. ";
    const atCap = sentence.repeat(Math.floor(CHUNK_MAX_CHARS / sentence.length)).trim();
    expect(chunkText(atCap)).toHaveLength(1);
    const over = `${atCap} Fazla cümle burada. ${"x".repeat(CHUNK_MAX_CHARS)}`;
    expect(chunkText(over).length).toBeGreaterThan(1);
  });

  it("uzun rehber cümle sınırında bölünür; her parça tavanın altında; HİÇBİR cümle kaybolmaz", () => {
    const guide = longGuide();
    const chunks = chunkText(guide);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      // Parça, kaynak metnin BİTİŞİK bir dilimidir (satır sonları dahil; yeniden yazma yok).
      expect(guide).toContain(c);
    }
    // Parçalar sıralı ve örtüşmez: birleşimi kaynağın kendisidir (aradaki boşluk hariç).
    expect(chunks.map((c) => c.trim()).join(" ").replace(/\s+/g, " ")).toBe(guide.replace(/\s+/g, " "));
    // Her cümle tam olarak bir parçada.
    const sentences = guide
      .split(/\n+/)
      .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9])/))
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sentences) {
      expect(chunks.filter((c) => c.includes(s)).length, s).toBe(1);
    }
    // Hedef boy civarında (çok küçük parça üretmez).
    const avg = chunks.reduce((n, c) => n + c.length, 0) / chunks.length;
    expect(avg).toBeGreaterThan(CHUNK_TARGET_CHARS * 0.5);
  });

  it("aynı girdi → aynı parçalar (kanıt `chunkIndex` ile atıf yapar)", () => {
    const a = chunkText(longGuide());
    const b = chunkText(longGuide());
    expect(a).toEqual(b);
  });

  it("boşluksuz devasa 'kelime' tavanda kesilir (patolojik girdi çökme yok)", () => {
    const giant = "a".repeat(CHUNK_MAX_CHARS * 3 + 17);
    const chunks = chunkText(giant);
    expect(chunks.join("")).toBe(giant);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("kısa kuyruk önceki parçaya yapışır (tek cümlelik parça üretilmez)", () => {
    const body = `${"Uzun bir cümle burada yer alıyor ve devam ediyor. ".repeat(14).trim()}\nSon.`;
    const chunks = chunkText(body);
    expect(chunks[chunks.length - 1].endsWith("Son.")).toBe(true);
    expect(chunks[chunks.length - 1].length).toBeGreaterThan(20);
  });

  it("parça anahtarı kalem kimliği + indeks", () => {
    const c = chunkItem(src(longGuide()));
    expect(chunkKey(c[2])).toBe("kb_1#2");
    expect(new Set(c.map(chunkKey)).size).toBe(c.length);
  });
});
