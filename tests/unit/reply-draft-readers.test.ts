import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 🚨 EĞİTİM / DIŞA AKTARMA YASAĞI — taslak ↔ gönderilen metin bağı (migration 96, kurucu 11-13). Bu tablolar ürün içi ölçüm ve öğrenme içindir
// (sayım + kümeleme); hiçbir dışa aktarma / ince ayar / raporlama yoluna bağlanmaz (`AiGeneration` ile aynı ilke —
// `tests/unit/ai-generation-readers.test.ts`). Prisma temsilcisine dokunan modüller KAPALI listede; yeni okuyucu bilinçli karar ister.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

/** Kayıt + ölçüm + öğrenme okuyucuları · saklama süpürgesi · misafir silmesi · iki konuşma birleştirme yolu (yalnız kimlik taşır). */
const ALLOWED = [
  "scripts/apply-conversation-dedupe.ts",
  "src/lib/conversations-cleanup.ts",
  "src/lib/data-retention.ts",
  "src/lib/erasure.ts",
  "src/lib/reply-draft/service.ts",
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

const READER = /\b(?:prisma|db|tx|client)\s*\.\s*(?:replyDraftLink|replyDraftSpan)\b|\$queryRaw[\s\S]{0,200}"ReplyDraft(?:Link|Span)"/;

describe("ReplyDraftLink / ReplyDraftSpan okuyucuları kapalı liste", () => {
  it("yalnız izinli modüller dokunur", () => {
    const found = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))]
      .filter((f) => READER.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(found).toEqual(ALLOWED);
  });
});
