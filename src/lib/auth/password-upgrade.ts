import { prisma } from "@/lib/db";
import { hashPasswordIfIdle } from "@/lib/auth/password";

/**
 * ④ GİRİŞTE PAROLA HASH'İ YÜKSELTME (kurucu onayı 09-23).
 *
 * Eski hesapların hash'i maliyet-10 ya da (③'ten önce) NFC olmayan ham biçim olabilir;
 * bugüne kadar yalnız parola DEĞİŞİNCE yenileniyordu. Giriş rotası, TAM başarılı
 * girişten (parola + varsa ikinci faktör) sonra bunu çağırır. Sözleşme:
 *   · `sessionEpoch`e DOKUNMAZ — bu bir parola DEĞİŞİMİ değil, aynı parolanın daha
 *     güçlü saklanması; hiçbir oturum, "beni hatırla" ya da tanınan cihaz düşmez
 *     (üçü de epoch'a bağlı, hash'e bağlı hiçbir şey yok — ölçüldü).
 *   · CAS: yalnız hash girişte OKUNDUĞU gibiyse yazar. Arada parola sıfırlandıysa
 *     eski parolanın güçlü hash'i YENİSİNİN ÜSTÜNE yazılamaz ("raced").
 *   · KUYRUĞA GİRMEZ: parola kapısı doluysa ("busy") hiç beklemeden vazgeçer — arka
 *     plan işi meşru girişlerin sırasını uzatmamalı; bir sonraki girişte yeniden dener.
 *   · ASLA FIRLATMAZ: giriş zaten başarılı; yükseltme onu bozamaz ("failed").
 */
export type PasswordUpgradeOutcome = "upgraded" | "raced" | "busy" | "failed";

export async function upgradeStoredPasswordHash(
  userId: string,
  oldHash: string,
  password: string,
): Promise<PasswordUpgradeOutcome> {
  try {
    const next = await hashPasswordIfIdle(password);
    if (next === null) return "busy";
    const r = await prisma.user.updateMany({
      where: { id: userId, passwordHash: oldHash },
      data: { passwordHash: next },
    });
    return r.count === 1 ? "upgraded" : "raced";
  } catch {
    return "failed";
  }
}
