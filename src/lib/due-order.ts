/**
 * EN ESKİ ÖNCE, TAVANLA — sıralama veritabanında DEĞİL burada (ölçek turu 11-04, DB-1).
 *
 * Oto-yanıt aday sorgusu eskiden `ORDER BY "lastMessageAt" ASC LIMIT 25` ile koşuyordu. Konuşma tablosundaki GLOBAL
 * `lastMessageAt` dizini PostgreSQL'i "dizinde en eskiden yürü, işletmeye ait + uygun ilk 25 satırda dur" planına çekiyor; uygun
 * satırlar (cevapsız + damgasız) EN YENİLERDE olduğu için neredeyse bütün tablo geziliyor (sentetik 5.000 dairede 25 daireli işletme
 * başına geçiş 320–420 ms, plan önbelleğine göre kararsız; aynı sorgu sıralamasız 1,25 ms). Uygunluk süzgeci SQL'de KALIR (açlık
 * kuralı, `auto-reply-starvation.test.ts`); yalnız sıralama + tavan buraya taşındı → seçilen küme ve sıra aynı.
 *
 * Eşit `lastMessageAt`te `id` eşitlik bozucu (çalışma dersi 09-27: aynı damgalı satırların sırası kimlikle kesinleşir). Yaprak modül.
 */
export function oldestFirst<T extends { id: string; lastMessageAt: Date }>(rows: readonly T[], cap: number): T[] {
  return [...rows]
    .sort((a, b) => a.lastMessageAt.getTime() - b.lastMessageAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, cap));
}
