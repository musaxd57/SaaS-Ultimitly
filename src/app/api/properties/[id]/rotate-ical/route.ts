import { prisma } from "@/lib/db";
import { jsonOk, forbidden, serverError } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { generateCalendarToken } from "@/lib/export/ics";
import { isUniqueViolation } from "@/lib/db-errors";

// ---------------------------------------------------------------------------
// TAKVİM BAĞLANTISINI YENİLE (iCal feed token rotasyonu).
//
// Neden gerekli: `/api/calendar/<token>` için token TEK kimlik bilgisidir ve
// bugüne kadar YENİLENEMİYORDU — yalnız mülk oluşturulurken üretiliyordu. Adres
// bir kez sızarsa (takvim üçüncü biriyle paylaşılır, destek görüşmesinde ekran
// görüntüsü döner, eski bir çalışanda kalır) o dairenin doluluk takvimi süresiz
// okunabilir hâle geliyordu ve iptal etmenin TEK yolu mülkü silmekti.
//
// QR sohbet token'ı BİLEREK kapsam dışı: o token tasarım gereği yarı-public
// (dairenin duvarında asılı bir QR). Gerçek koruması konaklama-başına cihaz
// kilidi + giriş/çıkış saati penceresi, ve iptal yolu ZATEN var (sohbeti kapat /
// cihaz kilidini sıfırla). Rotasyon orada güvenlik kazandırmaz ama basılı her
// QR'ı çöpe çevirir — yani net zarar.
//
// ⚠️ ÇAĞIRAN TARAFIN SORUMLULUĞU: bu işlem GERİ ALINAMAZ ve eski adrese abone
// olan kanallar (Airbnb / Booking / Google Takvim) sessizce güncelleme almayı
// bırakır. Yeni adres oraya yapıştırılmazsa sonuç ÇİFT REZERVASYON riskidir.
// UI bu yüzden iki adımlı onay göstermek zorunda.
// ---------------------------------------------------------------------------
export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;

  // Org kapsamı: bir yönetici yalnız KENDİ işletmesinin dairesine dokunabilir.
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true },
  });
  if (!property) return forbidden();

  // `icalToken` kolonu @unique. Çakışma astronomik olarak olanaksız (2×UUID),
  // ama olursa bir kez daha üretip denemek doğru davranış — 500 dönmek değil.
  for (let attempt = 0; attempt < 3; attempt++) {
    const icalToken = generateCalendarToken();
    try {
      await prisma.property.update({ where: { id: property.id }, data: { icalToken } });
      await writeAudit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "property.ical_token_rotated",
        // PII yok: yalnız hangi daire. Token'ın KENDİSİ asla loglanmaz.
        metadata: { propertyId: property.id },
      });
      return jsonOk({ ok: true });
    } catch (err) {
      if (!isUniqueViolation(err, ["icalToken"])) return serverError();
    }
  }
  return serverError();
});
