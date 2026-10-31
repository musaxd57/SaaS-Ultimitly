// ---------------------------------------------------------------------------
// KANAL SAĞLAYICI KİMLİKLERİ — yaprak modül (hiçbir şey import etmez).
//
// İki ayrı küme vardır ve karıştırılmaz:
//   · `ChannelProviderId` = Lixus'un SÖZLEŞMESİNİ bildiği sağlayıcılar (canlı ya da
//     yalnız sözleşme aşamasında). Manifesto (`manifests.ts`) bu kümeyi kapsar.
//   · `OutboundProvider` (outbound.ts) = CANLI adaptörü olan sağlayıcılar. Kayıt
//     defterleri ve `dispatchOutbound` YALNIZ onu kabul eder; bir sağlayıcıyı canlıya
//     almak o union'ı bilinçli olarak genişletmektir (derleme hatası zinciri: ingest
//     kaynakları, kesin-liste testleri, bağlantı yazıcıları).
//
// 🚨 `airbnb_direct`, `airbnb` DEĞİL: `"airbnb"` zaten `Reservation.channel`da bir OTA
// ETİKETİDİR (Hospitable köprüsünden gelen satırlar da taşır). Aynı sözcüğü sağlayıcı
// kimliği yapmak, değişmez 20'nin yasakladığı "etiketten yetenek çıkarımı"nı geri
// getirirdi: köprüden gelmiş `channel: "airbnb"` satırı doğrudan-yönlendirilebilir SANILIRDI.
// ---------------------------------------------------------------------------

export const CHANNEL_PROVIDER_IDS = ["hospitable", "airbnb_direct"] as const;
export type ChannelProviderId = (typeof CHANNEL_PROVIDER_IDS)[number];

export function isChannelProviderId(value: string): value is ChannelProviderId {
  return (CHANNEL_PROVIDER_IDS as readonly string[]).includes(value);
}
