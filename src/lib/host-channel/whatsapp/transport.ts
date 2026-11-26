import type { HostChannelTransport, HostChoice, HostDecisionMessage, HostQuestionMessage, HostSendResult } from "../types";
import { WHATSAPP_CLOUD_PROVIDER } from "../providers";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API bağdaştırıcısı (tasarım §2, §4). Çekirdek yalnız `HostChannelTransport`ı bilir; bu dosya Meta'nın Graph API biçimini
// konuşur. Kimlik bilgileri ortamdan (kasada): `WHATSAPP_ACCESS_TOKEN` (sistem kullanıcısı kalıcı belirteci), `WHATSAPP_PHONE_NUMBER_ID`;
// Graph sürümü `WHATSAPP_GRAPH_VERSION` (⚠️ kurulumda güncel sürüm teyit edilir). Şablon adları / dili `WHATSAPP_QUESTION_TEMPLATE` /
// `WHATSAPP_ALERT_TEMPLATE` / `WHATSAPP_TEMPLATE_LANG` (varsayılan `lixus_misafir_sorusu` / `lixus_acil_bildirim` / `tr`). Şablonda DEĞİŞKENLİ
// bağlantı düğmesi varsa (`https://www.lixusai.com/inbox/{{1}}`) o düğmenin şablondaki sırası (0'dan) ŞABLON BAŞINA ayrı verilir:
// `WHATSAPP_QUESTION_URL_BUTTON_INDEX` / `WHATSAPP_ALERT_URL_BUTTON_INDEX` (soru şablonunda önce hızlı yanıt düğmesi olabilir, acilde olmayabilir —
// sıralar farklı). Boşsa düğme parametresi gönderilmez (statik bağlantılı ya da bağlantısız şablon). Meta, şablondaki değişkenlerle gönderilen
// eşleşmezse reddeder (132000) → çağıran e-postaya düşer; kurulumda her şablon bir kez denenir. Karar şablonu (`WHATSAPP_DECISION_TEMPLATE`,
// varsayılan `lixus_karar_bekliyor`): dört gövde değişkeni + iki hızlı yanıt ([Onayla] sıra 0, [Reddet] sıra 1 — yükleri gönderimde verilir)
// + isteğe bağlı bağlantı düğmesi (`WHATSAPP_DECISION_URL_BUTTON_INDEX`, tipik `2`).
// Belirteç ASLA günlüğe yazılmaz; hata gövdesinden yalnız kod + kısa mesaj okunur. Kesin ret (4xx, 429 hariç; pencere dışı serbest metin
// 131047) yeniden denenmez → çağıran e-posta yedeğine düşer.
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  questionTemplate: string;
  alertTemplate: string;
  decisionTemplate: string;
  templateLang: string;
  /** Değişkenli bağlantı düğmesinin şablondaki sırası (şablon başına); `null` → düğme parametresi yok. */
  questionUrlButtonIndex: number | null;
  alertUrlButtonIndex: number | null;
  decisionUrlButtonIndex: number | null;
}

export function whatsAppConfigFromEnv(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId || !/^\d{5,20}$/.test(phoneNumberId)) return null;
  const graphVersion = env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  if (!/^v\d{1,3}\.\d$/.test(graphVersion)) return null;
  const questionIndex = env.WHATSAPP_QUESTION_URL_BUTTON_INDEX?.trim();
  const alertIndex = env.WHATSAPP_ALERT_URL_BUTTON_INDEX?.trim();
  const decisionIndex = env.WHATSAPP_DECISION_URL_BUTTON_INDEX?.trim();
  if ([questionIndex, alertIndex, decisionIndex].some((v) => v && !/^\d$/.test(v))) return null;
  return {
    accessToken,
    phoneNumberId,
    graphVersion,
    questionTemplate: env.WHATSAPP_QUESTION_TEMPLATE?.trim() || "lixus_misafir_sorusu",
    alertTemplate: env.WHATSAPP_ALERT_TEMPLATE?.trim() || "lixus_acil_bildirim",
    decisionTemplate: env.WHATSAPP_DECISION_TEMPLATE?.trim() || "lixus_karar_bekliyor",
    templateLang: env.WHATSAPP_TEMPLATE_LANG?.trim() || "tr",
    questionUrlButtonIndex: questionIndex ? Number(questionIndex) : null,
    alertUrlButtonIndex: alertIndex ? Number(alertIndex) : null,
    decisionUrlButtonIndex: decisionIndex ? Number(decisionIndex) : null,
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
  /** Onaylı şablon: üç gövde değişkeni (daire · tarih · maskeli alıntı) + (yapılandırılmışsa) değişkenli bağlantı düğmesine panel yolu. */
  const sendTemplate = (name: string, urlButtonIndex: number | null, to: string, message: HostQuestionMessage): Promise<HostSendResult> => {
    const num = normalizeWaNumber(to);
    if (!num) return Promise.resolve({ ok: false, providerMessageId: null, definitive: true, error: "bad_number" });
    const components: Record<string, unknown>[] = [
      { type: "body", parameters: [message.property, message.dates, message.quote].map((text) => ({ type: "text", text })) },
    ];
    if (urlButtonIndex !== null && message.link) {
      components.push({ type: "button", sub_type: "url", index: String(urlButtonIndex), parameters: [{ type: "text", text: message.link }] });
    }
    return post(cfg, { to: num, type: "template", template: { name, language: { code: cfg.templateLang }, components } }, fetchImpl);
  };
  return {
    provider: WHATSAPP_CLOUD_PROVIDER,
    sendQuestion: (to: string, message: HostQuestionMessage) => sendTemplate(cfg.questionTemplate, cfg.questionUrlButtonIndex, to, message),
    sendAlert: (to: string, message: HostQuestionMessage) => sendTemplate(cfg.alertTemplate, cfg.alertUrlButtonIndex, to, message),
    sendDecision(to: string, m: HostDecisionMessage): Promise<HostSendResult> {
      const num = normalizeWaNumber(to);
      if (!num) return Promise.resolve({ ok: false, providerMessageId: null, definitive: true, error: "bad_number" });
      const components: Record<string, unknown>[] = [
        { type: "body", parameters: [m.property, m.dates, m.title, m.checks].map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: m.approveId }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: m.declineId }] },
      ];
      if (cfg.decisionUrlButtonIndex !== null) {
        components.push({ type: "button", sub_type: "url", index: String(cfg.decisionUrlButtonIndex), parameters: [{ type: "text", text: m.link }] });
      }
      return post(cfg, { to: num, type: "template", template: { name: cfg.decisionTemplate, language: { code: cfg.templateLang }, components } }, fetchImpl);
    },
    async sendText(to: string, text: string, replyTo?: string | null): Promise<HostSendResult> {
      const num = normalizeWaNumber(to);
      if (!num) return { ok: false, providerMessageId: null, definitive: true, error: "bad_number" };
      const body = text.trim().slice(0, 4_096);
      if (!body) return { ok: false, providerMessageId: null, definitive: true, error: "empty" };
      return post(cfg, { to: num, type: "text", text: { body, preview_url: false }, ...(replyTo ? { context: { message_id: replyTo } } : {}) }, fetchImpl);
    },
    async sendChoices(to: string, text: string, choices: readonly HostChoice[], replyTo?: string | null): Promise<HostSendResult> {
      const num = normalizeWaNumber(to);
      if (!num) return { ok: false, providerMessageId: null, definitive: true, error: "bad_number" };
      const body = text.trim().slice(0, 1_024);
      const buttons = choices.slice(0, 3).map((c) => ({ type: "reply", reply: { id: c.id.slice(0, 256), title: c.title.slice(0, 20) } }));
      if (!body || buttons.length === 0) return { ok: false, providerMessageId: null, definitive: true, error: "empty" };
      return post(
        cfg,
        {
          to: num,
          type: "interactive",
          interactive: { type: "button", body: { text: body }, action: { buttons } },
          ...(replyTo ? { context: { message_id: replyTo } } : {}),
        },
        fetchImpl,
      );
    },
  };
}
