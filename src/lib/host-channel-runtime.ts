import "server-only";

import type { HostChannelTransport } from "@/lib/host-channel/types";
import { createWhatsAppTransport, whatsAppConfigFromEnv } from "@/lib/host-channel/whatsapp/transport";

// ---------------------------------------------------------------------------
// Ev sahibi soru kanalının SAĞLAYICI SEÇİCİSİ (tasarım §4). Çekirdek (`host-channel/*.ts`) hiçbir bağdaştırıcıyı import etmez (V0); hangi
// sağlayıcının kullanılacağına yalnız bu dosya karar verir. Bugün tek sağlayıcı WhatsApp Cloud API: kimlik bilgileri eksikse `null` → çağıran
// bugünkü e-postaya düşer. Testler sahte aktarımı `__setHostChannelTransportForTest` ile verir (üretimde açılamaz).
// ---------------------------------------------------------------------------

let testTransport: HostChannelTransport | null | undefined;

export function hostChannelTransport(): HostChannelTransport | null {
  if (testTransport !== undefined) return testTransport;
  const cfg = whatsAppConfigFromEnv();
  return cfg ? createWhatsAppTransport(cfg) : null;
}

/** Yalnız test: `undefined` → gerçek seçiciye dön. Üretimde fırlatır. */
export function __setHostChannelTransportForTest(t: HostChannelTransport | null | undefined): void {
  if (process.env.NODE_ENV === "production") throw new Error("__setHostChannelTransportForTest is test-only");
  testTransport = t;
}
