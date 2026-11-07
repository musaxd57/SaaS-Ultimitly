import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 🚨 EĞİTİM / DIŞA AKTARMA YASAĞI (kurucu talimatı 09-07 + tasarım `docs/TASARIM-2026-10-09-migration-paketi-60.md` §D):
// üretim izi (`AiGeneration`) ve kurucu etiketleri (`AiReviewLabel`) hiçbir dışa aktarma / ince ayar / raporlama yoluna bağlanmaz.
// Prisma temsilcisine dokunan modüller KAPALI listededir; yeni bir okuyucu bu testi kırar ve bilinçli karar ister.
// Dosya sistemi taraması (git'e bağlı değil); kapsam src/ + scripts/ (testler ve belgeler hariç).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

/**
 * Kurucu kalite konsolu (salt-okuma + etiket) · yazıcı · saklama süpürgesi · misafir silmesi · konuşma birleştirme (iz taşınır) ·
 * paneldeki tekrarlanan konuşma temizliği (10-10: kaybeden silinmeden önce iz kazanana TAŞINIR — yalnız `conversationId` güncellenir,
 * içerik okunmaz / dışa verilmez; toplu birleştirme betiğiyle aynı gerekçe).
 */
const ALLOWED = [
  "scripts/apply-conversation-dedupe.ts",
  "src/lib/ai-quality/console.ts",
  "src/lib/ai/generation-trace.ts",
  "src/lib/conversations-cleanup.ts",
  "src/lib/data-retention.ts",
  "src/lib/erasure.ts",
].sort();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const READER = /\b(?:prisma|db|tx|client)\s*\.\s*(?:aiGeneration|aiReviewLabel)\b|\$queryRaw[\s\S]{0,200}"Ai(?:Generation|ReviewLabel)"/;

describe("AiGeneration / AiReviewLabel okuyucuları kapalı liste", () => {
  const files = ["src", "scripts"].flatMap((d) => walk(path.join(ROOT, d)));

  it("tarama boş değil (kendini boşa düşürmesin)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join("src", "lib", "erasure.ts")))).toBe(true);
  });

  it("tablolara dokunan modüller = izin listesi", () => {
    const hits = files
      .filter((f) => READER.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(hits).toEqual(ALLOWED);
  });

  it("dedektör tipik erişim biçimlerini yakalar", () => {
    for (const s of ["prisma.aiGeneration.findMany(", "db . aiReviewLabel.create(", "tx.aiGeneration.updateMany(", 'prisma.$queryRaw`SELECT * FROM "AiGeneration"`']) {
      expect(READER.test(s), s).toBe(true);
    }
    expect(READER.test("const aiGenerationTraceEnabled = 1")).toBe(false);
  });
});
