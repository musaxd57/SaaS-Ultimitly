import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evalRuntime, evalRuntimeMarkdown, type EvalRuntime } from "./run-meta";

// ---------------------------------------------------------------------------
// EVAL SIDECAR — makine-okunur koşu çıktısı (09-11).
//
// 🚨 NEDEN VAR: eval raporu MARKDOWN'dır ve insan için yazılmıştır. İki modeli
// (ya da iki sürümü) yan yana koymak için o markdown'ı PARSE ETMEK kırılgandır —
// rapor metni her turda değişiyor ve bir tablo başlığı değişince kıyas sessizce
// yanlış sonuç üretir. Sidecar, AYNI koşunun satırlarını JSON olarak yazar;
// kıyas betiği YALNIZ JSON okur.
//
// ⚠️ SIDECAR RAPORUN YERİNE GEÇMEZ: markdown kanıt zinciriyle birlikte yazılmaya
// devam eder ve "eksik koşu" damgası orada kalır. Buradaki JSON türev veridir.
//
// 🚨 PII: eval senaryoları ZATEN anonimdir (`evals/*.json`, sürümlü). Sidecar
// modelin CEVABINI da taşır — bu, raporun kendisinde de var (ölçüm için şart).
// Gerçek misafir METNİ bu yola girmez: gerçek set (B, `docs/EVAL-MUHURLU-FINAL.md`) koşusunda sidecar yalnız
// sıra kimliği ("r-0001"), etiket ve katman hükümlerini taşır — metin, ad, tarih YOK (kimlik yerel dosya olmadan
// hiçbir mesaja bağlanamaz), bu yüzden rapor ve sidecar depoya girebilir.
// ---------------------------------------------------------------------------

/** Koşucunun stdout'tan yakaladığı işaret satırları (kırılgan dosya adı tahmini yok). */
export const REPORT_MARKER = "[eval] REPORT=";
export const DATA_MARKER = "[eval] DATA=";

export interface SidecarPayload {
  /** Hangi eval takımı — "qr-kb-coverage" | "kb-retrieval-paired". */
  suite: string;
  version: string | number;
  meta: Record<string, unknown>;
  rows: unknown[];
  /** Katman bazında model + düşünme ayarı + commit + bayraklar (`run-meta.ts`) — `writeSidecar` KENDİSİ doldurur. */
  runtime?: EvalRuntime;
}

/**
 * Raporun yanına JSON yazar ve İKİ yolu da stdout'a basar.
 * Dosya adı markdown ile AYNI köke sahiptir (`.md` → `.json`), yani eşleşme
 * tahmine değil kurala dayanır.
 */
export function writeSidecar(dir: string, reportFileName: string, payload: SidecarPayload): string {
  const jsonName = reportFileName.replace(/\.md$/u, ".json");
  const jsonPath = path.join(dir, jsonName);
  // KOŞU KİMLİĞİ (Aşama 1, 09-30): katman bazında model + düşünme ayarı her yan dosyaya ve (varsa) raporun sonuna — koşucu
  // bunu unutamaz. Çağıran kendi `runtime`ını verdiyse (yeniden puanlama: ESKİ koşunun kimliği) o korunur.
  const runtime = payload.runtime ?? evalRuntime();
  writeFileSync(jsonPath, `${JSON.stringify({ ...payload, runtime }, null, 2)}\n`, "utf8");
  const mdPath = path.join(dir, reportFileName);
  if (existsSync(mdPath)) appendFileSync(mdPath, evalRuntimeMarkdown(runtime), "utf8");
  // Bu iki satır KOŞUCU İÇİN sözleşmedir; biçimi değiştirilirse
  // `scripts/eval-compare-models.mjs` koşuyu bulamaz (test-pinli).
  console.log(`${REPORT_MARKER}${path.join(dir, reportFileName)}`);
  console.log(`${DATA_MARKER}${jsonPath}`);
  return jsonPath;
}

/**
 * U16 (Codex 10-07): aynı gün / aynı model ikinci koşu öncekinin raporunu ve ÜCRETLİ ham yan dosyasını EZMEZ. Ad (`….md`) ya da yan
 * dosyası (`….json`) zaten varsa `-2`, `-3` … eklenir (`conversation-items` emsali). Yalnız TAZE koşu adları için; yeniden puanlama
 * aynı koşunun raporunu bilerek yeniden yazar.
 */
export function uniqueReportName(dir: string, name: string): string {
  const stem = name.replace(/\.md$/u, "");
  const taken = (n: string) => existsSync(path.join(dir, n)) || existsSync(path.join(dir, n.replace(/\.md$/u, ".json")));
  let candidate = `${stem}.md`;
  for (let n = 2; taken(candidate); n++) candidate = `${stem}-${n}.md`;
  return candidate;
}

/** İnsan inceleme bölümünde cevabın en çok bu kadarı satır içinde gösterilir (cevap tavanı `REPLY_CHAR_CAP` ile aynı). */
export const REVIEW_QUOTE_MAX = 4000;

/**
 * U22 (Codex 10-07): misafire giden cevap raporda SESSİZCE kesilmez (eskiden 320 karakter, işaretsiz — sonda gelen tehlikeli ifade
 * görünmüyordu). Tavana kadar TAMAMI; üstünde açık kesilme işareti + tam metnin yan dosyası.
 */
export function reviewQuote(text: string, reportFileName: string): string {
  if (text.length <= REVIEW_QUOTE_MAX) return JSON.stringify(text);
  const side = reportFileName.replace(/\.md$/u, ".json");
  return `${JSON.stringify(text.slice(0, REVIEW_QUOTE_MAX))} [+${text.length - REVIEW_QUOTE_MAX} karakter kesildi — tam metin: ${side}]`;
}
