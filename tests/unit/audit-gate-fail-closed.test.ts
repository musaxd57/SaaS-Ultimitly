import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// ZAFİYET KAPISI FAIL-CLOSED (P1 #4, 08-09 (2))
//
// 🚨 ESKİ DAVRANIŞ: `npm audit` koşamazsa (registry erişilemez, çıktı şekil
// doğrulamasından geçmez) script `exit 0 + uyarı` veriyordu. Yani bir TEDARİK
// ZİNCİRİ KAPISI, KOŞMADIĞINI "yeşil" diye raporluyordu — bir kapının en kötü
// arıza modu: CI yeşil, kimse bakmıyor, yeni bir critical danışma sessizce
// içeri giriyor. Aynı dosya 08-07 (5)'te tam bu sınıfta bir arızayla
// düzeltilmişti (şekil doğrulaması) ama fail-open dalı BIRAKILMIŞTI.
//
// ⚠️ BU TESTLER GERÇEK SCRIPT'İ ALT SÜREÇTE KOŞAR. Kaynak taraması burada
// yetersiz olurdu: "exit kodu" bir DAVRANIŞTIR ve bu deponun kendi dersi,
// kaynak taramasının "aşırı/eksik uygulama"yı göremediğidir. Ölçüldü: iki dal
// da ~0.6 sn (AUDIT_RETRIES=1) — CI'ya yük değil.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts", "audit-check.mjs");

function run(cwd: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [path.join(cwd, "scripts", "audit-check.mjs")], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
}

/** Script + baseline'ı taşıyan, ama lockfile'ı OLMAYAN geçici bir ağaç. */
function makeTreeWithoutLock(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "auditgate-"));
  mkdirSync(path.join(dir, "scripts"));
  mkdirSync(path.join(dir, "security"));
  copyFileSync(SCRIPT, path.join(dir, "scripts", "audit-check.mjs"));
  copyFileSync(
    path.join(ROOT, "security", "audit-baseline.json"),
    path.join(dir, "security", "audit-baseline.json"),
  );
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
  return dir;
}

describe("zafiyet kapısı — altyapı arızasında FAIL-CLOSED", () => {
  it("🚨 registry ERİŞİLEMEZSE kapı KIRMIZI (eskiden sessizce yeşildi)", () => {
    const res = run(ROOT, { npm_config_registry: "http://127.0.0.1:1", AUDIT_RETRIES: "1" });
    expect(res.status, "altyapı arızası sessizce yeşil geçti").toBe(1);
    expect(res.stdout).toContain("::error::");
    expect(res.stdout).toContain("HICBIR SEY denetleyemedi");
  });

  it("🚨 package-lock.json YOKSA kapı KIRMIZI ve sebebi NET", () => {
    // `npm audit` lockfile'dan çalışır. Bu dal ayrı çünkü arızayı doğru yere
    // yönlendirmek gerekiyor: "registry yok" ile "lockfile yok" aynı kovaya
    // düşerse yanlış yerde saat harcanır.
    // ⚠️ Gerçek karşılığı ölçüldü: varsayılan dal `main`de lockfile YOK.
    const dir = makeTreeWithoutLock();
    try {
      const res = run(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("package-lock.json YOK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("KONTROL: gerçek ağaçta kapı YEŞİL — 'her zaman kırmızı' değil", () => {
    // Bu olmadan "her hâlde 1 dön" mutasyonu da yeşil geçerdi ve kapı kalıcı
    // kırmızıya dönerdi — bu deponun açıkça reddettiği durum ("kalıcı kırmızı
    // bir kapı sinyal değerini kaybeder").
    const res = run(ROOT);
    expect(res.status, res.stdout.slice(-800)).toBe(0);
    expect(res.stdout).toContain("Sonuc: yesil");
  });

  it("🚨 YENİDEN DENEME GERÇEKTEN DÖNGÜYE GİRİYOR (mesaj değil, davranış)", () => {
    // ⚠️ İLK YAZIMIM VACUOUS'TU: yalnız "denemesi 1/2" mesajını arıyordu ve
    // döngüyü tek turda kesen mutasyon YEŞİL geçiyordu — çünkü o mesaj ilk
    // turda zaten basılıyor. Doğru ölçü, AYRI TURLARIN sayısı.
    // Retry, fail-closed'ı savunulabilir kılan şey: gerçek bir registry
    // titremesi ikinci denemede geçer, gerçek bir arıza üçünde de geçmez.
    const res = run(ROOT, {
      npm_config_registry: "http://127.0.0.1:1",
      AUDIT_RETRIES: "3",
      AUDIT_RETRY_DELAY_MS: "0", // testte bekleme yok; döngü sayısını ölçüyoruz
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("denemesi 1/3 basarisiz");
    expect(res.stdout).toContain("denemesi 2/3 basarisiz");
    // Son deneme için "yeniden deneniyor" YAZILMAZ — üçüncüden sonrası yok.
    expect(res.stdout).not.toContain("denemesi 3/3 basarisiz");
  });
});
