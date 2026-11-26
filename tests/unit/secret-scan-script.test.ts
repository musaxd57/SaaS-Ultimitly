import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEAK_EXIT_CODE, parseCiGitleaks, scanExitCode } from "../../scripts/secret-scan-core.mjs";

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

  it("🚨 Opus B3: sonuç kodu — temiz 0, sızıntı (ayrı kod) 1, araç hatası / çalışmama / sinyal 2 (bozuk ikili 'sızıntı' sayılmaz)", () => {
    expect(LEAK_EXIT_CODE).not.toBe(1); // gitleaks'in kendi hata kodu 1 — sızıntı onunla karışmasın
    expect(scanExitCode({ status: 0 })).toBe(0);
    expect(scanExitCode({ status: LEAK_EXIT_CODE })).toBe(1);
    expect(scanExitCode({ status: 1 })).toBe(2);
    expect(scanExitCode({ status: 126 })).toBe(2);
    expect(scanExitCode({ status: null })).toBe(2);
    expect(scanExitCode({ status: 0, error: new Error("ENOENT") })).toBe(2);
  });

  it("🚨 betik 'doğrudan mı çalıştırıldı' kontrolü taşımaz (sembolik bağlı yolda tarama sessizce atlanırdı)", () => {
    const src = readFileSync("scripts/secret-scan.mjs", "utf8");
    expect(src).not.toMatch(/import\.meta\.url/);
    expect(src).not.toMatch(/process\.argv\[1\]/);
  });

  it("package.json'da komut var", () => {
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["secret-scan"]).toBe("node scripts/secret-scan.mjs");
  });
});
