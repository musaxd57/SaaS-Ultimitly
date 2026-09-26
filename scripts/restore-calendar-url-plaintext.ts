#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// FAZ 4 ROLLBACK ARACI — sentinel'lenmiş satırların düz `url` kolonunu urlEnc'i
// çözerek GERİ yazar. ENCRYPTION_KEY sağlam olduğu sürece contract'ın gerçek
// geri dönüş yoludur (dump restore'a gerek kalmadan).
//
// VARSAYILAN DAVRANIŞ DRY-RUN. Yazma için:
//   URL_RESTORE_APPLY=1
//   URL_RESTORE_EXPECT=<dry-run'ın bildirdiği sentinel satır sayısı>
//
// Yazma CAS'lıdır (WHERE url = sentinel) → gerçek bir URL asla ezilmez;
// ikinci koşu no-op. Çözülemeyen satır (anahtar/kurcalama) DOKUNULMADAN
// raporlanır ve çıkış kodu 1 olur — sessiz veri kaybı yok.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  CALENDAR_URL_SENTINEL,
  restoreCalendarSourceUrlPlaintext,
} from "../src/lib/calendar-source-url-core";

const prisma = new PrismaClient();

async function main() {
  const sentineled = await prisma.calendarSource.count({ where: { url: CALENDAR_URL_SENTINEL } });
  const total = await prisma.calendarSource.count();
  console.log(`CalendarSource toplam=${total} · sentinel (geri yazılacak)=${sentineled}`);

  const apply = process.env.URL_RESTORE_APPLY === "1";
  if (!apply) {
    console.log("DRY-RUN — hiçbir şey yazılmadı.");
    console.log(
      `Uygulamak için: URL_RESTORE_APPLY=1 URL_RESTORE_EXPECT=${sentineled} npx tsx scripts/restore-calendar-url-plaintext.ts`,
    );
    return;
  }

  const expected = Number(process.env.URL_RESTORE_EXPECT);
  if (!Number.isInteger(expected) || expected !== sentineled) {
    console.error(
      `DURDU: URL_RESTORE_EXPECT=${process.env.URL_RESTORE_EXPECT ?? "(yok)"} canlı sayıyla (${sentineled}) uyuşmuyor. ` +
        "Taze dry-run alıp yeni sayıyla tekrar çalıştırın. Hiçbir şey yazılmadı.",
    );
    process.exitCode = 1;
    return;
  }

  const r = await restoreCalendarSourceUrlPlaintext(prisma);
  console.log(`Restore → geri yazılan=${r.restored} çözülemeyen=${r.unreadable}`);
  if (r.unreadable > 0) {
    console.error(`SONUÇ: EKSİK — çözülemeyen id'ler: ${r.badIds.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("SONUÇ: TEMİZ ✓ — tüm sentinel satırlar düz metne geri döndü.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
