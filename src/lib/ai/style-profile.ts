// ---------------------------------------------------------------------------
// ÜSLUP PROFİLİ SÜRÜMÜ (F13, Codex denetimi 09-05; düzeltme 09-26 — kurucu: "kontrol etmeden cevap vermesin").
//
// `Organization.aiStyleProfile`, ev sahibinin ORG GENELİNDEKİ son 40 cevabından bir modelle damıtılır. Eski özetleyici
// iki bölüm yazıyordu: TARZ + "SIK SORULAN SORULAR" (otopark, bagaj, ulaşım, erken giriş / geç çıkış yaklaşımı, çevre
// önerileri) — ve cevap istemi "Bilgi Tabanı'nda yoksa bu bölümü temel alarak yanıtla" diyordu. Sonuç: A dairesi için
// yazılmış otopark cevabı B dairesinin misafirine OLGU diye gidebiliyordu; bilgi mülk kapsamlı değil, sürümsüz, ev
// sahibinin onayından geçmemiş (bilgi tabanının onay kapısını — `kb-review.ts` — yan kapıdan atlıyor).
//
// Kural: profil YALNIZ ÜSLUPTUR. Özetleyici artık yalnız tarz yazar ve kod, kaydederken ilk satıra bu sürüm işaretini
// koyar. İşaretsiz (eski) profil hiçbir isteme GİRMEZ (`styleProfileBody` → null) ve yenileme onu 24 saat beklemeden
// yeniler. Model işaretli profile yine olgu yazabilir (model ricası deterministik değildir) — o yüzden istem rehberi
// olgu kaynağı saymaz ve iddia desteği ölçümü profili destek saymaz. Saf; DB yok.
// ---------------------------------------------------------------------------

/** Kodun kaydettiği profilin İLK satırı (model yazmaz; işaret birebir aranır). */
export const STYLE_PROFILE_MARKER = "[üslup rehberi v2 — yalnız üslup]";

/** Kaydedilecek biçim: sürüm işareti + özetleyicinin metni. */
export function markStyleProfile(text: string): string {
  return `${STYLE_PROFILE_MARKER}\n${text.trim()}`;
}

/** Kayıtlı profil güncel sürüm mü (işaret ilk satır, birebir). */
export function isCurrentStyleProfile(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(`${STYLE_PROFILE_MARKER}\n`);
}

/**
 * İsteme girebilecek gövde: YALNIZ güncel sürümün işaretten sonrası. Eski (işaretsiz) profil `null` — içinde org
 * genelinden damıtılmış olgular olabilir; yenilenene kadar üslup rehberi hiç verilmez (en kötü hâli biraz daha genel
 * bir üslup; olgu taşımak ise yanlış bilgiyi misafire göndermektir).
 */
export function styleProfileBody(stored: string | null | undefined): string | null {
  if (!isCurrentStyleProfile(stored)) return null;
  const body = (stored as string).slice(STYLE_PROFILE_MARKER.length + 1).trim();
  return body.length > 0 ? body : null;
}
