import "server-only";

import { getConnectionInfo, getOrgHospitableToken, handleProviderAuthFailure } from "@/lib/hospitable-credentials";
import { getActiveConnection } from "./connections";
import type { MessagingAccess } from "./access";

// ---------------------------------------------------------------------------
// HOSPITABLE ERİŞİM ÇÖZÜCÜSÜ (V0.8) — geçici köprü sağlayıcısı.
//
// Çekirdeğin eskiden doğrudan çağırdığı üç fonksiyona AYNI argümanlarla devreder; davranış birebir. Kimlik bilgisinin
// nereden geldiği (bağlantı satırı · org kolonları · kurucu org'un env fallback'i), OAuth yenilemesi ve 401 / 403
// sonrası iptal kararı `hospitable-credentials.ts`te kalır — bu dosya yalnız sınırı çizer.
// ---------------------------------------------------------------------------

export const hospitableMessagingAccess: MessagingAccess<"hospitable"> = {
  provider: "hospitable",
  credentialFor: (organizationId) => getOrgHospitableToken(organizationId),
  onCredentialRejected: (organizationId, status, rejectedToken) =>
    handleProviderAuthFailure(organizationId, status, rejectedToken),
  isConnected: async (organizationId) => (await getConnectionInfo(organizationId)).connected,
  activeConnectionId: async (organizationId) => (await getActiveConnection(organizationId, "hospitable"))?.id ?? null,
};
