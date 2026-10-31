import "server-only";

import type { HostChannelTransport } from "@/lib/host-channel/types";
import { createWhatsAppTransport, whatsAppConfigFromEnv } from "@/lib/host-channel/whatsapp/transport";
import { whatsAppWebhookConfigFromEnv } from "@/lib/host-channel/whatsapp/webhook";

// ---------------------------------------------------------------------------
// Ev sahibi soru kanalının SAĞLAYICI SEÇİCİSİ (tasarım §4). Çekirdek (`host-channel/*.ts`) hiçbir bağdaştırıcıyı import etmez (V0); hangi
// sağlayıcının kullanılacağına yalnız bu dosya karar verir. Bugün tek sağlayıcı WhatsApp Cloud API: kimlik bilgileri eksikse `null` → çağıran
// bugünkü e-postaya düşer. Testler sahte aktarımı `__setHostChannelTransportForTest` ile verir (üretimde açılamaz).
// 🚨 GELEN UÇ HAZIR DEĞİLSE GÖNDERİM YOK (inceleme 10-30 gece, P2): uygulama gizli anahtarı / numara kimliği eksikken web kancası gelen mesajı
// işleyemez — ev sahibinin cevabı da "DUR"u da kaybolurdu, ama soru gitmeye devam ederdi. İki yön birlikte yapılandırılmadıkça e-posta.
// ---------------------------------------------------------------------------

let testTransport: HostChannelTransport | null | undefined;

export function hostChannelTransport(): HostChannelTransport | null {
  if (testTransport !== undefined) return testTransport;
  const cfg = whatsAppConfigFromEnv();
  if (!cfg || !whatsAppWebhookConfigFromEnv()) return null;
  return createWhatsAppTransport(cfg);
}

/** Yalnız test: `undefined` → gerçek seçiciye dön. Üretimde fırlatır. */
export function __setHostChannelTransportForTest(t: HostChannelTransport | null | undefined): void {
  if (process.env.NODE_ENV === "production") throw new Error("__setHostChannelTransportForTest is test-only");
  testTransport = t;
}
