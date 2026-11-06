#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// ÜYELİK ONARIMI (M-2 dilim 2, Opus S5) — `/api/health?strict=1` → 503 `users_without_membership` alarmının çaresi.
//
// ⚠️ VARSAYILAN DAVRANIŞ SALT-OKUMA: yalnız sayar, HİÇBİR ŞEY YAZMAZ. Çıktıda kimlik / e-posta YOK (yalnız sayı + açılış anı aralığı).
//    Yazma için İKİ şart birden gerekir:
//      MEMBERSHIP_BACKFILL_APPLY=1
//      MEMBERSHIP_BACKFILL_EXPECT=<salt-okuma koşusunun bildirdiği sayı, BİREBİR>
//    Sayı o arada değiştiyse betik yazmadan durur — önce taze salt-okuma, sonra yeni sayıyla.
//
// Yazdığı: migration 94'ün İFADESİNİN AYNISI (dosyadan okunur): yalnız HİÇ üyelik satırı olmayan kullanıcıya ana işletmesinde etkin üyelik;
// çıkarılmış üyelik dirilmez; tekrar koşulabilir. Yalnız ekler — silmez, güncellemez.
// 🚨 Ekipten çıkarma satır SİLERSE ya da "askıda hesap" (Ü-1) gelirse bu betik o tasarımla yeniden tanımlanmadan KOŞULMAZ (Opus S11).
// ⚠️ Yazmadan önce taze pg_dump (veri yazan her operatör betiğinin kuralı; betik yedek almaz).
//
// Kullanım (Railway Console'dan ya da yerel klondan, uygulama kökünde):
//   salt-okuma: DATABASE_URL=... npx tsx scripts/membership-backfill.ts
//   yazma     : ... MEMBERSHIP_BACKFILL_APPLY=1 MEMBERSHIP_BACKFILL_EXPECT=<N> npx tsx scripts/membership-backfill.ts
// Çıkış kodu: salt-okumada eksik varsa 1, yoksa 0; yazmada sayı uyuşmazsa ya da sonunda eksik kaldıysa 1.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { applyMembershipBackfill, membershipGap } from "../src/lib/membership/backfill-core";

const prisma = new PrismaClient();

const iso = (d: Date | null) => (d ? d.toISOString() : "-");

async function main() {
  const gap = await membershipGap(prisma);
  console.log("== Uyelik onarimi (M-2) ==");
  console.log(`Uyelik satiri HIC olmayan kullanici : ${gap.count}`);
  console.log(`Bu hesaplarin acilis ani araligi    : ${iso(gap.oldestCreatedAt)} .. ${iso(gap.newestCreatedAt)}`);

  if (process.env.MEMBERSHIP_BACKFILL_APPLY !== "1") {
    console.log("\nSALT-OKUMA: hicbir sey yazilmadi.");
    if (gap.count > 0) {
      console.log(`Yazmak icin (once taze pg_dump): MEMBERSHIP_BACKFILL_APPLY=1 MEMBERSHIP_BACKFILL_EXPECT=${gap.count} npx tsx scripts/membership-backfill.ts`);
      process.exitCode = 1;
    }
    return;
  }

  const raw = process.env.MEMBERSHIP_BACKFILL_EXPECT ?? "";
  if (!/^\d+$/.test(raw)) {
    console.error("MEMBERSHIP_BACKFILL_EXPECT yok ya da sayi degil — once salt-okuma kosusunun bildirdigi sayiyi verin. Hicbir sey yazilmadi.");
    process.exitCode = 1;
    return;
  }
  const result = await applyMembershipBackfill(prisma, Number(raw));
  if (!result.ok) {
    console.error(`Sayi degisti (beklenen ${result.expected}, simdi ${result.actual}) — hicbir sey yazilmadi. Once taze salt-okuma.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nYAZILDI: ${result.inserted} uyelik. Kalan eksik: ${result.remaining}.`);
  if (result.remaining > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
