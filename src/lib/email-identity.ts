import { z } from "zod";

// ---------------------------------------------------------------------------
// E-POSTA KİMLİĞİ — tek normalizasyon noktası.
//
// Bir hesabın kimliği e-posta adresidir (`User.email @unique`). O yüzden "aynı
// adres mi" sorusuna uygulamanın HER yerinde AYNI cevabın verilmesi bir güvenlik
// özelliğidir, stil meselesi değil: iki giriş noktası farklı normalize ederse
// kimlik uzayı ikiye bölünür ve "kayıt olduğun hesap" ile "şifresini
// sıfırlayabildiğin hesap" farklı satırlar olabilir.
//
// Bugün kayıt/giriş/şifre-sıfırlama/doğrulama-tekrar yollarının hepsi tesadüfen
// aynı şeyi yapıyordu (trim + toLowerCase). Bu modül onu tesadüf olmaktan
// çıkarıp sözleşmeye çeviriyor; testi de sözleşmeyi pinliyor.
//
// KASITLI OLARAK YAPILMAYAN: gmail nokta/`+etiket` sadeleştirmesi. `musa+1@` ile
// `musa@` AYNI posta kutusudur ama FARKLI hesaplardır — bunu birleştirmek kimlik
// davranışını değiştirir (bugünkü satırlar çakışabilir) ve kalıcı olarak
// saklanacak bir kanonik kolon ister (migration). Yalnız ANALİZ için
// `canonicalMailbox()` var; kimlik kararlarında KULLANILMAZ.
// ---------------------------------------------------------------------------

/**
 * Kimlik için kullanılacak biçim. Şema doğrulaması (`z.string().email()`) zaten
 * ASCII olmayan adresleri reddediyor — burada bilerek ek bir dönüşüm yok: Unicode
 * katlaması yapmak, reddedilen bir şeyi kabul edilir hâle getirme riski taşır.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Biçim hakemi — kayıt/giriş şemalarıyla AYNI doğrulayıcı. */
const EMAIL_SHAPE = z.string().email().max(254);

/**
 * Adres, kimlik yoluna girebilecek biçimde mi?
 *
 * Zod'un e-posta doğrulayıcısı ASCII-dışını reddeder (tam-genişlik harf, sıfır-
 * genişlik boşluk, Kiril "а", noktasız "ı", RTL override...). Kayıt ve giriş
 * şemaları bunu zaten kullanıyordu; şifre-sıfırlama ve doğrulama-tekrar yolları
 * ise EL YAPIMI bir regex kullanıyordu ve o regex bu karakterlerin hepsini KABUL
 * ediyordu. Sömürülebilir değildi (öyle bir adresle hesap yaratılamıyor, arama boş
 * dönüyor) ama iki farklı hakem demekti. Artık tek hakem var.
 *
 * Daha sıkı olması meşru kullanıcıyı engelleyemez: var olan HER hesap kayıt
 * şemasından geçtiği için zaten bu doğrulamayı geçen bir adrese sahiptir.
 */
export function isValidEmailShape(value: string): boolean {
  return EMAIL_SHAPE.safeParse(value).success;
}

/** Aynı posta kutusuna düşen adreslerin ortak biçimi (gmail nokta/+etiket). */
const DOTTED_ALIAS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * SADECE ANALİZ/TEŞHİS içindir — kimlik kararı, arama veya benzersizlik için
 * ASLA kullanma. `musa+1@gmail.com`, `m.usa@gmail.com` ve `musa@gmail.com` tek
 * bir posta kutusuna düşer; operatör panelindeki "aynı kutudan çok hesap"
 * kanaryası bunu sayar. Tanınmayan alan adlarında yalnız `+etiket` atılır
 * (nokta kuralı sağlayıcıya özeldir; genelleştirmek yanlış eşleşme üretir).
 */
export function canonicalMailbox(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return normalized;
  let local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOTTED_ALIAS_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

// --- Uyarı adresi sahipliği ------------------------------------------------

/**
 * Bu adres, org'un KENDİ ekibinden birine mi ait?
 *
 * Uyarı/rapor e-postalarının hedefi yalnız buradan geçebilir. Sebebi bir kolaylık
 * değil güvenlik: hedef serbest bırakılırsa uygulama, doğrulanmış alan adımızdan
 * üçüncü kişilere metin gönderen bir RÖLEYE dönüşür ve gönderim itibarımız — yani
 * TÜM müşterilerin kimlik e-postaları — bir müşterinin insafına kalır.
 */
export async function isOrgMemberEmail(organizationId: string, email: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db");
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const user = await prisma.user.findFirst({
    where: { organizationId, email: normalized },
    select: { id: true },
  });
  return user !== null;
}
