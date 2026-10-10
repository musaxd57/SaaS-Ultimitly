import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// DENEME RİSK PUANI yalnız OPERATÖR listesindedir (kurucu onayı 10-10: "önce yalnız liste"). Yapısal pin (sunucu bileşeni DB'li render
// ister): (1) sayfa puanı sahiplerin e-posta + doğrulama + kayıt anıyla VE ilan kuralının sonucuyla hesaplar ("yüklem var, argüman yok"
// dersi); (2) risk modülü operatör sayfası dışında HİÇBİR yerden import edilmez — müşteri yüzeyine / otomatik işleme sızamaz.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const ADMIN = "src/app/(app)/admin/page.tsx";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("deneme risk puanı — yalnız operatör listesi", () => {
  it("sayfa sahiplerin doğrulama + kayıt anını sorgular ve puana ilan kuralını da verir", () => {
    const src = read(ADMIN);
    expect(src).toMatch(/select: \{ email: true, organizationId: true, emailVerifiedAt: true, createdAt: true \}/);
    expect(src).toMatch(/owners: ownersByOrg\.get\(o\.id\) \?\? \[\]/);
    expect(src).toMatch(/identityReused: o\.subscription\?\.trialEndReason === TRIAL_END_REASON_IDENTITY_REUSED/);
    expect(src).toMatch(/o\.subscription\?\.provider === "trial" && !isDemoOrg\(o\.id\)/);
    expect(src).toMatch(/TRIAL_RISK_LABELS\[r\]/);
  });

  it("🚨 risk modülünü operatör sayfası dışında hiçbir kaynak import etmez (anti-vakum: tarama gerçekten dosya bulur)", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(200);
    const importers = files.filter((f) => /from "@\/lib\/billing\/trial-risk"/.test(read(f)));
    expect(importers).toEqual([ADMIN]);
  });
});
