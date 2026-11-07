import "server-only";

// Master switch for the Durable Outbox (#8). Default OFF: when unset, NOTHING
// enqueues and no worker runs, so the live send path is EXACTLY today's
// deliver-then-persist + claim-then-send. Flip to "1" (per-env) to route outbound
// sends through the durable outbox. See DEPLOYMENT.md.
export function durableOutboxEnabled(): boolean {
  return process.env.DURABLE_OUTBOX_ENABLED === "1";
}

/**
 * Bu işletmenin giden mesajı kalıcı kuyruktan mı gider (O1 ilk deneme, kurucu 10-16). Ana anahtar `DURABLE_OUTBOX_ENABLED=1` + işletme listesi
 * `DURABLE_OUTBOX_ORG_IDS`: virgüllü işletme kimlikleri YALNIZ listedekileri, `*` BÜTÜN işletmeleri açar. Liste YOKSA ya da boşsa KİMSE
 * açılmaz (Opus F10: listeyi silmek kuyruğu bütün işletmelere açmasın — güvenli yön bugünkü yoldur). Ana anahtar kapalıysa liste hiçbir şey açmaz.
 * GÖNDERİM kararları (kuyruğa yaz / satır içi gönder) bunu kullanır; OKUMA süzgeçleri ve boşaltma işçisi küresel anahtara bakar (listedeki
 * olmayan işletmenin kuyruk satırı yoktur → süzgeç boş döner; boşaltma bekleyen her satırı anahtardan bağımsız gönderir).
 */
export function durableOutboxEnabledFor(organizationId: string): boolean {
  if (!durableOutboxEnabled()) return false;
  const ids = (process.env.DURABLE_OUTBOX_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes("*") || ids.includes(organizationId);
}

/**
 * BEKLEYEN GÖNDERİMLERİ DURAKLAT (kurucu 10-16: "yeni işleri kuyruğa almayı durdurmak ile bekleyen gönderimleri durdurmak AYRI işlemler
 * olsun; hangisinin ne yaptığını açık göster; başlamış dış gönderimin geri alınabileceğini varsayma"). Yalnız tam "1".
 *  · Açıkken işçi `pending` satırı TALEP ETMEZ → sağlayıcıya YENİ gönderim gitmez; satırlar bekler (deneme sayısı artmaz, kaybolmaz).
 *  · Gönderimi BAŞLAMIŞ satır (`sending`) geri alınamaz — o anki istek biter, sonucu yazılır. Çöken gönderimin kurtarılması ve sonucu
 *    belirsiz satırın uzlaştırması (`ambiguous` → YENİDEN GÖNDERİLMEZ; bugünkü uzlaştırma sağlayıcıya sormaz, satırı incelemeye alır) sürer.
 *  · Yalnız KUYRUKTAKİ mesajları durdurur: kuyruk kapalı (ya da listede olmayan) işletmenin anında gönderimleri ve kimlik e-postası kuyruğu
 *    bu anahtardan ETKİLENMEZ (Haiku 10-16; tüm gönderimleri durduran tek şalter ayrı bir karar).
 *  · Kuyruğa YENİ iş alma ayrı anahtardır (`DURABLE_OUTBOX_ENABLED` + liste): duraklatma onu değiştirmez.
 */
export function outboxDeliveryPaused(): boolean {
  return process.env.OUTBOX_DELIVERY_PAUSED === "1";
}

