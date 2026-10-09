import "server-only";

// Channel Layer giriş noktası (V0.1). Çekirdek YALNIZ bunu import eder; yerleşik
// adaptörler burada kaydedilir. Yeni bir sağlayıcı = yeni adaptör dosyası + bir
// `registerOutboundAdapter` satırı; çekirdekte hiçbir değişiklik gerekmez.
import { registerOutboundAdapter } from "./outbound";
import { hospitableOutboundAdapter } from "./hospitable-outbound";
import { registerIngestAdapter } from "./ingest";
import { hospitableIngestAdapter } from "./hospitable-ingest";
import { registerMessagingAccess } from "./access";
import { hospitableMessagingAccess } from "./hospitable-access";

registerOutboundAdapter(hospitableOutboundAdapter);
registerIngestAdapter(hospitableIngestAdapter); // V0.6 — okuma yönü de aynı kayıt defterinden
registerMessagingAccess(hospitableMessagingAccess); // V0.8 — kimlik bilgisi + bağlantı durumu da sınırda

export {
  resolveOrgChannelCredential,
  activeMessagingConnectionId,
  handleOutboundCredentialRejected,
  hasMessagingConnection,
  registerMessagingAccess,
  __setMessagingAccessForTest,
} from "./access";
export type { MessagingAccess, CredentialRejectionOutcome } from "./access";

export {
  INTERNAL_THREAD_PREFIX,
  resolveOutboundRoute,
  dispatchOutbound,
  getOutboundAdapter,
  registerOutboundAdapter,
  __setOutboundAdapterForTest,
} from "./outbound";
export type {
  OutboundProvider,
  OutboundDestination,
  OutboundRoute,
  OutboundCredential,
  OutboundCapability,
  OutboundSendResult,
  OutboundAdapter,
} from "./outbound";
export {
  NON_MESSAGING_CHANNELS,
  PROVIDER_MESSAGEABLE_RESERVATION_WHERE,
  PROVIDER_THREAD_CONVERSATION_WHERE,
  reservationMessagingCapable,
  isInternalThread,
} from "./capability";
export {
  registerIngestAdapter,
  getIngestAdapter,
  __setIngestAdapterForTest,
  IngestError,
} from "./ingest";
export type {
  IngestAdapter,
  IngestCapability,
  IngestCredential,
  IngestErrorKind,
  CanonicalProperty,
  CanonicalReservation,
  CanonicalMessage,
  CanonicalGuest,
  ReservationWindow,
} from "./ingest";
