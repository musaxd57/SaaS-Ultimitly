import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// SORGU OLAYI BARİYERİ (CI 1841, 11-21). Prisma'nın sorgu olayı (`$on("query")`) motorun geri çağrısıyla gelir; SON sorgunun olayı,
// sorgunun sonucu döndükten SONRA gelebilir (ölçüldü: 400 çağrıda 2 kez, yükten bağımsız). Sayacı sonuç döner dönmez kapatan sorgu
// sayımı testleri bu yüzden ara sıra son sorguları kaçırıyordu (CI'da `reservation-tasks-fastpath-query-count` dört yerine iki sorgu
// gördü; yerelde üç tam kapıda yeşildi). Sabit bekleme yerine kesin sıra: aynı istemciden bir işaret sorgusu atılır ve olayı görülene kadar
// beklenir — olaylar motorun sırasıyla gelir, işaret görüldüğünde ondan önceki her sorgunun olayı gelmiştir. İşaret satırı listeden silinir.
// İkinci sapma (aynı ölçüm, 1.500 çağrıda 4 kez): bağlantı havuzunun KENDİ yoklama sorgusu (çıplak `SELECT 1`) de olay üretir ve sayıma
// karışır — ölçülen işin sorgusu değildir, listeden çıkarılır (ürün kodu ölçülen işlerde çıplak `SELECT 1` atmaz).
// ---------------------------------------------------------------------------

const BARRIER_TAG = "lixus_query_event_barrier";
const POOL_PING = /^\s*SELECT 1\s*$/i;

function dropInPlace(rows: string[], drop: (q: string) => boolean): void {
  for (let i = rows.length - 1; i >= 0; i--) if (drop(rows[i])) rows.splice(i, 1);
}

export async function flushQueryEvents(client: PrismaClient, counter: { rows: string[] }, timeoutMs = 10_000): Promise<void> {
  await client.$queryRawUnsafe(`SELECT 1 AS "${BARRIER_TAG}"`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (counter.rows.some((q) => q.includes(BARRIER_TAG))) {
      dropInPlace(counter.rows, (q) => q.includes(BARRIER_TAG) || POOL_PING.test(q));
      return;
    }
    // Sayaç kapalıysa ya da olay hiç gelmiyorsa sessiz kalmaz: eksik sayım "kazanç" gibi görünürdü.
    if (Date.now() > deadline) throw new Error("sorgu olayı bariyeri gelmedi — sayaç açık mı, istemci sorgu olayı yayıyor mu?");
    await new Promise((r) => setTimeout(r, 2));
  }
}
