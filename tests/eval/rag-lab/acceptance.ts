import type { LabRow } from "./core";

// ---------------------------------------------------------------------------
// HOLDOUT GEÇERLİLİĞİ + SIZINTI (getirme düzeyi). Tarihçe: Codex 09-27 "holdout yalnız `rows.length > 0` bekliyor" → önce her grupta
// ≥ %95 kapısı yazıldı; aynı gün KURUCU KARARI (Codex'le): "%95'i zorunlu geçme kuralı olarak kullanmayalım, oran raporda gelişimi
// görmek için dursun; kabul testinde her sorunun MÜŞTERİYE GİDECEK sonucuna bakalım — doğru kanıta dayalı cevap, bilinmeyende
// dürüstçe bilmeme/devir, çelişkide kesin konuşmama, sıfır sır sızıntısı; biri bozulursa o vaka kırmızı" → kabul CEVAP düzeyinde
// (`rag-answer`); canlı gönderim kapısı AYRICA gerekir (hiçbir sonlu test gelecekteki her soruyu garanti etmez).
// Burada kalan (getirme düzeyi, kırmızı yapan):
//   · VAKA başına sızıntı: eski sürüm / onaysız / taslak metni istem bloğunda → kırmızı (sır sızıntısının öncülü),
//   · sızıntının ÖLÇÜLDÜĞÜ gruplar (taslak, eski sürüm) tam koşuldu — yoksa "sızıntı 0" boş iddiadır (A9 09-27),
//   · koşu EKSİKSİZ: beklenen her soru satırı var (örnekleme, ücretli grup süzgeci, önbellek alt kümesi yok) ve hiçbir yeniden
//     sıralama çağrısı API / biçim hatasıyla düşmedi. Sıcak yol TAVANINI aşan çağrı eksik DEĞİLDİR (A9 09-27): üretimde de cevap o
//     zaman bugünkü sırayla gider.
// Oranlar (tek soru TR / diğer diller / iki soru) yalnız RAPORA yazılır; %95 hedeftir, kapı değil.
// ---------------------------------------------------------------------------

/** Raporun hedef çizgisi (bilgi; kapı DEĞİL — kurucu kararı 09-27). */
export const REPORT_TARGET = 0.95;
/** Oranı rapora yazılan ve tam koşulması şart olan gruplar. */
export const ACCEPTANCE_GROUPS: readonly string[] = ["single_tr", "single_xx", "multi"];
/** Yasak metnin (taslak / eski sürüm) tanımlı olduğu gruplar: koşulmadıysa sızıntı ÖLÇÜLMEMİŞTİR. */
export const LEAK_GROUPS: readonly string[] = ["draft", "version"];

export interface AcceptanceInput {
  rows: readonly LabRow[];
  /** Koşudan ÖNCE hesaplanan beklenen satır sayısı: `${kb}|${boyut}|${yapılandırma}` → soru sayısı. */
  expected: ReadonlyMap<string, number>;
  /** Değerlendirilen küme adı (ör. "scale-holdout"): yalnız bu kümenin anahtarları sayılır. */
  kb: string;
  /** Tam holdout'un grup başına soru sayısı (örnekleme ve grup süzgecini yakalamak için). */
  fullGroupCounts: ReadonlyMap<string, number>;
  groups?: readonly string[];
}

export interface HoldoutVerdict {
  /** KIRMIZI yapanlar: sızıntılı vaka, ölçülmemiş sızıntı, eksik koşu. Boş = geçerli ve sızıntısız. */
  failures: string[];
  /** Bilgi satırları: grup başına oran + hedef çizgisi (kapı değil). */
  rates: string[];
}

const pct = (x: number) => `%${Math.floor(1000 * x) / 10}`;

export function holdoutVerdict(input: AcceptanceInput): HoldoutVerdict {
  const groups = input.groups ?? ACCEPTANCE_GROUPS;
  const failures: string[] = [];
  const rates: string[] = [];
  const keys = [...input.expected.keys()].filter((k) => k.split("|")[0] === input.kb).sort();
  if (keys.length === 0) return { failures: [`${input.kb}: küme koşulmadı`], rates };
  for (const key of keys) {
    const rows = input.rows.filter((r) => `${r.kb}|${r.size}|${r.config}` === key);
    const expected = input.expected.get(key) ?? 0;
    if (rows.length !== expected) failures.push(`${key}: eksik koşu — ${rows.length}/${expected} satır`);
    const failedRr = rows.filter((r) => r.rr === "failed" || (r.rrErrors ?? 0) > 0).length;
    if (failedRr > 0) failures.push(`${key}: ${failedRr} satırda yeniden sıralama çağrısı hatayla düştü — koşu eksik sayılır`);
    const leaked = rows.filter((r) => r.leak).map((r) => r.qid);
    if (leaked.length > 0) failures.push(`${key}: sızıntılı vaka ${leaked.length} (${leaked.slice(0, 5).join(", ")}${leaked.length > 5 ? " …" : ""})`);
    for (const g of LEAK_GROUPS) {
      const n = rows.filter((r) => r.group === g).length;
      const full = input.fullGroupCounts.get(g) ?? 0;
      if (full === 0 || n < full) failures.push(`${key} · ${g}: sızıntı ölçülmedi — ${n}/${full} soru (grup koşulmadı)`);
    }
    for (const g of groups) {
      const gr = rows.filter((r) => r.group === g);
      const full = input.fullGroupCounts.get(g) ?? 0;
      if (gr.length === 0 || gr.length < full) {
        failures.push(`${key} · ${g}: grup eksik — ${gr.length}/${full} soru (örnekleme / grup süzgeci eksik koşudur)`);
        continue;
      }
      const ok = gr.filter((r) => r.inBlock).length;
      const rate = ok / gr.length;
      rates.push(`${key} · ${g}: ${ok}/${gr.length} (${pct(rate)}) — hedef ${pct(REPORT_TARGET)} ${rate >= REPORT_TARGET ? "üstünde" : "ALTINDA"} (bilgi, kapı değil)`);
    }
  }
  return { failures, rates };
}
