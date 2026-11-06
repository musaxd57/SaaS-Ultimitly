/* ---------------------------------------------------------------------------
 * Ölçüm yan dosyası süzgeci — YAPRAK modül (hiçbir şey içe aktarmaz; birim testi uygulama grafiğini yüklemesin).
 *
 * `docs/olcum/*.json` okuyan tekrar oynatmalar yasak setleri OKUMAZ (CLAUDE.md yasak dosya kuralı): adında kör / kabul / blind /
 * holdout / acceptance / sealed geçen dosya atlanır. "kor" yalnız ayrı bir ad parçasıysa yasaktır ("korku", "kordon" okunur).
 * ------------------------------------------------------------------------- */

const FORBIDDEN_NAME = /blind|holdout|kabul|acceptance|sealed|(?:^|[-_.])k[oö]r(?:[-_.]|$)/i;
/** Tekrar oynatmaların kendi çıktıları: kısaltılmış örnek cevaplar taşır, okunursa kısaltılmış kopya YENİ cevap sayılır (11-06 ölçüldü). */
const REPLAY_OUTPUT = /^(?:host-voice-replay|host-contact-replay)-/;

export function isForbiddenMeasurementFile(name: string): boolean {
  return FORBIDDEN_NAME.test(name);
}

export function isReplayOutput(name: string): boolean {
  return REPLAY_OUTPUT.test(name);
}
