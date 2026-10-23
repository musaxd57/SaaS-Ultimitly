import { KB_CHAR_BUDGET, KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// BİLGİ TABANI BLOĞUNUN SATIRI — TEK KAYNAK (09-27, #209). Kurucu kararı (09-27): "30 veya daha az kayıtlı bilgi tabanı sınırı
// yalnız birkaç düzine karakter aşıyorsa, 6.000 karakterlik seçime geçip kayıt düşürmek yerine dar ek payla kayıtların tamamını
// koruyalım. Büyük aşımda bu istisna uygulanmasın. Ön hesap ile gerçek paketleme aynı biçimlendirilmiş uzunluğu ölçmeli; satır
// ayraçları da hesaba katılmalı. Ek pay yalnız bu küçük-KB yolu için geçerli olsun, genel bütçe büyümesin."
// Ölçülen kusur: seçicinin "tamamı sığar" ön hesabı kalem başına +6 sayıyordu, paketleyicinin satırı +7 ve satır ayracı +1 —
// 30 kalemlik bir bilgi tabanı ön hesapta 24.000'e sığıp paketlemede son kalemini DÜŞÜREBİLİYORDU (model "yer sınırı" notunu
// görüp o konuyu insana devrediyordu). Artık ikisi bu dosyadaki satırı ölçer.
// YAPRAK: yalnız sabitleri içe aktarır (retrieval ile istem arasında döngü olmasın).
// ---------------------------------------------------------------------------

/**
 * Kalem metnindeki blok ayraç biçimini ("<<KB_END>>") etkisizleştirir — isteme giren her kalem bundan geçer.
 * 🚨 SABİT NOKTAYA KADAR (10-01, 15 ajan incelemesi A07, ölçüldü): tek geçiş iç katmanı silip dış katmanı GERÇEK ayraca çeviriyordu —
 * "<<<«KB_END»>>>" → "<<KB_END>>" (bilgi tabanı bloğunu kapatıp sahte bir blok açabilirdi). Değişiklik bitene kadar en çok 4 geçiş;
 * hâlâ ayraç biçimi kalıyorsa (iç içe ayraç saldırısı) ayraç karakterleri TÜMDEN silinir — ayraç biçimi hiçbir yolla kalamaz, maliyet
 * sınırlı (geçiş sayısı sabit).
 */
export function defuseBlockDelimiters(v: string): string {
  let out = v;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(GENERIC_FENCE, "$1").replace(OUR_FENCE_NAME, "$1");
    if (next === out) return out;
    out = next;
  }
  return GENERIC_FENCE_TEST.test(out) || OUR_FENCE_NAME_TEST.test(out) ? out.replace(FENCE_BRACKETS, "") : out;
}

const GENERIC_FENCE = /<<\s*([A-Z_]{2,})\s*>>/gu;
const GENERIC_FENCE_TEST = /<<\s*[A-Z_]{2,}\s*>>/u;
const FENCE_BRACKETS = /[<>«»≪≫＜＞]/gu;

/**
 * KENDİ ayraç ADLARIMIZIN diğer yazımları (09-28 inceleme ajanı — misafir dedektörüyle AYNI sınıf, `fallback.ts`): küçük harf,
 * boşluk / tire / nokta ayırıcı, tek açılı, «» / ≪≫ / tam genişlik parantez. Genel "<<sözcük>>" DEĞİL (Fransızca tırnak).
 */
const OUR_FENCE_NAME =
  /[<«≪＜]{1,2}\s*((?:guest[\s_.\-—–]*message|history|kb|offer|style|samples|host[\s_.\-—–]*instructions)[\s_.\-—–]*(?:start|end))\s*[>»≫＞]{1,2}/giu;
const OUR_FENCE_NAME_TEST =
  /[<«≪＜]{1,2}\s*(?:guest[\s_.\-—–]*message|history|kb|offer|style|samples|host[\s_.\-—–]*instructions)[\s_.\-—–]*(?:start|end)\s*[>»≫＞]{1,2}/iu;

/** İsteme giren bilgi tabanı satırı (paketleyicinin yazdığı AYNEN). */
export function kbLine(k: { category: string; title: string; content: string }): string {
  return `- [${k.category.toUpperCase()}] ${defuseBlockDelimiters(k.title)}: ${defuseBlockDelimiters(k.content)}`;
}

/** Satırların toplam uzunluğu, satır ayraçlarıyla (paketleyicinin bütçeye saydığı uzunluk). */
export function kbBlockChars(items: readonly { category: string; title: string; content: string }[]): number {
  let n = 0;
  items.forEach((k, i) => {
    n += kbLine(k).length + (i > 0 ? 1 : 0);
  });
  return n;
}

/** Küçük-KB dar ek payı: "birkaç düzine karakter" (30 kalemin eski ön hesap farkı en çok 59 karakterdi). */
export const SMALL_KB_MARGIN_CHARS = 60;

/**
 * Bilgi tabanının TAMAMI isteme girer mi (küçük-KB yolu): en çok `maxItems` kalem VE biçimli blok bütçe + dar ek paya sığıyor.
 * Seçici (seçim yapılmaz) ve paketleyici (hiçbir kalem düşmez) AYNI kuralı kullanır.
 */
export function kbFitsWhole(items: readonly { category: string; title: string; content: string }[], maxItems: number = KB_ITEM_CAP): boolean {
  return items.length > 0 && items.length <= maxItems && kbBlockChars(items) <= KB_CHAR_BUDGET + SMALL_KB_MARGIN_CHARS;
}
