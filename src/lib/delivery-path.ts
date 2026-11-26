// ---------------------------------------------------------------------------
// GİDEN MESAJIN TESLİM YOLU — kapalı küme (`Message.deliveryPath`, migration 98 — Codex 11-17 / kurucu 11-18). YAPRAK modül: çalışma anında
// hiçbir şey import etmez (yalnız tür), istemci de okuyabilir.
//
// Soru: bizim YAZDIĞIMIZ giden mesaj satırı hangi yoldan gitti? Teslim SONUCU değildir (sonuç kuyruk satırında / gönderim cevabında —
// `delivery-outcome.ts`); yalnız yol. Kanaldan eşitlenen (senkronun içe aktardığı) satır, gelen mesaj ve bu alandan önceki kayıt NULL kalır.
// Ayrı dosya (sonuç sözlüğüne eklenmedi): iki ayrı soru, iki ayrı küme — biri ötekinden türetilmez; yalnız yerel rota eşlemesi ortak bilgiyi
// (rota çözümünün iki yerel sonucu) okur.
// ---------------------------------------------------------------------------

import type { LocalDeliveryOutcome } from "@/lib/delivery-outcome";

export const DELIVERY_PATHS = [
  /** Dış kanala doğrudan istek (gönder → kanal cevabı → satır). */
  "direct",
  /** Kalıcı kuyruk satırıyla (satır + gönderim niyeti aynı işlemde; işçi teslim eder). */
  "queue",
  /** İç QR sohbeti: misafir sohbet sayfasında görür (dış kanal yok). */
  "qr",
  /** Hedef yok (elle açılmış konuşma): yalnız kaydedildi, misafire hiçbir kanaldan gitmedi. */
  "local",
] as const;

export type DeliveryPath = (typeof DELIVERY_PATHS)[number];

/** Yazan yerler dizeyi elle yazmaz — buradan alır. */
export const DELIVERY_PATH = {
  direct: "direct",
  queue: "queue",
  qr: "qr",
  local: "local",
} as const satisfies Record<DeliveryPath, DeliveryPath>;

export function isDeliveryPath(value: unknown): value is DeliveryPath {
  return typeof value === "string" && (DELIVERY_PATHS as readonly string[]).includes(value);
}

/**
 * Kuyruğa girmeyen gönderimin yolu, rota çözümünün YEREL sonucundan (`channels/outbound.ts` `deliveryOutcomeOfRoute`; ek sorgu yok):
 * iç QR → "qr" · hedef yok → "local" · dış rota (yerel sonuç yok) → "direct".
 */
export function deliveryPathOfLocalOutcome(local: LocalDeliveryOutcome | null): DeliveryPath {
  if (local === "qr_visible") return DELIVERY_PATH.qr;
  if (local === "local_only") return DELIVERY_PATH.local;
  return DELIVERY_PATH.direct;
}
