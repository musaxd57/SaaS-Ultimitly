import "server-only";

// Channel Layer giriş noktası (V0.1). Çekirdek YALNIZ bunu import eder; yerleşik
// adaptörler burada kaydedilir. Yeni bir sağlayıcı = yeni adaptör dosyası + bir
// `registerOutboundAdapter` satırı; çekirdekte hiçbir değişiklik gerekmez.
import { registerOutboundAdapter } from "./outbound";
import { hospitableOutboundAdapter } from "./hospitable-outbound";

registerOutboundAdapter(hospitableOutboundAdapter);

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
