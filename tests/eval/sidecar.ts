import { writeFileSync } from "node:fs";
import path from "node:path";

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
// Gerçek misafir verisi bu yola HİÇBİR ZAMAN girmez.
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
}

/**
 * Raporun yanına JSON yazar ve İKİ yolu da stdout'a basar.
 * Dosya adı markdown ile AYNI köke sahiptir (`.md` → `.json`), yani eşleşme
 * tahmine değil kurala dayanır.
 */
export function writeSidecar(dir: string, reportFileName: string, payload: SidecarPayload): string {
  const jsonName = reportFileName.replace(/\.md$/u, ".json");
  const jsonPath = path.join(dir, jsonName);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  // Bu iki satır KOŞUCU İÇİN sözleşmedir; biçimi değiştirilirse
  // `scripts/eval-compare-models.mjs` koşuyu bulamaz (test-pinli).
  console.log(`${REPORT_MARKER}${path.join(dir, reportFileName)}`);
  console.log(`${DATA_MARKER}${jsonPath}`);
  return jsonPath;
}
