// ---------------------------------------------------------------------------
// GÖNDERİM SONUCU — kapalı küme (Codex 11-17 C1). YAPRAK modül: hiçbir şey import etmez, istemci de okur.
//
// Üç ayrı soru tek bitle cevaplanıyordu: "mesaj satırı var" = "misafire gitti" = "talep cevaplandı". Bu küme yalnız İKİNCİSİNİN dürüst
// cevabıdır — kanal kabul etti mi, sırada mı, belirsiz mi, kesinlikle gitmedi mi, yoksa hiç kanala gitmeyecek miydi. "Talep çözüldü mü"
// ayrı sorudur (ürün kararı) ve buradan türetilmez.
//
// Eşleyiciler kaynaklarının yanında (tek kaynak): kuyruk durumundan `outbox/state.ts` `deliveryOutcomeOfOutboxStatus` (aynı dosyadaki
// `NOT_DELIVERED_STATUSES` / `UNRESOLVED_DELIVERY_STATUSES` ile), giden rotadan `channels/outbound.ts` `deliveryOutcomeOfRoute`.
// ---------------------------------------------------------------------------

export const DELIVERY_OUTCOMES = [
  /** Hedef yok (elle açılmış konuşma): yalnız Lixus'a kaydedildi, misafire HİÇBİR kanaldan gitmedi. */
  "local_only",
  /** İç QR sohbeti: misafir sohbet sayfasında görür (dış kanal yok). */
  "qr_visible",
  /** Kalıcı kuyrukta: henüz denenmedi / deneniyor. */
  "queued",
  /** Kanal (sağlayıcı) kabul etti. Okundu / telefona ulaştı DEĞİL — sağlayıcı teslim makbuzu vermiyor. */
  "channel_accepted",
  /** Sonuç belirsiz: ulaşmış OLABİLİR ("iletilemedi" denmez — kalıcı karar). */
  "unverified",
  /** Kesinlikle gitmedi (kesin ret · iptal · abonelik engeli). */
  "not_delivered",
] as const;

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** Dış kanala hiç çıkmayan iki sonuç (rota çözümünden bilinir, gönderim beklemez). */
export type LocalDeliveryOutcome = Extract<DeliveryOutcome, "local_only" | "qr_visible">;

export function isDeliveryOutcome(value: unknown): value is DeliveryOutcome {
  return typeof value === "string" && (DELIVERY_OUTCOMES as readonly string[]).includes(value);
}

// ── Ev sahibine görünen metinler (TEK yer; kurucu onayına sunuldu — başka yere kopyalanmaz) ──

/** Kanala bağlı olmayan konuşmada kaydedilen cevabın duyurusu (role=status). */
export const LOCAL_REPLY_RECORDED_TEXT = "Cevabınız kaydedildi. Bu konuşma bir kanala bağlı olmadığı için misafire gönderilmedi.";

/** Kanala bağlı olmayan (QR de olmayan) konuşmada yazma alanının üstündeki kalıcı not. */
export const LOCAL_THREAD_COMPOSER_NOTE = "Bu konuşma bir kanala bağlı değil. Yazdığınız cevap yalnız burada kaydedilir, misafire gönderilmez.";
