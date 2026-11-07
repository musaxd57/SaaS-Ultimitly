#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// DEMO HESABI - olustur / yenile (Airbnb basvurusu kapisi: demo tenant).
//
// VARSAYILAN KURU KOSU (hicbir sey yazmaz):
//   DATABASE_URL=... npx tsx scripts/demo-tenant.ts
// YAZMAK (uc sart birden):
//   DEMO_TENANT_APPLY=1 DEMO_TENANT_EXPECT_ORG=lxdemo-org DEMO_TENANT_PASSWORD=<en az 20 karakter> \
//   DATABASE_URL=... npx tsx scripts/demo-tenant.ts
//   Yerel olmayan veritabaninda ayrica DEMO_TENANT_REMOTE_HOST=<adresin sunucu adi, birebir>.
// Istege bagli: DEMO_TENANT_ROTATE_PASSWORD=1 (sifreyi yenile, oturumlari dusur) ·
//               DEMO_TENANT_RESET_SECURITY=1 (2FA + kurtarma kodlari + oturumlar sifirlanir).
//
// Yenileme = ayni komut: kimlikler ayni kalir, tarihler bugune kayar, inceleme ekibinin degisiklikleri
// geri alinir. Yalniz demo org'una dokunur. CANLIYA CALISTIRMADAN ONCE: taze pg_dump + kurucu onayi.
// Cikti SAF ASCII (Windows operator konsolu). Adres ve sifre ASLA yazdirilmaz.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { buildDemoDataset } from "../src/lib/demo-tenant/dataset";
import { applyDemoTenant, DemoRefusedError, preflightDemoTenant } from "../src/lib/demo-tenant/apply-core";
import { decideDemoRun } from "../src/lib/demo-tenant/cli";

async function main(): Promise<number> {
  const decision = decideDemoRun(process.env);
  if (decision.mode === "refuse") {
    console.error(`[demo-tenant] REFUSED: ${decision.reason}`);
    return 2;
  }
  const prisma = new PrismaClient();
  try {
    const ds = buildDemoDataset({ now: new Date() });
    const counts = `properties=${ds.properties.length} reservations=${ds.reservations.length} conversations=${ds.conversations.length} messages=${ds.messages.length} tasks=${ds.tasks.length} kb=${ds.kbItems.length} templates=${ds.templates.length}`;
    if (decision.mode === "dry_run") {
      const pf = await preflightDemoTenant(prisma, ds, { hasReviewerPassword: decision.password !== null });
      console.log(`[demo-tenant] DRY RUN - nothing written`);
      console.log(`[demo-tenant] existing: org=${pf.orgExists} reviewer=${pf.reviewerExists} properties=${pf.existing.properties} reservations=${pf.existing.reservations} conversations=${pf.existing.conversations} tasks=${pf.existing.tasks}`);
      console.log(`[demo-tenant] would write: ${counts}`);
      if (pf.needsReviewerPassword) console.log(`[demo-tenant] first apply needs DEMO_TENANT_PASSWORD (at least 20 characters)`);
      return 0;
    }
    const reviewerPasswordHash = decision.password ? await hashPassword(decision.password) : null;
    const staffPasswordHash = await hashPassword(randomBytes(32).toString("hex"));
    const res = await applyDemoTenant(prisma, ds, {
      reviewerPasswordHash,
      staffPasswordHash,
      rotatePassword: decision.rotatePassword,
      resetSecurity: decision.resetSecurity,
    });
    console.log(`[demo-tenant] APPLIED: ${counts} photoDeletionsQueued=${res.photoDeletionsQueued}`);
    return 0;
  } catch (err) {
    if (err instanceof DemoRefusedError) {
      console.error(`[demo-tenant] REFUSED (nothing written): ${err.reason}`);
      return 2;
    }
    console.error(`[demo-tenant] FAILED (transaction rolled back): ${err instanceof Error ? err.name : "error"}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
