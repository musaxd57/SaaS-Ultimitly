/**
 * Bir sayının metinde AYRI bir değer olarak geçip geçmediği (harf / rakam komşusu yok). Kimlik (cuid), zaman damgası (ms) ya da rastgele
 * belirteç taşıyan metinde çıplak `not.toContain("4590")` KARARSIZDIR: rastgele bir kimliğin / zamanın içine düşer (CI #1426, 10-12:
 * mülk kimliği "cmv5q6i42001…" "4200" içeriyordu; ms damgası "17918482913…" "482913" içerir). Sızan değer metinde boşluk / noktalama ile
 * ayrık durur — bu kalıp onu yakalar, kimliğin içini yakalamaz.
 */
export function standaloneNumber(n: string): RegExp {
  if (!/^\d+$/.test(n)) throw new Error(`standaloneNumber yalnız rakam alır: ${n}`);
  return new RegExp(`(?<![A-Za-z0-9])${n}(?![A-Za-z0-9])`);
}
