/* ---------------------------------------------------------------------------
 * Ölçüm yan dosyası süzgeci — YAPRAK modül (hiçbir şey içe aktarmaz; birim testi uygulama grafiğini yüklemesin).
 *
 * `docs/olcum/*.json` okuyan tekrar oynatmalar yasak setleri OKUMAZ (CLAUDE.md yasak dosya kuralı): adında kör / kabul / blind /
 * holdout / acceptance / sealed geçen dosya atlanır. "kor" yalnız ayrı bir ad parçasıysa yasaktır ("korku", "kordon" okunur).
 * ------------------------------------------------------------------------- */

const FORBIDDEN_NAME = /blind|holdout|kabul|acceptance|sealed|(?:^|[-_.])k[oö]r(?:[-_.]|$)/i;

export function isForbiddenMeasurementFile(name: string): boolean {
  return FORBIDDEN_NAME.test(name);
}
