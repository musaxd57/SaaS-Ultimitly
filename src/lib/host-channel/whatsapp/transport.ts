import type { HostChannelTransport, HostQuestionMessage, HostSendResult } from "../types";
import { WHATSAPP_CLOUD_PROVIDER } from "../providers";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API bağdaştırıcısı (tasarım §2, §4). Çekirdek yalnız `HostChannelTransport`ı bilir; bu dosya Meta'nın Graph API biçimini
// konuşur. Kimlik bilgileri ortamdan (kasada): `WHATSAPP_ACCESS_TOKEN` (sistem kullanıcısı kalıcı belirteci), `WHATSAPP_PHONE_NUMBER_ID`;
// Graph sürümü `WHATSAPP_GRAPH_VERSION` (⚠️ kurulumda güncel sürüm teyit edilir). Şablon adı / dili `WHATSAPP_QUESTION_TEMPLATE` /
// `WHATSAPP_TEMPLATE_LANG` (varsayılan `lixus_misafir_sorusu` / `tr`).
// Belirteç ASLA günlüğe yazılmaz; hata gövdesinden yalnız kod + kısa mesaj okunur. Kesin ret (4xx, 429 hariç; pencere dışı serbest metin
// 131047) yeniden denenmez → çağıran e-posta yedeğine düşer.
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  questionTemplate: string;
  templateLang: string;
}

export function whatsAppConfigFromEnv(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId || !/^\d{5,20}$/.test(phoneNumberId)) return null;
  const graphVersion = env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  if (!/^v\d{1,3}\.\d$/.test(graphVersion)) return null;
  return {
    accessToken,
    phoneNumberId,
    graphVersion,
    questionTemplate: env.WHATSAPP_QUESTION_TEMPLATE?.trim() || "lixus_misafir_sorusu",
    templateLang: env.WHATSAPP_TEMPLATE_LANG?.trim() || "tr",
  };
}

/** Uluslararası biçim, yalnız rakam (Meta `to` alanı "+" istemez). Geçersizse null. */
export function normalizeWaNumber(raw: string): string | null {
  const digits = raw.replace(/[\s()+.-]/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Pencere dışı serbest metin, geçersiz alıcı, şablon sorunları — yeniden denemek işe yaramaz. */
const DEFINITIVE_CODES = new Set([131047, 131026, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 100, 190]);

async function post(cfg: WhatsAppConfig, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<HostSendResult> {
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, providerMessageId: null, error: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network" };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* boş / bozuk gövde */
  }
  if (res.ok) {
    const id = (data.messages as { id?: unknown }[] | undefined)?.[0]?.id;
    return typeof id === "string" ? { ok: true, providerMessageId: id } : { ok: false, providerMessageId: null, error: "no_message_id" };
  }
  const err = (data.error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof err.code === "number" ? err.code : null;
  const definitive = (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) || (code !== null && DEFINITIVE_CODES.has(code));
  return { ok: false, providerMessageId: null, definitive, error: `http_${res.status}${code !== null ? `_${code}` : ""}` };
}

export function createWhatsAppTransport(cfg: WhatsAppConfig, fetchImpl: typeof fetch = fetch): HostChannelTransport {
  return {
    provider: WHATSAPP_CLOUD_PROVIDER,
    async sendQuestion(to: string, message: HostQuestionMessage): Promise<HostSendResult> {
      const num = normalizeWaNumber(to);
      if (!num) return { ok: false, providerMessageId: null, definitive: true, error: "bad_number" };
      return post(
        cfg,
        {
          to: num,
          type: "template",
          template: {
            name: cfg.questionTemplate,
            language: { code: cfg.templateLang },
            components: [
              { type: "body", parameters: [message.property, message.dates, message.quote].map((text) => ({ type: "text", text })) },
            ],
          },
        },
        fetchImpl,
      );
    },
    async sendText(to: string, text: string, replyTo?: string | null): Promise<HostSendResult> {
      const num = normalizeWaNumber(to);
      if (!num) return { ok: false, providerMessageId: null, definitive: true, error: "bad_number" };
      const body = text.trim().slice(0, 4_096);
      if (!body) return { ok: false, providerMessageId: null, definitive: true, error: "empty" };
      return post(cfg, { to: num, type: "text", text: { body, preview_url: false }, ...(replyTo ? { context: { message_id: replyTo } } : {}) }, fetchImpl);
    },
  };
}
