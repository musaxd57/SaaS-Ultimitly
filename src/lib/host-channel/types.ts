// ---------------------------------------------------------------------------
// EV SAHİBİ SORU KANALI — sağlayıcıdan bağımsız sözleşme (kurucu 10-30: "WhatsApp'ı hemen bağlamak istiyorum; ordan hosta kısaca soruyu
// sorup alınması gereken yanıtı alıp hemen cevap ürettirip müşteriye yazma akışına geçilmeli"). Tasarım:
// `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md`.
//
// V0 kuralı: çekirdek (`host-channel/*.ts`) hiçbir sağlayıcı modülünü import etmez; WhatsApp yalnız `host-channel/whatsapp/` altında bir
// bağdaştırıcıdır. Sağlayıcı değişince (Twilio, 360dialog, Telegram) çekirdek yeniden yazılmaz.
// ---------------------------------------------------------------------------

/** Ev sahibine giden bir soru — sağlayıcının şablonuna dönüştürülecek değerler (sıra şablondaki {{1}} {{2}} {{3}} ile aynı). */
export interface HostQuestionMessage {
  /** Daire adı (ev sahibinin kendi verisi). */
  property: string;
  /** Konaklama aralığı, kısa ("12–15 Kas"). */
  dates: string;
  /** Misafirin sözünden kısa, maskeli alıntı (en çok 160 karakter; ad / telefon / e-posta YOK). */
  quote: string;
}

/** Sağlayıcıdan gelen ve çekirdeğin anladığı tek biçim. */
export type HostInboundEvent =
  | { kind: "text"; from: string; providerMessageId: string; contextId: string | null; text: string; at: Date }
  | { kind: "button"; from: string; providerMessageId: string; contextId: string | null; buttonId: string; title: string; at: Date }
  | { kind: "unsupported"; from: string; providerMessageId: string; contextId: string | null; media: string; at: Date };

export interface HostSendResult {
  ok: boolean;
  /** Sağlayıcının mesaj kimliği — ev sahibinin "yanıtla"sı bu kimliği `contextId` olarak geri getirir. */
  providerMessageId: string | null;
  /** Kesin ret (numara geçersiz, şablon reddedildi) — yeniden denenmez, e-posta yedeğine düşülür. */
  definitive?: boolean;
  error?: string;
}

/** Sağlayıcı bağdaştırıcısının uygulayacağı arayüz (testte sahte gönderici). */
export interface HostChannelTransport {
  readonly provider: string;
  sendQuestion(to: string, message: HostQuestionMessage): Promise<HostSendResult>;
  /** Pencere içi serbest metin (önizleme, "Gönderildi", "Hangi soru?") — `replyTo` verilirse o mesaja yanıt olarak. */
  sendText(to: string, text: string, replyTo?: string | null): Promise<HostSendResult>;
}
