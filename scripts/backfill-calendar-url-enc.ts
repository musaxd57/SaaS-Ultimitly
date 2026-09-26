#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// BACKFILL — CalendarSource.url → urlEnc (Faz 2). Dedupe-apply emsali desen.
//
// ⚠️ VARSAYILAN DAVRANIŞ DRY-RUN: yalnız sayar, HİÇBİR ŞEY YAZMAZ.
//    Yazma için İKİ şart birden gerekir:
//      URL_ENC_BACKFILL_APPLY=1
//      URL_ENC_EXPECT_NULL=<dry-run'ın bildirdiği NULL sayısı, BİREBİR>
//    Sayı canlıda değiştiyse (yeni kaynak eklendi vb.) script yazmadan durur —
//    önce taze dry-run, sonra yeni sayıyla apply.
//
// ⚠️ ÇALIŞTIRMADAN HEMEN ÖNCE TAZE pg_dump + SHA256 ALINMIŞ OLMALI. Bu script
//    yedek almaz ve yedeği doğrulayamaz — operatörün yükümlülüğü (dedupe-apply
//    kuralının aynısı).
//
// Güvenlik modeli: her satır `updateMany(WHERE id AND urlEnc IS NULL)` ile
// yazılır → Faz-1 dual-write ile yarış zararsız (kim önce yazdıysa o kalır),
// ikinci koşu no-op. Apply sonrası TAM salt-okuma doğrulama otomatik koşar
// (her satır çözülür, parmak izi ve düz metin === karşılaştırılır) ve tek
// uyuşmazlıkta çıkış kodu 1 olur.
//
// Kullanım:
//   dry-run: DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/backfill-calendar-url-enc.ts
//   apply  : ... URL_ENC_BACKFILL_APPLY=1 URL_ENC_EXPECT_NULL=<N> npx tsx scripts/backfill-calendar-url-enc.ts
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  backfillCalendarSourceUrlEnc,
  verifyCalendarSourceUrlEnc,
} from "../src/lib/calendar-source-url-core";

const prisma = new PrismaClient();

async function main() {
  const nullCount = await prisma.calendarSource.count({ where: { urlEnc: null } });
  const total = await prisma.calendarSource.count();
  console.log(`CalendarSource toplam=${total}, urlEnc NULL (backfill adayı)=${nullCount}`);

  const apply = process.env.URL_ENC_BACKFILL_APPLY === "1";
  if (!apply) {
    console.log("DRY-RUN — hiçbir şey yazılmadı.");
    console.log(
      `Uygulamak için: URL_ENC_BACKFILL_APPLY=1 URL_ENC_EXPECT_NULL=${nullCount} npx tsx scripts/backfill-calendar-url-enc.ts`,
    );
    return;
  }

  const expected = Number(process.env.URL_ENC_EXPECT_NULL);
  if (!Number.isInteger(expected) || expected !== nullCount) {
    console.error(
      `DURDU: URL_ENC_EXPECT_NULL=${process.env.URL_ENC_EXPECT_NULL ?? "(yok)"} canlı sayıyla (${nullCount}) uyuşmuyor. ` +
        "Taze dry-run alıp yeni sayıyla tekrar çalıştırın. Hiçbir şey yazılmadı.",
    );
    process.exitCode = 1;
    return;
  }

  const encrypted = await backfillCalendarSourceUrlEnc(prisma);
  console.log(`Şifrelenen satır: ${encrypted}`);

  // Apply'ın ayrılmaz parçası: TAM doğrulama (sayım değil — her satır açılır).
  const r = await verifyCalendarSourceUrlEnc(prisma);
  console.log(
    `Doğrulama → toplam=${r.total} NULL=${r.nullEnc} ok=${r.ok} fpUyuşmaz=${r.fpMismatch} çözülemeyen=${r.decryptFailed} düzMetinFarklı=${r.plaintextMismatch}`,
  );
  if (r.nullEnc > 0 || r.fpMismatch + r.decryptFailed + r.plaintextMismatch > 0) {
    console.error(`SONUÇ: BAŞARISIZ — sorunlu id'ler: ${r.badIds.join(", ") || "(yok)"}`);
    process.exitCode = 1;
  } else {
    console.log("SONUÇ: TEMİZ ✓ — tüm satırlar şifreli, çözülür ve düz metinle birebir aynı.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
