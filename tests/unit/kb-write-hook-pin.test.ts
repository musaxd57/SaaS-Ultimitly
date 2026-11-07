import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// SINIF PİNİ — BİLGİ TABANINA YAZAN HER KAYNAK DOSYA TEK KANCAYI ÇAĞIRIR (bilgi tabanı dosya / RAG tasarımı S1, R6).
//
// Kalem eklenince / değişince / silinince Mülk Hafızası eşitlenmeli ve anlamsal vektörler ısıtılmalı (S3 açılınca: artık geçmeyen kalıcı
// vektörler silinmeli — KVKK). Bu adımlar yazma yollarında TEK TEK çağrılıyordu ve biri ısıtmayı unutmuştu (Wi-Fi önerisi onayı,
// `ai-suggestions/act.ts`). Kural: `knowledgeBaseItem` üzerinde create / update / delete / upsert yapan her dosya
// `afterKbItemsChanged` (`src/lib/kb/after-change.ts`) çağırır. İstisna listesi gerekçeli ve BÜYÜYEMEZ.
// ⚠️ Kaynak taraması TEK YÖNLÜDÜR (dosya çağırıyor ama yanlış dalda olabilir) — davranışsal kardeşi:
// `tests/integration/kb-write-hook.test.ts` (Wi-Fi önerisi onayı + kalem silme kancayı doğru mülkle çağırır).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const KB_WRITE = /\bknowledgeBaseItem\s*\.\s*(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/;

/** Gerekçeli istisnalar — BÜYÜYEMEZ (yeni dosya kancayı çağırır). */
const EXEMPT: Record<string, string> = {
  // Demo kiracısının sabit veri kümesi sıfırlaması: gerçek ev sahibi yazımı değil; demo verisi kendi işleminde baştan kurulur, Mülk Hafızası
  // ve ısıtma zamanlanmış geçişte (sabit metin, misafir yok).
  "src/lib/demo-tenant/apply-core.ts": "demo sıfırlama",
};

describe("bilgi tabanı yazma kancası pini", () => {
  const files = walk(path.join(ROOT, "src")).map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
  const writers = files.filter((f) => KB_WRITE.test(code(readFileSync(path.join(ROOT, f), "utf8"))));

  it("anti-vakum: tarama gerçekten yazan dosyaları buluyor", () => {
    expect(writers).toEqual(expect.arrayContaining(["src/app/api/kb/route.ts", "src/lib/ai-suggestions/act.ts", "src/lib/history-learn/service.ts"]));
  });

  it("🚨 bilgi tabanına yazan her dosya `afterKbItemsChanged` çağırır (istisnalar gerekçeli)", () => {
    const missing = writers.filter((f) => !EXEMPT[f] && !/\bafterKbItemsChanged\s*\(/.test(code(readFileSync(path.join(ROOT, f), "utf8"))));
    expect(missing).toEqual([]);
  });

  it("istisna listesi büyüyemez ve ölü kayıt taşımaz", () => {
    expect(Object.keys(EXEMPT)).toHaveLength(1);
    for (const f of Object.keys(EXEMPT)) expect(writers, f).toContain(f);
  });

  it("hafıza ve ısıtma yalnız kancadan çağrılır (yazma yolu adımları tek tek çağırmaz)", () => {
    const direct = files.filter(
      (f) =>
        !["src/lib/kb/after-change.ts", "src/modules/intelligence/index.ts", "src/lib/ai/embeddings/kb-warm.ts"].includes(f) &&
        /\b(?:refreshPropertyMemoryBestEffort|warmPropertyKbVectorsBestEffort)\s*\(/.test(code(readFileSync(path.join(ROOT, f), "utf8"))),
    );
    expect(direct).toEqual([]);
  });
});
