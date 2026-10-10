import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// DENEME RİSK PUANI yalnız OPERATÖR listesindedir (kurucu onayı 10-10: "önce yalnız liste"). Yapısal pin (sunucu bileşeni DB'li render
// ister; liste mantığı `riskyTrials` saf fonksiyonunda davranışsal sınanır — tests/unit/trial-risk.test.ts): (1) sayfa sahipleri yalnız deneme
// hesapları için tavansız sorgular ve listeyi riskyTrials'e verir ("yüklem var, argüman yok" dersi); (2) risk modülü operatör sayfası
// dışında HİÇBİR yerden import edilmez — müşteri yüzeyine / otomatik işleme sızamaz.
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
  it("sayfa sahipleri YALNIZ deneme hesapları için TAVANSIZ sorgular (doğrulama + kayıt anıyla) ve listeyi riskyTrials'e verir", () => {
    const src = read(ADMIN);
    const query = /const trialOwners = await prisma\.user\.findMany\(\{\s*where: \{ role: "owner", organizationId: \{ in: trialOrgIds \} \},\s*select: \{ email: true, organizationId: true, emailVerifiedAt: true, createdAt: true \},\s*\}\);/;
    expect(src).toMatch(query);
    expect(src).toMatch(/const trialOrgIds = orgs\.filter\(\(o\) => o\.subscription\?\.provider === "trial" && !isDemoOrg\(o\.id\)\)/);
    expect(src).toMatch(/riskyTrials\(\s*orgs\.filter\(\(o\) => !isDemoOrg\(o\.id\)\),\s*ownersByOrg,/);
    expect(src).toMatch(/TRIAL_RISK_LABELS\[r\]/);
    // Sayfanın org sorgusu puanın okuduğu abonelik alanlarını taşır.
    expect(src).toMatch(/subscription: \{ select: \{ status: true, planCode: true, provider: true, trialEndsAt: true, trialEndReason: true \} \}/);
  });

  it("🚨 risk modülünü operatör sayfası dışında hiçbir kaynak import etmez (anti-vakum: tarama gerçekten dosya bulur)", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(200);
    const importers = files.filter((f) => /from "@\/lib\/billing\/trial-risk"/.test(read(f)));
    expect(importers).toEqual([ADMIN]);
  });
});
