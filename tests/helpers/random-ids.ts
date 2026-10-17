/**
 * Rastgele kimlik / zaman / belirteç parçalarını metinden ÇIKARIR — kısa bir sayının "sızmadı" iddiası rastgele bir kimliğin içine
 * düşüp kararsız olmasın (CI #1426, 10-12: mülk kimliği "cmv5q6i42001…" "4200" içeriyordu; ms damgası "17918482913…" "482913" içerir).
 * İddia bundan SONRA eski biçimiyle (`not.toContain`) koşar → sızıntı hangi yazımla gelirse gelsin yakalanır ("05551234567", "4590dır",
 * "kodu482913"); yalnız rastgele parçalar elenir. (İlk sürüm "ayrık sayı" kalıbıydı — Haiku 10-12: bitişik telefon / Türkçe ek yazımını
 * kaçırıyordu.)
 *
 * Çıkarılanlar: Prisma cuid (c + 24 küçük harf-rakam) · ISO zaman damgası · epoch saniye / milisaniye (1.6e9–1.99e9 / 1.6e12–1.99e12;
 * telefon "0…" / "5…" ile başlar, dokunulmaz) · 24+ haneli onaltılık (olay kimliği, belirteç özeti).
 */
export function withoutRandomIds(s: string): string {
  return s
    .replace(/(?<![a-z0-9])c[a-z0-9]{24}(?![a-z0-9])/g, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
    .replace(/(?<!\d)1[6-9]\d{11}(?!\d)/g, "<ms>")
    .replace(/(?<![\d.])1[6-9]\d{8}(?:\.\d+)?(?![\d.])/g, "<s>")
    .replace(/(?<![0-9a-f])[0-9a-f]{24,}(?![0-9a-f])/gi, "<hex>");
}
