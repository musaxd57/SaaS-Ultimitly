import type { LabRow } from "./core";

// ---------------------------------------------------------------------------
// HOLDOUT KABUL KAPISI (Codex 09-27, kurucu alt sınırı: "300 kalemlik bilgi tabanında bile yüzde 95 olmalı minimum").
// Eskiden holdout koşusu yalnız `rows.length > 0` bekliyordu: eşik altı, sızıntılı ya da yarım kalmış koşu da YEŞİL çıkıyordu.
// Kural: kabul kümesinde koşulan HER yapılandırma için
//   · her kabul grubu (tek soru TR · tek soru diğer diller · iki sorulu mesaj — İKİ cevap da blokta) ≥ %95,
//   · sızıntı (eski sürüm / onaysız / taslak metni blokta) 0,
//   · koşu EKSİKSİZ: beklenen her soru satırı var (örnekleme, ücretli grup süzgeci ya da önbellek alt kümesi kabul DEĞİL) ve
//     hiçbir yeniden sıralama çağrısı düşmedi (düşen çağrı = ölçülen yapılandırma koşmadı).
// Saf fonksiyon: kabul edilmezse hata listesi döner (boş = kabul). Eval testi `expect(...).toEqual([])` ile KIRMIZI olur.
// ---------------------------------------------------------------------------

/** Kurucu alt sınırı — her kabul grubu için (iki sorulu mesaj dahil; eski belgede 90 yazıyordu). */
export const ACCEPTANCE_MIN = 0.95;
/** Oranı kapıya giren gruplar. Sızıntı ve eksiksizlik TÜM gruplarda aranır. */
export const ACCEPTANCE_GROUPS: readonly string[] = ["single_tr", "single_xx", "multi"];

export interface AcceptanceInput {
  rows: readonly LabRow[];
  /** Koşudan ÖNCE hesaplanan beklenen satır sayısı: `${kb}|${boyut}|${yapılandırma}` → soru sayısı. */
  expected: ReadonlyMap<string, number>;
  /** Kabul edilen küme adı (ör. "scale-holdout"): yalnız bu kümenin anahtarları sayılır. */
  kb: string;
  /** Tam holdout'un grup başına soru sayısı (örnekleme ve grup süzgecini yakalamak için). */
  fullGroupCounts: ReadonlyMap<string, number>;
  min?: number;
  groups?: readonly string[];
}

const pct = (x: number) => `%${Math.floor(1000 * x) / 10}`;

export function acceptanceFailures(input: AcceptanceInput): string[] {
  const min = input.min ?? ACCEPTANCE_MIN;
  const groups = input.groups ?? ACCEPTANCE_GROUPS;
  const failures: string[] = [];
  const keys = [...input.expected.keys()].filter((k) => k.split("|")[0] === input.kb).sort();
  if (keys.length === 0) return [`${input.kb}: kabul kümesi koşulmadı`];
  for (const key of keys) {
    const rows = input.rows.filter((r) => `${r.kb}|${r.size}|${r.config}` === key);
    const expected = input.expected.get(key) ?? 0;
    if (rows.length !== expected) failures.push(`${key}: eksik koşu — ${rows.length}/${expected} satır`);
    const failedRr = rows.filter((r) => r.rr === "failed").length;
    if (failedRr > 0) failures.push(`${key}: ${failedRr} yeniden sıralama çağrısı başarısız — koşu eksik sayılır`);
    const leaks = rows.filter((r) => r.leak).length;
    if (leaks > 0) failures.push(`${key}: ${leaks} sızıntı (eski sürüm / onaysız / taslak metni blokta)`);
    for (const g of groups) {
      const gr = rows.filter((r) => r.group === g);
      const full = input.fullGroupCounts.get(g) ?? 0;
      if (gr.length === 0 || gr.length < full) {
        failures.push(`${key} · ${g}: grup eksik — ${gr.length}/${full} soru (örnekleme / grup süzgeci kabul değildir)`);
        continue;
      }
      const ok = gr.filter((r) => r.inBlock).length;
      if (ok / gr.length < min) failures.push(`${key} · ${g}: ${ok}/${gr.length} (${pct(ok / gr.length)}) < ${pct(min)}`);
    }
  }
  return failures;
}
