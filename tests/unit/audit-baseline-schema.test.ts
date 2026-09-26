import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { counterMismatch, extractAdvisories, validateBaseline } from "../../scripts/audit-check.mjs";

// ---------------------------------------------------------------------------
// F12 (Codex 09-05) — ZAFİYET KAPISI TRİAJ KAYDININ ŞEMASINI KENDİSİ DOĞRULAR.
//
// Kaydın biçimi `audit-baseline.test.ts`te pinliydi ama betiğin KENDİSİ denetlemiyordu:
//   · `expires` yoksa kabul SÜRESİZDİ (`!a.expires → continue`);
//   · bozuk tarih ("never", "2027-13-45") metin kıyasıyla "henüz dolmadı" sayılıyordu;
//   · aynı kimlik iki kez yazılırsa `Map` sessizce birleştiriyordu.
// `main` dalındaki haftalık iş YALNIZ betiği koşar (test paketi orada yok) → tek kapı betiğin kendisi.
// Ayrıca: sayaç zafiyet bildirip tek danışma çıkarılamazsa (rapor biçimi değişmiş) kapı yeşildi.
// ---------------------------------------------------------------------------

const ok = {
  id: "GHSA-abcd-efgh-ijkl",
  package: "postcss",
  severity: "high",
  expires: "2027-02-01",
  reason: "yalnız derleme zamanı; kullanıcı girdisi ulaşmıyor",
};
const errorsOf = (...accepted: unknown[]) => validateBaseline({ accepted });

describe("validateBaseline — betiğin kendi şema kapısı", () => {
  it("geçerli kayıt hatasız; NO-GHSA yedek kimliği de triaj edilebilir (betiğin kendi ürettiği kimlik)", () => {
    expect(errorsOf(ok)).toEqual([]);
    expect(errorsOf({ ...ok, id: "NO-GHSA:1234" })).toEqual([]);
  });

  it.each([
    ["yok", undefined],
    ["boş", ""],
    ["kelime", "never"],
    ["olmayan ay", "2027-13-45"],
    ["olmayan gün", "2027-02-30"],
    ["saatli", "2027-02-01T00:00:00Z"],
    ["sayı", 20270201],
  ])("🚨 expires %s → hata (süresiz / bozuk kabul YOK)", (_label, expires) => {
    const errs = errorsOf({ ...ok, expires });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("expires");
  });

  it("🚨 aynı kimlik iki kez → hata (sessiz birleşme yok)", () => {
    const errs = errorsOf(ok, { ...ok, expires: "2027-03-01" });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("IKI KEZ");
  });

  it("🚨 kimlik biçimi, paket ve gerekçe zorunlu", () => {
    expect(errorsOf({ ...ok, id: "postcss" })).toHaveLength(1);
    expect(errorsOf({ ...ok, id: undefined })).toHaveLength(1);
    expect(errorsOf({ ...ok, package: "" })).toHaveLength(1);
    expect(errorsOf({ ...ok, reason: "   " })).toHaveLength(1);
    expect(errorsOf("GHSA-abcd-efgh-ijkl")).toHaveLength(1);
  });

  it("🚨 `accepted` dizisi yoksa hata", () => {
    expect(validateBaseline({})).toHaveLength(1);
    expect(validateBaseline(null)).toHaveLength(1);
  });
});

describe("counterMismatch — sayaç ↔ çıkarılan danışma", () => {
  it("🚨 sayaç zafiyet bildiriyor ama tek danışma çıkarılamadı → incelenemedi (fail-closed)", () => {
    const audit = { vulnerabilities: { pkg: { via: ["other"] } }, metadata: { vulnerabilities: { high: 1, critical: 0 } } };
    expect(counterMismatch(audit, extractAdvisories(audit))).toBe(1);
  });

  it("sayaç sıfırken ya da danışma çıkarıldığında sorun yok (kaba sayaç eşitliği DAYATILMAZ)", () => {
    const clean = { vulnerabilities: {}, metadata: { vulnerabilities: { high: 0 } } };
    expect(counterMismatch(clean, extractAdvisories(clean))).toBe(0);
    const g = { name: "postcss", severity: "moderate", title: "t", url: "https://github.com/advisories/GHSA-abcd-efgh-ijkl" };
    // Geçişli paketler sayacı şişirir (3 paket, 1 danışma) — bu meşru.
    const real = { vulnerabilities: { postcss: { via: [g] }, next: { via: ["postcss"] }, x: { via: ["next"] } }, metadata: { vulnerabilities: { moderate: 3 } } };
    expect(counterMismatch(real, extractAdvisories(real))).toBe(0);
  });
});

describe("betik (alt süreç) — bozuk kayıt ağa çıkmadan KIRMIZI", () => {
  const ROOT = path.resolve(__dirname, "../..");
  it("🚨 expires'siz kayıt: kapı 1 ile çıkar ve sebebi söyler (lockfile/registry denetiminden ÖNCE)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auditschema-"));
    try {
      mkdirSync(path.join(dir, "scripts"));
      mkdirSync(path.join(dir, "security"));
      copyFileSync(path.join(ROOT, "scripts", "audit-check.mjs"), path.join(dir, "scripts", "audit-check.mjs"));
      const noExpires = { id: ok.id, package: ok.package, severity: ok.severity, reason: ok.reason };
      writeFileSync(path.join(dir, "security", "audit-baseline.json"), JSON.stringify({ accepted: [noExpires] }));
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
      const res = spawnSync(process.execPath, [path.join(dir, "scripts", "audit-check.mjs")], { cwd: dir, encoding: "utf8", timeout: 60_000 });
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("Baseline gecersiz");
      expect(res.stdout).toContain("expires");
      expect(res.stdout).not.toContain("package-lock.json YOK"); // şema kapısı önce konuşur
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
