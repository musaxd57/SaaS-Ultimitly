import { prisma } from "@/lib/db";
import { notFound, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const source = await prisma.calendarSource.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!source) return notFound();

  // ⚠️ SATIRLARI ÖNCE ÇÖZ, SONRA SİL — TEK TRANSACTION (denetim, 08-01 — beşinci
  // tur, ajan bulgusu). `Reservation.calendarSourceId` FK DEĞİL; şemanın yorumu
  // "silinen kaynak satırları bağsız bırakır" diyor ama bunu YAPAN kod yoktu.
  // Sonuç KALICIYDI: host aynı feed'i tekrar eklediğinde yeni kaynağın id'si
  // eskisiyle eşleşmiyor, `legacy` benimseme dalı da `calendarSourceId: null`
  // istediği için ÖLÜ id taşıyan satırları benimseyemiyor → `create` denenip
  // `@@unique([propertyId, sourceReference])` P2002'ye düşüyor, catch "skipped"
  // sayıyor ve koşu "ok" raporluyordu. O feed'in eski rezervasyonlarına bir daha
  // ne tarih güncellemesi ne `STATUS:CANCELLED` iptali uygulanabiliyordu.
  await prisma.$transaction([
    prisma.reservation.updateMany({
      where: { calendarSourceId: id },
      data: { calendarSourceId: null },
    }),
    prisma.calendarSource.delete({ where: { id } }),
  ]);
  return jsonOk({ ok: true });
});
