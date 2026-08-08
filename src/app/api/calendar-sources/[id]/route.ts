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
  // 🚨 KANAL DA "ics"e ÇEVRİLİR — YOKSA SİLME, YAŞAM-DÖNGÜSÜ KAPISINI DELER
  // (denetim 08-08, uçtan uca ÖLÇÜLDÜ).
  // Yaşam-döngüsü göndericileri "bu satır Hospitable'da YOK" kararını iki
  // işaretçiyle veriyor: `calendarSourceId: null` VE `channel notIn [ics,manual]`.
  // Beslemeden gelen satırın kanalı `channelFromLabel(source.label)` ile
  // yazılıyor ve o fonksiyon ASLA "ics" döndürmüyor ("Airbnb" → "airbnb").
  // Yani tek koruma `calendarSourceId`ydi — ve YUKARIDAKİ satır tam olarak onu
  // null'lıyor. Sonuç ölçüldü: host feed kartında "Sil"e bastıktan sonra
  // `sendDueWelcomes` o satırı ADAY sayıyor ve iCal UID'sini Hospitable
  // rezervasyon id'si olarak POST ediyor → 404 → claim geri alınır → aynı satır
  // 2 dakikada bir yeniden denenir + her koşuda alarm. Kalıcı döngü.
  // ⚠️ Kanalı "ics" yapmak bir DEĞER BÜKME DEĞİL, doğrulama: satır gerçekten bir
  // iCal beslemesinden geldi. Rozet "Airbnb" yerine "iCal" gösterir; öksüz bir
  // satır için bu dürüst olan. `channelFromLabel` "ics" üretmediği için bu değer
  // beslemeden gelen satırı benzersiz işaretlemeye devam eder.
  // ⚠️ Feed TEKRAR eklenirse iyileşme BOZULMAZ: benimseme `calendarSourceId: null`
  // arıyor (kanala bakmıyor) ve benimsedikten sonra ilk güncelleme kanalı yeniden
  // `channelFromLabel`den yazar.
  await prisma.$transaction([
    prisma.reservation.updateMany({
      where: { calendarSourceId: id },
      data: { calendarSourceId: null, channel: "ics" },
    }),
    prisma.calendarSource.delete({ where: { id } }),
  ]);
  return jsonOk({ ok: true });
});
