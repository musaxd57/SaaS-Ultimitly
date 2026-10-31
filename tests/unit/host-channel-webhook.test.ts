import { describe, it, expect, vi, afterEach } from "vitest";
import { looksLikeMetaSignature, verifyWhatsAppHandshake, whatsAppWebhookConfigFromEnv } from "@/lib/host-channel/whatsapp/webhook";
import { inboundDedupeName, INBOUND_DEDUPE_PREFIX } from "@/lib/host-channel/inbound";
import { sanitizeEventData } from "@/lib/event-log";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { createWhatsAppTransport } from "@/lib/host-channel/whatsapp/transport";
import { hostChannelTransport } from "@/lib/host-channel-runtime";

// ---------------------------------------------------------------------------
// WhatsApp web kancası — saf parçalar (tasarım §5.1, §5.6, §5.9). Rotanın davranışı gerçek veritabanıyla
// `tests/integration/host-channel-webhook-route.test.ts`te.
// ---------------------------------------------------------------------------

describe("abonelik el sıkışması", () => {
  const q = (mode: string | null, token: string | null, challenge: string | null) => ({ mode, token, challenge });

  it("doğru belirteç → challenge aynen; yanlış / eksik / boş → null", () => {
    expect(verifyWhatsAppHandshake(q("subscribe", "dogru-belirtec", "1158201444"), "dogru-belirtec")).toBe("1158201444");
    expect(verifyWhatsAppHandshake(q("subscribe", "yanlis", "1158201444"), "dogru-belirtec")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "dogru-belirtec-", "1158201444"), "dogru-belirtec")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", null, "1158201444"), "dogru-belirtec")).toBeNull();
    expect(verifyWhatsAppHandshake(q("unsubscribe", "dogru-belirtec", "1158201444"), "dogru-belirtec")).toBeNull();
    expect(verifyWhatsAppHandshake(q(null, "dogru-belirtec", "1158201444"), "dogru-belirtec")).toBeNull();
  });

  it("🚨 belirteç yapılandırılmamışsa boş belirteçli istek de geçmez (iki boş dize eşit sayılmaz)", () => {
    expect(verifyWhatsAppHandshake(q("subscribe", "", "1"), null)).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "", "1"), "")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "x", "1"), null)).toBeNull();
  });

  it("yansıtılan challenge dar kümede ve kısa (işaretleme / uzun gövde yansıtılmaz)", () => {
    expect(verifyWhatsAppHandshake(q("subscribe", "t", "<script>alert(1)</script>"), "t")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "t", "a b"), "t")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "t", "9".repeat(129)), "t")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "t", ""), "t")).toBeNull();
    expect(verifyWhatsAppHandshake(q("subscribe", "t", "9".repeat(128)), "t")).toBe("9".repeat(128));
  });
});

describe("yapılandırma", () => {
  it("uygulama gizli anahtarı VE geçerli numara kimliği yoksa null (uç uyur)", () => {
    expect(whatsAppWebhookConfigFromEnv({})).toBeNull();
    expect(whatsAppWebhookConfigFromEnv({ WHATSAPP_APP_SECRET: "s" })).toBeNull();
    expect(whatsAppWebhookConfigFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "123456789" })).toBeNull();
    expect(whatsAppWebhookConfigFromEnv({ WHATSAPP_APP_SECRET: "s", WHATSAPP_PHONE_NUMBER_ID: "12ab" })).toBeNull();
    expect(whatsAppWebhookConfigFromEnv({ WHATSAPP_APP_SECRET: "  ", WHATSAPP_PHONE_NUMBER_ID: "123456789" })).toBeNull();
    expect(whatsAppWebhookConfigFromEnv({ WHATSAPP_APP_SECRET: " s ", WHATSAPP_PHONE_NUMBER_ID: "123456789" })).toEqual({
      appSecret: "s",
      verifyToken: null,
      phoneNumberId: "123456789",
    });
    expect(
      whatsAppWebhookConfigFromEnv({ WHATSAPP_APP_SECRET: "s", WHATSAPP_PHONE_NUMBER_ID: "123456789", WHATSAPP_WEBHOOK_VERIFY_TOKEN: " v " })?.verifyToken,
    ).toBe("v");
  });

  it("imza başlığı Meta biçiminde mi (alarm yalnız bunda)", () => {
    expect(looksLikeMetaSignature(`sha256=${"a".repeat(64)}`)).toBe(true);
    expect(looksLikeMetaSignature(`sha256=${"A".repeat(64)}`)).toBe(true);
    expect(looksLikeMetaSignature(`sha256=${"a".repeat(63)}`)).toBe(false);
    expect(looksLikeMetaSignature(`sha1=${"a".repeat(40)}`)).toBe(false);
    expect(looksLikeMetaSignature("")).toBe(false);
    expect(looksLikeMetaSignature(null)).toBe(false);
  });
});

describe("tekrar anahtarı + sağlayıcı kimliği + olay günlüğü", () => {
  it("aynı sağlayıcı + mesaj kimliği → aynı anahtar; farklıysa farklı; ham kimlik anahtarda görünmez", () => {
    const a = inboundDedupeName(WHATSAPP_CLOUD_PROVIDER, "wamid.HBgM123");
    expect(a).toBe(inboundDedupeName(WHATSAPP_CLOUD_PROVIDER, "wamid.HBgM123"));
    expect(a).not.toBe(inboundDedupeName(WHATSAPP_CLOUD_PROVIDER, "wamid.HBgM124"));
    expect(a).not.toBe(inboundDedupeName("fake", "wamid.HBgM123"));
    expect(a.startsWith(INBOUND_DEDUPE_PREFIX)).toBe(true);
    expect(a).not.toContain("HBgM123");
    expect(a).toMatch(/^host-in:[0-9a-f]{64}$/);
  });

  it("🚨 gönderen bağdaştırıcı, bağlamayı başlatan ve doğrulayan AYNI sağlayıcı kimliğini kullanır (numara anahtarının parçası)", () => {
    const t = createWhatsAppTransport({ accessToken: "x", phoneNumberId: "123456789", graphVersion: "v23.0", questionTemplate: "q", alertTemplate: "a", templateLang: "tr", urlButtonIndex: null });
    expect(t.provider).toBe(WHATSAPP_CLOUD_PROVIDER);
    expect(WHATSAPP_CLOUD_PROVIDER).toBe("whatsapp_cloud");
  });

  it("günlük süzgeci: sayılar geçer; numara / metin biçimli değer düşer", () => {
    expect(sanitizeEventData({ count: 2, processed: 1, duplicates: 1, ignored: 0 })).toEqual({ count: 2, processed: 1, duplicates: 1, ignored: 0 });
    expect(sanitizeEventData({ processed: "905321234567" })).toEqual({ _dropped: 1 });
    expect(sanitizeEventData({ reason: "905321234567" })).toEqual({ _dropped: 1 });
    expect(sanitizeEventData({ reason: "Bebek yatağı var mı?" })).toEqual({ _dropped: 1 });
  });
});

describe("gönderim seçicisi", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("🚨 gelen uç (imza anahtarı + numara kimliği) hazır değilse WhatsApp'a soru GİTMEZ — cevap / DUR kaybolmasın", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    expect(hostChannelTransport()).toBeNull();
    vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
    expect(hostChannelTransport()?.provider).toBe(WHATSAPP_CLOUD_PROVIDER);
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    expect(hostChannelTransport()).toBeNull();
  });
});
