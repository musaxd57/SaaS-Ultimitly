// ---------------------------------------------------------------------------
// EV SAHİBİ SORU KANALI — sağlayıcıdan bağımsız sözleşme (kurucu 10-30: "WhatsApp'ı hemen bağlamak istiyorum; ordan hosta kısaca soruyu
// sorup alınması gereken yanıtı alıp hemen cevap ürettirip müşteriye yazma akışına geçilmeli"). Tasarım:
// `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md`.
//
// V0 kuralı: çekirdek (`host-channel/*.ts`) hiçbir sağlayıcı modülünü import etmez; WhatsApp yalnız `host-channel/whatsapp/` altında bir
// bağdaştırıcıdır. Sağlayıcı değişince (Twilio, 360dialog, Telegram) çekirdek yeniden yazılmaz.
// ---------------------------------------------------------------------------

/** Sağlayıcının teslim durumu bildirimi (gönderildi / iletildi / okundu / başarısız) — sağlayıcıdan bağımsız biçim. */
export interface HostDeliveryStatus {
  /** Bizim gönderdiğimiz mesajın sağlayıcı kimliği (`HostQuestion.providerMessageId`). */
  providerMessageId: string;
  /** "sent" | "delivered" | "read" | "failed" (sağlayıcının sözcüğü; bilinmeyen değer yok sayılır). */
  status: string;
  recipient: string;
  /** Sağlayıcının bildirdiği an (bozuk / eksikse 1970 gelebilir — kaydedici kırpar). */
  at: Date;
  errorCode: number | null;
}

/** Ev sahibine giden bir soru — sağlayıcının şablonuna dönüştürülecek değerler (sıra şablondaki {{1}} {{2}} {{3}} ile aynı). */
export interface HostQuestionMessage {
  /** Daire adı (ev sahibinin kendi verisi). */
  property: string;
  /** Konaklama aralığı, kısa ("12–15 Kas"). */
  dates: string;
  /** Misafirin sözünden kısa, maskeli alıntı (en çok 160 karakter; ad / telefon / e-posta YOK). */
  quote: string;
  /** Panel bağlantısının değişken kısmı (konuşma kimliği) — şablonun değişkenli bağlantı düğmesi varsa (`/inbox/{{1}}`). */
  link?: string;
}

/** "Karar bekliyor" şablonunun değerleri (tasarım §3.10) — misafir metni / adı TAŞIMAZ. */
export interface HostDecisionMessage {
  property: string;
  dates: string;
  /** "14 Kasım (varış günü) · 13:00 erken giriş". */
  title: string;
  /** Kontrol listesinden en çok 2 satır (tek satıra katlanmış). */
  checks: string;
  /** Panel bağlantısının değişken kısmı (konuşma kimliği). */
  link: string;
  /** Hızlı yanıt düğmelerinin yükleri (`hd.<karar>.<sürüm>.<a|d>`). */
  approveId: string;
  declineId: string;
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
  /** Acil bildirim (Tür C, onaylı şablon, pencere dışında da gider): cevap kurulmaz — ev sahibi konuşmayı panelde açar. */
  sendAlert(to: string, message: HostQuestionMessage): Promise<HostSendResult>;
  /** Karar kartı (Tür B, onaylı şablon + [Onayla] / [Reddet] hızlı yanıtları). Desteklemeyen aktarımda yok → bugünkü e-posta. */
  sendDecision?(to: string, message: HostDecisionMessage): Promise<HostSendResult>;
  /** Pencere içi serbest metin (önizleme, "Gönderildi", "Hangi soru?") — `replyTo` verilirse o mesaja yanıt olarak. */
  sendText(to: string, text: string, replyTo?: string | null): Promise<HostSendResult>;
  /**
   * Pencere içi düğmeli mesaj (önizleme + [Gönder] [Gönderme]). En çok 3 düğme; başlık ≤ 20 karakter; kimlik sır değildir (yetki her zaman
   * gönderen numaranın bağlantısından ve sorunun kiracısından denetlenir).
   */
  sendChoices(to: string, text: string, choices: readonly HostChoice[], replyTo?: string | null): Promise<HostSendResult>;
}

export interface HostChoice {
  id: string;
  title: string;
}
