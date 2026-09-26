import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// OPENAI İSTEK SÖZLEŞMESİ — GERÇEK MİMARİNİN PİNİ (denetim bulgusu #47, 08-06)
//
// 🚨 CLAUDE.md yıllardır şunu yazıyordu: "OpenAI-uyumlu istek sözleşmesi TEK
// KAYNAK: `ai/openai-compat.ts` (üç çağrı yeri: ana yanıt, gölge, hazırlık
// özeti)". Kod-doğrulaması: **YANLIŞ**. `openai-compat.ts`'i yalnız İKİ modül
// import ediyor (`shadow-ai.ts`, `supply-ai.ts`); ANA YANIT yolu
// (`ai/index.ts`) ve ÇEVİRİ (`ai/translate.ts`) OpenAI'yi DOĞRUDAN çağırıyor
// ve reasoning kurallarını KENDİ ELLERİYLE uyguluyor.
//
// Bugün davranış DOĞRU — dört çağrı yerinin dördü de `isReasoningModel`'e göre
// dallanıyor. Tehlike davranışta değil YÖNLENDİRMEDE: `openai-compat.ts`'i
// düzelten bir bakımcı, ana yanıt yolunu da düzelttiğini SANIR ve gerçek
// hot-path dokunulmadan kalır. Belge düzeltildi; bu test de "tesadüfen
// tutarlıyız"ı bir SÖZLEŞMEYE çevirir.
//
// ⚠️ Ana yanıt yolunu `openai-compat.ts`'e taşımak DÜŞÜNÜLDÜ ve BU TURDA
// YAPILMADI: gönderim hot-path'i, davranış zaten doğru, ve kazanç yalnız
// estetik. Yapılacaksa kendi turunda + golden set ile.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");

/** src/ altındaki tüm .ts/.tsx dosyaları. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** OpenAI sohbet uç noktasına DOĞRUDAN `fetch` atan dosyalar (paylaşılan modül hariç). */
const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const directCallers = sourceFiles(path.join(ROOT, "src"))
  .filter((f) => readFileSync(f, "utf8").includes(`fetch("${CHAT_URL}"`))
  .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))
  .sort();

describe("OpenAI istek sözleşmesi — çağrı yerleri", () => {
  it("DOĞRUDAN çağıran dosyalar tam olarak bunlar (yeni bir tanesi karar ister)", () => {
    // 🚨 KIRMIZIYA DÖNERSE: yeni bir dosya OpenAI'yi doğrudan çağırıyor demektir.
    // SORU: `openai-compat.ts`'ten geçmesi gerekmez mi? Geçmeyecekse reasoning
    // dallanmasını KENDİ içinde yapmalı (aşağıdaki test onu zorluyor) ve bu
    // liste güncellenmeli.
    expect(directCallers).toEqual(["src/lib/ai/index.ts", "src/lib/ai/translate.ts"]);
  });

  it("her doğrudan çağıran `isReasoningModel`'e göre dallanıyor", () => {
    // Reasoning modelinde `temperature` GÖNDERİLEMEZ ve tavan
    // `max_completion_tokens`tır; klasik modelde `max_tokens`. Yanlış gövde 400
    // döner ve o yolu TAMAMEN arızaya çevirir (gölge pilotunda birebir yaşandı).
    for (const rel of directCallers) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel}: isReasoningModel dallanması yok`).toContain("isReasoningModel");
      expect(src, `${rel}: max_completion_tokens yok`).toContain("max_completion_tokens");
      expect(src, `${rel}: max_tokens yok`).toContain("max_tokens");
    }
  });

  it("`openai-compat.ts`'i kullanan modüller: gölge + hazırlık özeti + anlam katmanı", () => {
    // Belgedeki "üç çağrı yeri" iddiasının GERÇEK karşılığı bu ikisi. Sayı
    // artarsa (örn. ana yanıt taşınırsa) bu liste bilinçli güncellenir.
    // 09-24: anlam katmanı (bekçi + anlama) ortak sözleşmeden geçer — anahtar/sağlayıcı eşleşmesi
    // `semantic/config.ts`, gövde kuralları `semantic/structured-call.ts` (tek ağ kapısı).
    const importers = sourceFiles(path.join(ROOT, "src"))
      .filter((f) => /from "(@\/lib\/ai\/|\.\/)openai-compat"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))
      .sort();
    expect(importers).toEqual([
      "src/lib/ai/semantic/config.ts",
      "src/lib/ai/semantic/structured-call.ts",
      "src/lib/shadow-ai.ts",
      "src/lib/supply-ai.ts",
    ]);
  });

  it("ayrıştırıcı GERÇEKTEN dosya buldu (test kendini boşa düşürmesin)", () => {
    // `fetch("…")` yazımı değişirse (tek tırnak, değişkene alma) filtreler BOŞ
    // küme döner ve yukarıdaki döngüler sıfır kez koşardı.
    expect(directCallers.length).toBeGreaterThan(0);
    expect(sourceFiles(path.join(ROOT, "src")).length).toBeGreaterThan(100);
  });
});
