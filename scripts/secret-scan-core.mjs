// Sır taraması — saf parçalar (testli; `scripts/secret-scan.mjs` kullanır). Betik bu modülü içe aktarır ve KOŞULSUZ çalışır: "doğrudan mı
// çalıştırıldı" kontrolü yoktur (Opus 11-13: yol sembolik bağ içeriyorsa o kontrol tutmaz, tarama sessizce atlanır ve kapı "yeşil" derdi).

/** CI iş tanımından gitleaks adresi, sürümü ve sha256'sı. Biçim tanınmazsa null (betik çıkış 2 — "temiz" sayılmaz). */
export function parseCiGitleaks(ciYaml) {
  const url = /curl -sSL -o \S+ (https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v([\d.]+)\/gitleaks_[\d.]+_linux_x64\.tar\.gz)/.exec(ciYaml);
  const sha = /echo "([0-9a-f]{64})\s+\S*gl\.tgz" \| sha256sum -c -/.exec(ciYaml);
  if (!url || !sha) return null;
  return { url: url[1], version: url[2], sha256: sha[1] };
}

/** Sızıntı bulunduğunda gitleaks'in döneceği kod — araç hatalarından (gitleaks'in kendi 1'i) AYRILSIN diye 1 değil. */
export const LEAK_EXIT_CODE = 3;

/**
 * gitleaks sürecinin sonucu → betiğin çıkış kodu: 0 temiz · 1 sızıntı · 2 tarama YAPILAMADI (araç çalışmadı / bozuk / sinyal).
 * @param {{ status: number | null, error?: unknown }} run
 */
export function scanExitCode(run) {
  if (run.error || run.status === null) return 2;
  if (run.status === 0) return 0;
  if (run.status === LEAK_EXIT_CODE) return 1;
  return 2;
}
