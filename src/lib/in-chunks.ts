/**
 * BÜYÜK `IN (…)` LİSTESİ PARÇALI SORULUR (ölçek turu 11-04, DB-4).
 *
 * PostgreSQL bir hazır ifadede en çok 32.767 bağ değişkeni kabul eder ve Prisma 6 `in` listesini kendisi PARÇALAMAZ: sınır aşılınca
 * sorgu `P2035 too many bind variables` ile düşer (ölçüldü: rapor sayfasının yanıt oranı zinciri 200 daireli işletmede çöküyordu).
 * Kimlikler tekilleştirilip `size`lık dilimlerle SIRAYLA sorulur (veritabanına aynı anda tek sorgu), sonuçlar dilim sırasıyla eklenir.
 * Sıra yalnız DİLİM İÇİNDE korunur: çağıran, sırası önemli satırları (ör. bir konuşmanın mesajları) aynı dilime düşecek anahtarla parçalar.
 * Yaprak modül.
 */
export const IN_LIST_CHUNK = 10_000;

export async function findInChunks<K, T>(
  keys: readonly K[],
  fetch: (chunk: K[]) => Promise<T[]>,
  size: number = IN_LIST_CHUNK,
): Promise<T[]> {
  const unique = [...new Set(keys)];
  const step = Math.max(1, Math.floor(size));
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += step) {
    const rows = await fetch(unique.slice(i, i + step));
    for (const r of rows) out.push(r);
  }
  return out;
}
