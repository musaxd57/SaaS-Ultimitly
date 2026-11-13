import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCiGitleaks } from "../../scripts/secret-scan.mjs";

// CI 1801 (11-13): testler yeşilken CI yalnız sır taraması yüzünden kırmızıydı; yerelde karşılığı yoktu. Yerel betik CI'ın AYNI aracını
// AYNI sürüm + sha256 ile çalıştırır — değerler ci.yml'den okunur (tek kaynak). Bu pin, ci.yml biçimi değişirse betiğin sessizce
// "bulunamadı"ya düşmeyeceğini (ve yanlış sürüm çalıştırmayacağını) sınar.
describe("yerel sır taraması — CI ile aynı araç", () => {
  it("ci.yml'den gitleaks adresi, sürümü ve sha256 okunur", () => {
    const parsed = parseCiGitleaks(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(parsed).not.toBeNull();
    const spec = parsed!;
    expect(spec.url).toMatch(/^https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v[\d.]+\/gitleaks_[\d.]+_linux_x64\.tar\.gz$/);
    expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(spec.url).toContain(`/v${spec.version}/`);
  });

  it("biçim tanınmazsa null (sessiz 'temiz' yok — betik çıkış 2 verir)", () => {
    expect(parseCiGitleaks("jobs: {}")).toBeNull();
    expect(parseCiGitleaks("curl -sSL -o /tmp/gl.tgz https://github.com/gitleaks/gitleaks/releases/download/v1.0.0/gitleaks_1.0.0_linux_x64.tar.gz")).toBeNull();
  });

  it("package.json'da komut var", () => {
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["secret-scan"]).toBe("node scripts/secret-scan.mjs");
  });
});
