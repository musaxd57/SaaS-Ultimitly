// ---------------------------------------------------------------------------
// "Otomatik Gönderilenler" sayfalama çekirdeği.
//
// Ekran DÖRT bağımsız kaynaktan beslenir: gerçekten gönderilmiş oto-yanıt
// mesajları (Message) + rezervasyonun karşılama/giriş/çıkış damgaları
// (Reservation.welcomeSentAt / checkinSentAt / checkoutSentAt). Bunları tek bir
// SQL sorgusuyla birleştirmek mümkün değil (farklı tablolar, farklı tarih
// kolonları), o yüzden birleştirme burada, bellekte ve KANITLANABİLİR biçimde
// yapılır.
// ---------------------------------------------------------------------------

/** Bir sayfadaki kayıt sayısı (ops ekranı /sent/queue ile aynı his). */
export const SENT_PAGE_SIZE = 50;

/**
 * BİRLEŞİK ("Tümü") görünümün gezilebilir sayfa tavanı. Sebep aşağıdaki
 * over-fetch: N. sayfa için her kaynaktan N*SENT_PAGE_SIZE satır okunur, yani
 * derinlik lineer maliyet demektir. Tür seçildiğinde tek kaynak + skip/take
 * çalıştığı için TAM geçmiş orada sınırsız gezilebilir — tavan yalnız karma
 * görünümü ilgilendirir ve ekranda açıkça söylenir.
 */
export const MAX_MERGED_PAGE = 20;

/**
 * Tür seçiliyken derinlik tek kaynak + skip/take olduğu için ucuzdur, ama yine de
 * SINIRSIZ bırakılmaz: uydurma bir `?sayfa=99999999` değeri aksi hâlde devasa bir
 * OFFSET'e dönüşürdü. 10.000 sayfa = 500.000 kayıt — gerçek geçmişin çok ötesi.
 */
export const MAX_TYPED_PAGE = 10_000;

/**
 * Her biri KENDİ İÇİNDE yeniden-eskiye sıralı gelen kaynak dilimlerini tek bir
 * global sayfaya indirger.
 *
 * NEDEN over-fetch + kesme TAM sonuç verir: p. sayfayı K boyutuyla sunmak için
 * her kaynaktan en yeni p*K satır istenir. Diyelim bir x satırı global en yeni
 * p*K içinde ama KENDİ kaynağının en yeni p*K'sında değil — o hâlde o kaynakta
 * x'ten yeni p*K satır var ve bunların hepsi global olarak da x'ten yeni; yani
 * x global pencereye zaten giremezdi. Çelişki. Dolayısıyla birleşim pencerenin
 * tamamını daima içerir; sıralayıp kesmek KESİN sonuçtur.
 *
 * Eski ekran pencereden bağımsız olarak kaynak başına SABİT 100 satır çekiyordu
 * ve bu değişmezi ihlal ediyordu: 101. oto-yanıt, ekranda gösterilen bir
 * karşılamadan YENİ olsa bile sessizce kayboluyordu.
 */
export function mergeSentPage<T>(
  sources: readonly T[][],
  page: number,
  pageSize: number,
  whenOf: (item: T) => Date,
  keyOf: (item: T) => string,
): T[] {
  const all = sources.flat();
  all.sort((a, b) => compareSentRows(whenOf(a), keyOf(a), whenOf(b), keyOf(b)));
  const start = Math.max(0, (page - 1) * pageSize);
  return all.slice(start, start + pageSize);
}

/**
 * TAM SIRA: `when DESC, id DESC`. Zaman tek başına sıra vermez — aynı damgayı
 * taşıyan iki kayıt (toplu import, aynı saniyede iki damga) arasında hem
 * Postgres hem JS "herhangi bir" sıra seçmekte serbesttir, ve bu sıra iki farklı
 * sorgu arasında DEĞİŞEBİLİR. Sonuç klasik kararsız-sayfalama hatası: bir satır
 * 1. sayfada da 2. sayfada da çıkar (tekrar) ya da hiçbirinde çıkmaz (kayıp).
 *
 * `keyOf` HAM veritabanı id'si olmalı — ekrandaki önekli görüntü id'si (`r-…`,
 * `welcome-…`) DEĞİL. Sebep: over-fetch kanıtının ön koşulu, global sıranın her
 * kaynağın KENDİ sırasıyla (SQL `ORDER BY <kolon> DESC, "id" DESC`) birebir
 * örtüşmesi. Önek eklemek sırayı türe göre bozar ve kanıtı geçersiz kılar.
 */
export function compareSentRows(aWhen: Date, aKey: string, bWhen: Date, bKey: string): number {
  const dt = bWhen.getTime() - aWhen.getTime();
  if (dt !== 0) return dt;
  if (aKey === bKey) return 0;
  return aKey < bKey ? 1 : -1; // id DESC
}

/** `?sayfa=` değerini 1..max aralığına kelepçeler (çöp girdi → 1). */
export function clampPage(raw: string | undefined, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}
