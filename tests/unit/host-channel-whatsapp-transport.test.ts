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
  alertTemplate: "lixus_acil_bildirim",
  decisionTemplate: "lixus_karar_bekliyor",
  templateLang: "tr",
  questionUrlButtonIndex: null,
  alertUrlButtonIndex: null,
  decisionUrlButtonIndex: null,
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
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456" })).toMatchObject({
      graphVersion: "v23.0",
      templateLang: "tr",
      alertTemplate: "lixus_acil_bildirim",
      questionUrlButtonIndex: null,
      alertUrlButtonIndex: null,
      decisionTemplate: "lixus_karar_bekliyor",
      decisionUrlButtonIndex: null,
    });
    const base = { WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456" };
    // Şablon başına ayrı sıra (soru şablonunda önce hızlı yanıt düğmesi olabilir).
    expect(whatsAppConfigFromEnv({ ...base, WHATSAPP_QUESTION_URL_BUTTON_INDEX: "1", WHATSAPP_ALERT_URL_BUTTON_INDEX: "0" })).toMatchObject({
      questionUrlButtonIndex: 1,
      alertUrlButtonIndex: 0,
    });
    expect(whatsAppConfigFromEnv({ ...base, WHATSAPP_QUESTION_URL_BUTTON_INDEX: "bir" })).toBeNull();
    expect(whatsAppConfigFromEnv({ ...base, WHATSAPP_ALERT_URL_BUTTON_INDEX: "-1" })).toBeNull();
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

  it("acil bildirim kendi şablonuyla; değişkenli bağlantı düğmesi YALNIZ yapılandırıldıysa (konuşma kimliği parametre)", async () => {
    const g = graph(200, { messages: [{ id: "wamid.A1" }] });
    const msg = { property: "Lale", dates: "12–15 Kas", quote: "We are locked out", link: "conv123" };
    expect(await createWhatsAppTransport(cfg, g.fetchImpl).sendAlert("905321112233", msg)).toEqual({ ok: true, providerMessageId: "wamid.A1" });
    const plain = JSON.parse(String(g.calls[0].init.body));
    expect(plain.template.name).toBe("lixus_acil_bildirim");
    expect(plain.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Lale" }, { type: "text", text: "12–15 Kas" }, { type: "text", text: "We are locked out" }] },
    ]);

    const t = createWhatsAppTransport({ ...cfg, questionUrlButtonIndex: 1, alertUrlButtonIndex: 0 }, g.fetchImpl);
    await t.sendQuestion("905321112233", msg);
    const withButton = JSON.parse(String(g.calls[1].init.body));
    expect(withButton.template.name).toBe("lixus_misafir_sorusu");
    expect(withButton.template.components[1]).toEqual({ type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "conv123" }] });
    // Her şablon KENDİ sırasıyla.
    await t.sendAlert("905321112233", msg);
    expect(JSON.parse(String(g.calls[2].init.body)).template.components[1]).toMatchObject({ sub_type: "url", index: "0" });
    // Bağlantı değeri yoksa düğme parametresi gönderilmez.
    await t.sendQuestion("905321112233", { ...msg, link: undefined });
    expect(JSON.parse(String(g.calls[3].init.body)).template.components).toHaveLength(1);
  });

  it("karar şablonu: dört gövde değişkeni + [Onayla] (0) / [Reddet] (1) hızlı yanıt yükleri; bağlantı düğmesi yalnız yapılandırıldıysa", async () => {
    const g = graph(200, { messages: [{ id: "wamid.D1" }] });
    const m = { property: "Lale", dates: "12–15 Kas", title: "13:00 erken giriş", checks: "ek bilgi yok", link: "conv1", approveId: "hd.abc12345.0.a", declineId: "hd.abc12345.0.d" };
    expect(await createWhatsAppTransport(cfg, g.fetchImpl).sendDecision!("905321112233", m)).toEqual({ ok: true, providerMessageId: "wamid.D1" });
    const body = JSON.parse(String(g.calls[0].init.body));
    expect(body.template.name).toBe("lixus_karar_bekliyor");
    expect(body.template.components).toEqual([
      { type: "body", parameters: ["Lale", "12–15 Kas", "13:00 erken giriş", "ek bilgi yok"].map((text) => ({ type: "text", text })) },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "hd.abc12345.0.a" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "hd.abc12345.0.d" }] },
    ]);
    await createWhatsAppTransport({ ...cfg, decisionUrlButtonIndex: 2 }, g.fetchImpl).sendDecision!("905321112233", m);
    expect(JSON.parse(String(g.calls[1].init.body)).template.components[3]).toEqual({ type: "button", sub_type: "url", index: "2", parameters: [{ type: "text", text: "conv1" }] });
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_DECISION_URL_BUTTON_INDEX: "2" })?.decisionUrlButtonIndex).toBe(2);
    expect(whatsAppConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_DECISION_URL_BUTTON_INDEX: "x" })).toBeNull();
  });

  it("düğmeli mesaj: Meta etkileşimli düğme biçimi, en çok 3 düğme, başlık ≤ 20, gövde ≤ 1024, yanıt bağlamıyla", async () => {
    const g = graph(200, { messages: [{ id: "wamid.P1" }] });
    const t = createWhatsAppTransport(cfg, g.fetchImpl);
    const r = await t.sendChoices(
      "905321112233",
      "x".repeat(2_000),
      [
        { id: "hq.q1.2.send", title: "Gönder" },
        { id: "hq.q1.2.cancel", title: "Gönderme ve panelde düzenle" },
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      "wamid.H1",
    );
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.P1" });
    const body = JSON.parse(String(g.calls[0].init.body));
    expect(body).toMatchObject({ to: "905321112233", type: "interactive", context: { message_id: "wamid.H1" } });
    expect(body.interactive.type).toBe("button");
    expect(body.interactive.body.text).toHaveLength(1_024);
    expect(body.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "hq.q1.2.send", title: "Gönder" } },
      { type: "reply", reply: { id: "hq.q1.2.cancel", title: "Gönderme ve panelde " } },
      { type: "reply", reply: { id: "a", title: "A" } },
    ]);
    expect(await t.sendChoices("905321112233", "  ", [{ id: "a", title: "A" }])).toMatchObject({ ok: false, definitive: true, error: "empty" });
    expect(await t.sendChoices("905321112233", "metin", [])).toMatchObject({ ok: false, definitive: true, error: "empty" });
    expect(await t.sendChoices("12", "metin", [{ id: "a", title: "A" }])).toMatchObject({ ok: false, definitive: true, error: "bad_number" });
    expect(g.calls).toHaveLength(1);
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
