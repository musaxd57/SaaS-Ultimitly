/* ---------------------------------------------------------------------------
 * Ölçüm yan dosyası süzgeci — YAPRAK modül (hiçbir şey içe aktarmaz; birim testi uygulama grafiğini yüklemesin).
 *
 * `docs/olcum/*.json` okuyan tekrar oynatmalar yasak setleri OKUMAZ (CLAUDE.md yasak dosya kuralı): adında kabul / blind / holdout /
 * acceptance / sealed geçen dosya atlanır; "kör" / "kor" yalnız AYRI bir ad parçasıysa (rakamla da: "kor5") yasaktır ("korku", "kordon"
 * okunur). 🚨 Kör KABUL koşuları "-acc<N>" adını taşır (`qr-live-acc1`, `stay-change-acc10` — belgeler "kör kabul" der); 11-06'ya dek bu
 * ad süzgeçten geçiyordu (Opus incelemesi: 30 dosya, hepsinde cevap alanı) → ayrı ad parçası "acc" + rakam da yasak ("access" okunur).
 * ------------------------------------------------------------------------- */

const FORBIDDEN_NAME = /blind|holdout|kabul|acceptance|sealed|(?:^|[-_.])k[oö]r\d*(?:[-_.]|$)|(?:^|[-_.])acc\d+(?:[-_.]|$)/i;
/** Tekrar oynatmaların kendi çıktıları: kısaltılmış örnek cevaplar taşır, okunursa kısaltılmış kopya YENİ cevap sayılır (11-06 ölçüldü). */
const REPLAY_OUTPUT = /^(?:host-voice-replay|host-contact-replay)-/;

export function isForbiddenMeasurementFile(name: string): boolean {
  return FORBIDDEN_NAME.test(name);
}

export function isReplayOutput(name: string): boolean {
  return REPLAY_OUTPUT.test(name);
}
