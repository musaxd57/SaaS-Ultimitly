import { describe, it, expect, vi } from "vitest";
import { createWhatsAppTransport, normalizeWaNumber, whatsAppConfigFromEnv, type WhatsAppConfig } from "@/lib/host-channel/whatsapp/transport";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API bağdaştırıcısı (WhatsApp dilim 1c): Meta'ya giden gövde biçimi, kesin / geçici ret ayrımı, belirteç gizliliği. Ağ sahte.
// ---------------------------------------------------------------------------

const cfg: WhatsAppConfig = {
  accessToken: "EAAG-secret-token",
  phoneNumberId: "123456789012345",
  graphVersion: "v23.0",
  questionTemplate: "lixus_misafir_sorusu",
  templateLang: "tr",
};

function graph(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ortam ayarı", () => {
  it("belirteç + numara kimliği yoksa ya da biçim bozuksa → kapalı (null)", () => {
    expect(whatsAppConfigFromEnv({})).toBeNull();
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "abc" })).toBeNull();
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_GRAPH_VERSION: "latest" })).toBeNull();
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456" })).toMatchObject({ graphVersion: "v23.0", templateLang: "tr" });
  });
  it("numara: +, boşluk, parantez, tire temizlenir; 8–15 rakam", () => {
    expect(normalizeWaNumber("+90 (532) 111-22-33")).toBe("905321112233");
    expect(normalizeWaNumber("12345")).toBeNull();
    expect(normalizeWaNumber("+90 532 abc")).toBeNull();
  });
});

describe("gönderim gövdesi", () => {
  it("soru = onaylı şablon, üç gövde değişkeni; serbest metin yanıt bağlamıyla; belirteç yalnız başlıkta", async () => {
    const g = graph(200, { messages: [{ id: "wamid.Q1" }] });
    const t = createWhatsAppTransport(cfg, g.fetchImpl);
    const r = await t.sendQuestion("+90 532 111 22 33", { property: "Lale", dates: "12–15 Kas", quote: "Bebek yatağı var mı?" });
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.Q1" });
    expect(g.calls[0].url).toBe("https://graph.facebook.com/v23.0/123456789012345/messages");
    const body = JSON.parse(String(g.calls[0].init.body));
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "905321112233",
      type: "template",
      template: {
        name: "lixus_misafir_sorusu",
        language: { code: "tr" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Lale" }, { type: "text", text: "12–15 Kas" }, { type: "text", text: "Bebek yatağı var mı?" }] }],
      },
    });
    expect(String(g.calls[0].init.body)).not.toContain("EAAG-secret-token");
    expect((g.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-secret-token");

    await t.sendText("905321112233", "Gönderildi ✓", "wamid.Q1");
    expect(JSON.parse(String(g.calls[1].init.body))).toMatchObject({ type: "text", text: { body: "Gönderildi ✓", preview_url: false }, context: { message_id: "wamid.Q1" } });
  });

  it("geçersiz numara / boş metin ağa çıkmaz (kesin ret)", async () => {
    const g = graph(200, {});
    const t = createWhatsAppTransport(cfg, g.fetchImpl);
    expect(await t.sendQuestion("12", { property: "a", dates: "b", quote: "c" })).toMatchObject({ ok: false, definitive: true, error: "bad_number" });
    expect(await t.sendText("905321112233", "   ")).toMatchObject({ ok: false, definitive: true, error: "empty" });
    expect(g.calls).toHaveLength(0);
  });
});

describe("ret sınıfı — yedeğe düşme kararı", () => {
  it.each([
    [400, { error: { code: 132001, message: "template does not exist" } }, true],
    [400, { error: { code: 131047, message: "re-engagement" } }, true],
    [401, { error: { code: 190, message: "token expired" } }, true],
    [429, { error: { code: 130429, message: "rate" } }, false],
    [500, { error: { code: 1, message: "unknown" } }, false],
    [503, {}, false],
  ])("HTTP %i %j → kesin=%s", async (status, body, definitive) => {
    const g = graph(status, body);
    const r = await createWhatsAppTransport(cfg, g.fetchImpl).sendText("905321112233", "x");
    expect(r.ok).toBe(false);
    expect(r.definitive).toBe(definitive);
    expect(r.error).not.toContain("EAAG");
  });

  it("ağ hatası / zaman aşımı → geçici; başarılı ama kimliksiz cevap → başarısız", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await createWhatsAppTransport(cfg, boom).sendText("905321112233", "x")).toEqual({ ok: false, providerMessageId: null, error: "network" });
    const g = graph(200, { messages: [] });
    expect(await createWhatsAppTransport(cfg, g.fetchImpl).sendText("905321112233", "x")).toMatchObject({ ok: false, error: "no_message_id" });
  });
});
