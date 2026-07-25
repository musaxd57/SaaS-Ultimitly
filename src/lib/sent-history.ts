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
  // Kaynak sırası (dizideki indeks) SON sıralama anahtarı olarak taşınır. Ayrı
  // bir "rank" parametresi İSTENMEZ: indeks yapısı gereği kaynak İÇİNDE sabittir,
  // yani çağıranın yanlış bir rank vermesi imkânsızdır.
  const all = sources.flatMap((rows, sourceRank) => rows.map((row) => ({ row, sourceRank })));
  all.sort((a, b) =>
    compareSentRows(
      { when: whenOf(a.row), id: keyOf(a.row), rank: a.sourceRank },
      { when: whenOf(b.row), id: keyOf(b.row), rank: b.sourceRank },
    ),
  );
  const start = Math.max(0, (page - 1) * pageSize);
  return all.slice(start, start + pageSize).map((x) => x.row);
}

export interface SentSortKey {
  when: Date;
  /** HAM veritabanı id'si — ekrandaki önekli görüntü id'si DEĞİL. */
  id: string;
  /** Kaynak sırası. SON anahtar olduğu için kaynak-içi sırayı ETKİLEMEZ. */
  rank: number;
}

/**
 * TAM SIRA: `when DESC → ham id DESC → kaynak sırası ASC`.
 *
 * Zaman tek başına sıra vermez — aynı damgayı taşıyan iki kayıt (toplu import,
 * aynı saniyede iki damga) arasında hem Postgres hem JS "herhangi bir" sıra
 * seçmekte serbesttir, ve bu sıra iki farklı sorgu arasında DEĞİŞEBİLİR. Sonuç
 * klasik kararsız-sayfalama hatası: bir satır 1. sayfada da 2. sayfada da çıkar
 * (tekrar) ya da hiçbirinde çıkmaz (kayıp).
 *
 * `id` HAM veritabanı id'si olmalı. Sebep: over-fetch kanıtının ön koşulu, global
 * sıranın her kaynağın KENDİ sırasıyla (SQL `ORDER BY <kolon> DESC, "id" DESC`)
 * birebir örtüşmesi. Önekli görüntü id'si sırayı türe göre bozar ve kanıtı
 * geçersiz kılar.
 *
 * `rank` neden var: ham id'ler AYRI TABLOLARDAN geliyor. Uygulamanın cuid üretimi
 * göz önüne alındığında pratik ihtimali yok denecek kadar düşük olsa da, iki
 * farklı tablodaki satırın aynı `when` VE aynı `id` taşımasını veritabanı
 * yasaklamıyor — o durumda sıra yine tanımsız kalırdı. Kaynak sırası EN SON
 * anahtar olduğu için kaynak-içi SQL sırasına dokunmaz (bir kaynağın içinde rank
 * sabittir, hiç devreye girmez) ve sıralamayı tam (total) hâle getirir.
 */
export function compareSentRows(a: SentSortKey, b: SentSortKey): number {
  const dt = b.when.getTime() - a.when.getTime();
  if (dt !== 0) return dt;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1; // id DESC
  return a.rank - b.rank; // kaynak sırası ASC — SON anahtar
}

/** `?sayfa=` değerini 1..max aralığına kelepçeler (çöp girdi → 1). */
export function clampPage(raw: string | undefined, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}
