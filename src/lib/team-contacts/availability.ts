import "server-only";

import { hostChannelSecret } from "@/lib/host-channel/binding";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import { whatsAppWebhookConfigFromEnv } from "@/lib/host-channel/whatsapp/webhook";
import { teamContactsEnabled } from "./flag";
import { teamPhoneNumberId, teamWhatsAppNumber } from "./flag";
import { staffWaMeLink } from "./core";

/**
 * Personel WhatsApp bağı kurulabilir mi: numara arama anahtarı + web kancası imza ayarı (ev sahibi numarasıyla aynı Meta uygulaması) + ayrı
 * temizlikçi numarasının kimliği + görünür numarası. Biri eksikse kod ÜRETİLMEZ — doğrulanamayacak kod ev sahibini yanıltırdı.
 */
export function staffWhatsAppAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    teamContactsEnabled(env) &&
    hostChannelFlagsFromEnv(env).channel && // web kancası yalnız bu anahtarla uyanır
    hostChannelSecret(env) && whatsAppWebhookConfigFromEnv(env) && teamPhoneNumberId(env) && staffWaMeLink(teamWhatsAppNumber(env), "EKIP-000000"),
  );
}
