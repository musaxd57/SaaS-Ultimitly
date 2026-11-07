import "server-only";
import { prisma } from "@/lib/db";
import { durableOutboxEnabled } from "@/lib/outbox/flag";

// ---------------------------------------------------------------------------
// "Teslim edilmemiş taslak" süzgeçleri ANAHTARDAN değil, KUYRUK SATIRININ VARLIĞINDAN açılır (Opus F3, 10-16 — O1 geri dönüşü).
// Kuyrukta iptal / başarısız / engellenmiş kalmış bir cevap misafire ULAŞMADI; anahtar kapatılınca süzgeç de kapanırsa misafir yeniden
// yazdığında bu cevap modele "verilmiş" görünür ("belirttiğim gibi…") ve selam sayımı yanlış olur. Boşaltma zaten anahtardan bağımsız
// (`hasDrainableOutbox`); süzgeçler de aynı kurala bağlanır. Kuyruk HİÇ kullanılmadıysa (tablo boş — bugünkü canlı) maliyet tek
// `LIMIT 1` okuması (boş tabloda anlık); satır bulunduğu an 60 sn bellekte tutulur (satırlar yalnız saklama süresiyle silinir).
// ---------------------------------------------------------------------------

const POSITIVE_TTL_MS = 60_000;
let seenAt = 0;

/** Kuyruk tablosunda en az bir satır var mı (bu süreçte son 60 sn içinde görüldüyse sorgusuz evet). */
export async function outboxHasRows(): Promise<boolean> {
  if (Date.now() - seenAt < POSITIVE_TTL_MS) return true;
  const row = await prisma.messageOutbox.findFirst({ select: { id: true } });
  if (row) seenAt = Date.now();
  return row !== null;
}

/** Süzgeçler açık mı: anahtar açık YA DA kuyrukta satır var (anahtar kapatıldıktan sonra da). */
export async function undeliveredFilterActive(): Promise<boolean> {
  return durableOutboxEnabled() || (await outboxHasRows());
}

/** Test yardımcısı. */
export function __resetOutboxPresence(): void {
  seenAt = 0;
}
