#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// FAZ 4 CONTRACT — CalendarSource.url düz metnini sentinel'e çevirir.
//
// ⚠️⚠️ GERİ ALINAMAZ ADIM (operasyonel olarak): sentinel yazıldığı an düz URL
//     yalnız urlEnc + yedeklerde yaşar; "eski kodu deploy et" rollback'i ölür.
//     Kurtarma yolları: (a) restore-calendar-url-plaintext.ts (ENCRYPTION_KEY
//     sağlamken urlEnc'ten geri yazar) veya (b) pg_dump restore.
//
// ⚠️ ÖN ŞARTLAR (docs/CALENDAR-URL-ENCRYPTION-DESIGN.md §4 Faz 4) BU SCRIPT'İ
//    KOŞMADAN ÖNCE SAĞLANMIŞ OLMALI: taze doğrulanmış pg_dump + TAM çöz-ve-
//    karşılaştır (verify --expect-complete) + prod'da şifreli yoldan sorunsuz
//    sync + AYRI ENCRYPTION_KEY yedeği. Kullanıcının AÇIK ONAYI OLMADAN
//    ÇALIŞTIRILMAZ.
//
// VARSAYILAN DAVRANIŞ DRY-RUN: yalnız sayar, HİÇBİR ŞEY YAZMAZ. Yazma için:
//   URL_CONTRACT_APPLY=1
//   URL_CONTRACT_EXPECT=<dry-run'ın bildirdiği dönüştürülecek satır sayısı>
//
// Güvenlik modeli: her satır yazımdan HEMEN ÖNCE bu süreçte yeniden çözülür ve
// düz metniyle === karşılaştırılır (toplu ön-doğrulama dakikalarca bayat
// olabilir; bu olamaz). Uyuşmayan satır ASLA sentinel'lenmez. Yazma CAS'lıdır
// (WHERE url = az önce doğrulanan değer). Apply sonrası post-contract TAM
// doğrulama otomatik koşar; tek sorun = çıkış kodu 1.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  CALENDAR_URL_SENTINEL,
  contractCalendarSourceUrlSentinel,
  verifyCalendarSourceUrlContract,
} from "../src/lib/calendar-source-url-core";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.calendarSource.count();
  const nullEnc = await prisma.calendarSource.count({ where: { urlEnc: null } });
  const alreadySentinel = await prisma.calendarSource.count({ where: { url: CALENDAR_URL_SENTINEL } });
  const eligible = await prisma.calendarSource.count({
    where: { urlEnc: { not: null }, url: { not: CALENDAR_URL_SENTINEL } },
  });
  console.log(
    `CalendarSource toplam=${total} · dönüştürülecek=${eligible} · zaten sentinel=${alreadySentinel} · urlEnc NULL=${nullEnc}`,
  );

  if (nullEnc > 0) {
    console.error(
      `DURDU: ${nullEnc} satırın urlEnc'i YOK — contract'tan önce backfill şart. Hiçbir şey yazılmadı.`,
    );
    process.exitCode = 1;
    return;
  }

  const apply = process.env.URL_CONTRACT_APPLY === "1";
  if (!apply) {
    console.log("DRY-RUN — hiçbir şey yazılmadı.");
    console.log(
      `Uygulamak için: URL_CONTRACT_APPLY=1 URL_CONTRACT_EXPECT=${eligible} npx tsx scripts/contract-calendar-url-sentinel.ts`,
    );
    return;
  }

  const expected = Number(process.env.URL_CONTRACT_EXPECT);
  if (!Number.isInteger(expected) || expected !== eligible) {
    console.error(
      `DURDU: URL_CONTRACT_EXPECT=${process.env.URL_CONTRACT_EXPECT ?? "(yok)"} canlı sayıyla (${eligible}) uyuşmuyor. ` +
        "Taze dry-run alıp yeni sayıyla tekrar çalıştırın. Hiçbir şey yazılmadı.",
    );
    process.exitCode = 1;
    return;
  }

  const r = await contractCalendarSourceUrlSentinel(prisma);
  console.log(
    `Contract → dönüştürülen=${r.converted} sentinel-toplam=${r.sentineled} reddedilen=${r.refused} urlEncNULL=${r.nullEnc}`,
  );
  if (r.refused > 0 || r.nullEnc > 0) {
    console.error(`SONUÇ: BAŞARISIZ — sorunlu id'ler: ${r.badIds.join(", ") || "(yok)"}`);
    process.exitCode = 1;
    return;
  }

  // Apply'ın ayrılmaz parçası: post-contract TAM doğrulama.
  const v = await verifyCalendarSourceUrlContract(prisma);
  console.log(
    `Doğrulama → toplam=${v.total} ok=${v.ok} düzMetinKalan=${v.plaintextRemaining} urlEncNULL=${v.nullEnc} fpUyuşmaz=${v.fpMismatch} çözülemeyen=${v.decryptFailed}`,
  );
  if (v.ok !== v.total) {
    console.error(`SONUÇ: BAŞARISIZ — sorunlu id'ler: ${v.badIds.join(", ") || "(yok)"}`);
    process.exitCode = 1;
  } else {
    console.log("SONUÇ: TEMİZ ✓ — tüm satırlar sentinel'li ve şifreli değer çözülüyor.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
