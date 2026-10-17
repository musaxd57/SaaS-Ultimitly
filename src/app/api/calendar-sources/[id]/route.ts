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
  // 🚨 DEĞER "manual", "ics" DEĞİL — ve bu fark LOAD-BEARING (denetim 08-08).
  // İlk yazımım "ics" koyuyordu ve bir önceki commit'te kapatılan kapıyı GERİ
  // AÇIYORDU: elle `.ics` yüklemesinin iptal kapısı sahipliği
  // `calendarSourceId: null && channel === "ics"` ile tanımlıyor ("bunu ben
  // yükledim"). Öksüz besleme satırı da "ics" olunca o kapı için elle yüklenmiş
  // satırdan AYIRT EDİLEMEZ hâle geliyordu → UID'si çakışan bayat bir .ics
  // dosyası CANLI bir rezervasyonu iptale çevirip `origin:"system"` görevlerini
  // SİLEBİLİYORDU (ölçüldü: kaynak silinmeden ÖNCE engelleniyor, sonra geçiyor).
  // "manual" her iki ihtiyacı da karşılar: yaşam-döngüsü kapısı
  // (`notIn ["ics","manual"]`) onu DA eler, iptal kapısı ise onu ARAMAZ.
  // ⚠️ Bu bir DEĞER BÜKME DEĞİL: satır artık hiçbir kaynağa bağlı değil ve
  // yalnız elle yönetilebilir. Rozet "Manuel" gösterir; öksüz bir satır için
  // dürüst olan bu.
  // ⚠️ Feed TEKRAR eklenirse iyileşme BOZULMAZ: benimseme `calendarSourceId: null`
  // arıyor (kanala bakmıyor) ve benimsedikten sonra ilk güncelleme kanalı yeniden
  // `channelFromLabel`den yazar.
  await prisma.$transaction([
    prisma.reservation.updateMany({
      where: { calendarSourceId: id },
      data: { calendarSourceId: null, channel: "manual" },
    }),
    prisma.calendarSource.delete({ where: { id } }),
  ]);
  return jsonOk({ ok: true });
});
