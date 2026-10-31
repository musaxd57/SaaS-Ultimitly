import type { HostDeliveryStatus, HostInboundEvent } from "../types";

// ---------------------------------------------------------------------------
// Meta (WhatsApp Cloud API) web kancası gövdesi → çekirdeğin tek biçimi (`HostInboundEvent`). SAF.
// Gövde GÜVENİLMEZ VERİDİR: imza doğrulanmadan buraya gelinmez (`signature.ts`); yine de her alan tip denetimiyle okunur, beklenmeyen
// biçim sessizce atlanır (bir tuhaf öğe bütün partiyi düşürmez). Durum olayları (`statuses`: sent / delivered / read / failed) ayrı döner.
// Metin 4.000 karakterde kesilir (ev sahibinin cevabı kısa; sınırsız metin aşağı akışta maliyet ve karesel iş riski).
// `onlyPhoneNumberId` verilirse YALNIZ o numaraya gelen mesajlar döner (karışık teslimatta kendi numaramızın "DUR"u kaybolmasın); bütün
// numara kimlikleri yine `phoneNumberIds`te (yabancı kimlik = yapılandırma hatası alarmı). Sistem olayları (`type: "system"`) türüyle döner:
// `system:user_changed_number` (ev sahibi WhatsApp numarasını değiştirdi) çekirdekte bağlantıyı kapatır.
// ---------------------------------------------------------------------------

export const INBOUND_TEXT_CAP = 4_000;

export type MetaStatusEvent = HostDeliveryStatus;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const when = (ts: unknown): Date => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date(0);
};

export function parseMetaWebhook(
  body: unknown,
  opts: { onlyPhoneNumberId?: string } = {},
): { messages: HostInboundEvent[]; statuses: MetaStatusEvent[]; phoneNumberIds: string[] } {
  const messages: HostInboundEvent[] = [];
  const statuses: MetaStatusEvent[] = [];
  const phoneNumberIds = new Set<string>();
  const root = rec(body);
  if (!root || root.object !== "whatsapp_business_account") return { messages, statuses, phoneNumberIds: [] };
  for (const entry of arr(root.entry)) {
    for (const change of arr(rec(entry)?.changes)) {
      const c = rec(change);
      if (!c || c.field !== "messages") continue;
      const value = rec(c.value);
      if (!value) continue;
      const pid = str(rec(value.metadata)?.phone_number_id);
      if (pid) phoneNumberIds.add(pid);
      const ours = opts.onlyPhoneNumberId === undefined || pid === opts.onlyPhoneNumberId;
      for (const m of ours ? arr(value.messages) : []) {
        const msg = rec(m);
        const from = str(msg?.from);
        const id = str(msg?.id);
        if (!msg || !from || !id) continue;
        const contextId = str(rec(msg.context)?.id);
        const at = when(msg.timestamp);
        const type = str(msg.type);
        if (type === "text") {
          const text = str(rec(msg.text)?.body);
          if (text) messages.push({ kind: "text", from, providerMessageId: id, contextId, text: text.slice(0, INBOUND_TEXT_CAP), at });
        } else if (type === "interactive") {
          const reply = rec(rec(msg.interactive)?.button_reply);
          const buttonId = str(reply?.id);
          if (buttonId) messages.push({ kind: "button", from, providerMessageId: id, contextId, buttonId, title: str(reply?.title) ?? "", at });
        } else if (type === "button") {
          // Şablon hızlı yanıt düğmesi: kimlik `payload`ta.
          const b = rec(msg.button);
          const buttonId = str(b?.payload);
          if (buttonId) messages.push({ kind: "button", from, providerMessageId: id, contextId, buttonId, title: str(b?.text) ?? "", at });
        } else if (type === "system") {
          const systemType = str(rec(msg.system)?.type);
          messages.push({ kind: "unsupported", from, providerMessageId: id, contextId, media: `system:${systemType ?? "unknown"}`, at });
        } else {
          messages.push({ kind: "unsupported", from, providerMessageId: id, contextId, media: type ?? "unknown", at });
        }
      }
      for (const s of ours ? arr(value.statuses) : []) {
        const st = rec(s);
        const id = str(st?.id);
        const status = str(st?.status);
        if (!st || !id || !status) continue;
        const code = Number(rec(arr(st.errors)[0])?.code);
        statuses.push({ providerMessageId: id, status, recipient: str(st.recipient_id) ?? "", at: when(st.timestamp), errorCode: Number.isFinite(code) ? code : null });
      }
    }
  }
  return { messages, statuses, phoneNumberIds: [...phoneNumberIds] };
}
