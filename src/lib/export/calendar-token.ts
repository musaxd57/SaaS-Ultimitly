import "server-only";

import { prisma } from "@/lib/db";
import { generateCalendarToken } from "@/lib/export/ics";

/**
 * Dairenin dışa aktarım (takvim) anahtarını YOKSA üretir, VARSA aynen döndürür.
 *
 * 🚨 YALNIZ BOŞSA YAZILIR (takvim C4, Codex 11-10): eskiden sayfa açılışında koşulsuz yazılıyordu — iki sekme (ya da iki ekip üyesi) aynı
 * anda açınca iki ayrı anahtar üretiliyor, sonuncusu kazanıyordu: ilk sekmede gösterilen (ve Airbnb / Booking'e yapıştırılan) bağlantı
 * sessizce GEÇERSİZ kalıyordu. Yazım "hâlâ boşsa" koşuluyla; kaybeden çağrı kazananın anahtarını okur → herkes AYNI bağlantıyı görür.
 * (Anahtarı bilerek değiştirmek ayrı işlemdir: `rotate-ical`.)
 */
export async function ensurePropertyCalendarToken(propertyId: string): Promise<string | null> {
  await prisma.property.updateMany({ where: { id: propertyId, icalToken: null }, data: { icalToken: generateCalendarToken() } });
  return (await prisma.property.findUnique({ where: { id: propertyId }, select: { icalToken: true } }))?.icalToken ?? null;
}
