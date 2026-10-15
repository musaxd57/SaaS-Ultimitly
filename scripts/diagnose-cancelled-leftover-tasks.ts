#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA TEŞHİS — iptal edilmiş konaklamada kalan sistem görevleri (10-15).
//
// HİÇBİR ŞEY YAZMAZ, SİLMEZ. Yalnız Task + Reservation + TaskUpdate OKUR ve SAYAR. Çıktıda görev başlığı (misafir adı taşır), misafir
// adı, kimlik, org ya da mülk adı YOKTUR — yalnız sayılar (işletme başına dağılım da kimliksiz).
//
// Neden: eski kodda iptal temizliği kilitsizdi (iptalden önce başlamış görev açma işlemi görevleri iptalden SONRA yazabiliyordu) ve
// temizlik düşerse hata yutuluyordu. Bugünkü kod ikisini kapatır; bu betik GEÇMİŞTE kalanların kapsamını ölçer. Silme kararı kurucuda
// (`docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §D5). Küme tanımı iptal temizliğiyle ORTAK (`src/lib/tasks/cancelled-leftovers.ts`).
//
// Kullanım (Railway açıldıktan sonra, prod DATABASE_URL ile; ENCRYPTION_KEY GEREKMEZ):
//   DATABASE_URL=... npx tsx scripts/diagnose-cancelled-leftover-tasks.ts
// Çıkış kodu: koştuysa 0 (artık olsa da — teşhis, karar insanın); koşamadıysa 1 ("0 artık" ile "koşamadı" karışmasın).
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import {
  OPEN_AUTO_LIFECYCLE_TASK_WHERE,
  STORAGE_PHOTO_PREFIX,
  summarizeLeftovers,
  type LeftoverRow,
} from "../src/lib/tasks/cancelled-leftovers";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { ...OPEN_AUTO_LIFECYCLE_TASK_WHERE, reservation: { status: "cancelled" } },
    select: {
      type: true,
      status: true,
      assignedToId: true,
      updates: { select: { userId: true, photoUrl: true } },
      reservation: {
        select: { id: true, channel: true, calendarSourceId: true, departureDate: true, property: { select: { organizationId: true } } },
      },
    },
  });
  const rows: LeftoverRow[] = tasks.flatMap((t) => {
    if (!t.reservation) return [];
    const photos = t.updates.map((u) => u.photoUrl).filter((p): p is string => p !== null);
    return [
      {
        type: t.type,
        status: t.status,
        assigned: t.assignedToId !== null,
        staffUpdates: t.updates.filter((u) => u.userId !== null).length,
        storagePhotos: photos.filter((p) => p.startsWith(STORAGE_PHOTO_PREFIX)).length,
        otherPhotos: photos.filter((p) => !p.startsWith(STORAGE_PHOTO_PREFIX)).length,
        reservation: {
          id: t.reservation.id,
          organizationId: t.reservation.property.organizationId,
          channel: t.reservation.channel,
          calendarSourceId: t.reservation.calendarSourceId,
          departureDate: t.reservation.departureDate,
        },
      },
    ];
  });
  const s = summarizeLeftovers(rows, now);
  console.log("İptal edilmiş konaklamada kalan AÇIK sistem görevleri (giriş hazırlığı / temizlik)");
  console.log(`  etkilenen rezervasyon            : ${s.reservations}`);
  console.log(`  görev                            : ${s.tasks}`);
  console.log(`  işletme sayısı                   : ${s.organizations}  (işletme başına görev: ${JSON.stringify(s.tasksPerOrganization)})`);
  console.log(`  türe göre                        : ${JSON.stringify(s.byType)}`);
  console.log(`  duruma göre                      : ${JSON.stringify(s.byStatus)}`);
  console.log(`  birine atanmış                   : ${s.assigned}`);
  console.log(`  bir kişinin güncellemesi olan    : ${s.withStaffUpdates}  (sistem notları sayılmaz)`);
  console.log(`  depo fotoğrafı / dış bağlantı    : ${s.withStoragePhotos} / ${s.withOtherPhotos}`);
  console.log(`  kaynak: takvim bağlantısı / dosya / diğer : ${s.bySource.calendar_feed} / ${s.bySource.file} / ${s.bySource.other}`);
  console.log(`  konaklama çıkışı geçmişte / gelecekte     : ${s.pastStay} / ${s.futureStay}`);
  console.log("Kurucu D5 (10-15) ayrımı — bu betik HİÇBİR ŞEYİ değiştirmez:");
  console.log(`  aday (başlanmamış, kimse dokunmamış)      : ${s.candidates}  (bunlardan birine atanmış: ${s.candidatesAssigned})`);
  console.log(`  KORUNUR — başlanmış / onay bekliyor        : ${s.protectedStarted}`);
  console.log(`  KORUNUR — kişi güncellemesi ya da fotoğraf : ${s.protectedTouched}`);
}

main()
  .catch((err) => {
    console.error("teşhis koşamadı:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
