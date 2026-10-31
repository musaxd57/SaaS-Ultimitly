import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const { composeMock, mailMock } = vi.hoisted(() => ({
  composeMock: vi.fn(),
  mailMock: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/host-channel/compose", () => ({ composeGuestReplyFromHostAnswer: composeMock }));
vi.mock("@/lib/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/email")>();
  return { ...actual, emailService: { ...actual.emailService, sendReporting: mailMock } };
});

import { POST } from "@/app/api/webhooks/host-channel/whatsapp/route";
import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";
import { notifyHostReplyWaiting } from "@/lib/host-reply-waiting";
import { HOST_TEXTS, hostQuestionButtonId } from "@/lib/host-channel/answer";
import type { HostChannelTransport, HostChoice, HostQuestionMessage } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// WhatsApp ev sahibi döngüsü UÇTAN UCA (kurucu 10-30: "hosta kısaca soruyu sorup alınması gereken yanıtı alıp hemen cevap ürettirip müşteriye
// yazma akışına geçilmeli"). Parça testleri her adımı ayrı sınar; bu dosya BAĞLANTILARI sınar ("yüklem var, argüman yok" dersi): bugünkü
// "Misafir cevabınızı bekliyor" çağrısı → WhatsApp sorusu (e-posta YOK) → imzalı web kancasıyla ev sahibinin cevabı (gerçek rota, gerçek
// ayrıştırıcı, gerçek gelen işleyici) → önizleme + düğmeler → imzalı düğme cevabı → GERÇEK gönderim çekirdeği (`sendHostMessage`; iç QR
// konuşması: dış kanal yok, mesaj kaydedilir) → misafire giden mesaj ev sahibinin adıyla. Taklit olan yalnız: model (taslak) ve WhatsApp ağı.
// ---------------------------------------------------------------------------

const APP_SECRET = "test-whatsapp-app-secret-0123456789";
const PNID = "109876543210987";
const HMAC = "test-host-channel-secret-0123456789abcdef";
const ENDPOINT = "https://www.lixusai.com/api/webhooks/host-channel/whatsapp";
const HOST_DIGITS = "905321112233";

type Out =
  | { kind: "question"; to: string; message: HostQuestionMessage }
  | { kind: "text"; to: string; text: string; replyTo?: string | null }
  | { kind: "choices"; to: string; text: string; choices: readonly HostChoice[]; replyTo?: string | null };
let out: Out[] = [];
let n = 0;
const transport: HostChannelTransport = {
  provider: WHATSAPP_CLOUD_PROVIDER,
  async sendQuestion(to, message) {
    out.push({ kind: "question", to, message });
    return { ok: true, providerMessageId: `wamid.Q${++n}` };
  },
  async sendText(to, text, replyTo) {
    out.push({ kind: "text", to, text, replyTo });
    return { ok: true, providerMessageId: `wamid.T${++n}` };
  },
  async sendChoices(to, text, choices, replyTo) {
    out.push({ kind: "choices", to, text, choices, replyTo });
    return { ok: true, providerMessageId: `wamid.P${++n}` };
  },
};

function webhook(msg: { id: string; context?: string; text?: string; button?: string }): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "905550000000", phone_number_id: PNID },
              contacts: [{ profile: { name: "Ev Sahibi" }, wa_id: HOST_DIGITS }],
              messages: [
                {
                  from: HOST_DIGITS,
                  id: msg.id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...(msg.context ? { context: { from: "905550000000", id: msg.context } } : {}),
                  ...(msg.button
                    ? { type: "interactive", interactive: { type: "button_reply", button_reply: { id: msg.button, title: "Gönder" } } }
                    : { type: "text", text: { body: msg.text ?? "" } }),
                },
              ],
            },
          },
        ],
      },
    ],
  });
}
const post = (raw: string) =>
  POST(
    new NextRequest(ENDPOINT, {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` },
    }),
  );

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ayla Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date("2026-11-12T00:00:00Z"),
      departureDate: new Date("2026-11-15T00:00:00Z"),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "qr", guestIdentifier: "Ayşe", status: "new", reservationId: reservation.id, externalReservationId: "qr-chat:e2e-token" },
  });
  const guest = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: "Ayşe",
      body: "Hi, this is Ayşe. Is there a baby cot? My number is +90 555 123 45 67",
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  await prisma.conversationItem.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: guest.id, kind: "amenities", sources: "understanding", status: "pending_host" },
  });
  const b = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 33", optInTextVersion: "v1" });
  if (!b.ok) throw new Error(b.reason);
  const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: HOST_DIGITS, code: b.code });
  if (!c.ok) throw new Error(c.reason);
  return { orgId: org.id, property, conversation, guest };
}

const askHost = (s: Awaited<ReturnType<typeof seed>>) =>
  notifyHostReplyWaiting({
    organizationId: s.orgId,
    conversation: { id: s.conversation.id, guestIdentifier: s.conversation.guestIdentifier, channel: s.conversation.channel },
    property: { name: s.property.name, address: null, city: null },
    messageId: s.guest.id,
    messageBody: s.guest.body,
    trigger: "handoff_held",
    itemKinds: ["amenities"],
  });

describe("WhatsApp ev sahibi döngüsü — uçtan uca", () => {
  beforeEach(async () => {
    await resetDb();
    out = [];
    n = 0;
    composeMock.mockReset();
    mailMock.mockClear();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", HMAC);
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
    __setHostChannelTransportForTest(transport);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setHostChannelTransportForTest(undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 tutulan tur → WhatsApp sorusu (e-posta yok) → ev sahibinin cevabı → önizleme → [Gönder] → misafire ev sahibinin adıyla gider", async () => {
    const s = await seed();
    expect(await askHost(s)).toBe("mailed");
    expect(mailMock).not.toHaveBeenCalled();
    const question = out.find((o) => o.kind === "question") as Extract<Out, { kind: "question" }>;
    expect(question.to).toBe(HOST_DIGITS);
    expect(question.message.property).toBe("Lale");
    expect(question.message.dates).toBe("12–15 Kas");
    // Misafirin adı ve telefonu Meta'ya gitmez.
    expect(question.message.quote).toContain("baby cot");
    expect(question.message.quote).not.toMatch(/ayşe|555 123/iu);
    const q = await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversation.id } });
    expect(q).toMatchObject({ status: "sent", providerMessageId: "wamid.Q1", turnMessageId: s.guest.id });

    // Ev sahibi soru mesajına "Yanıtla" ile yazar.
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Yes, there is a baby cot in the closet.", replyTr: "Evet, dolapta bebek yatağı var.", uncovered: [] });
    expect((await post(webhook({ id: "wamid.H1", context: "wamid.Q1", text: "var, dolapta" }))).status).toBe(200);
    expect(composeMock).toHaveBeenCalledTimes(1);
    const input = composeMock.mock.calls[0]![0] as { hostAnswer: string; guestMessages: string[] };
    expect(input.hostAnswer).toBe("var, dolapta");
    expect(input.guestMessages[0]).toContain("baby cot");
    expect(input.guestMessages[0]).not.toMatch(/ayşe/iu);
    const preview = out.find((o) => o.kind === "choices") as Extract<Out, { kind: "choices" }>;
    expect(preview.replyTo).toBe("wamid.Q1");
    expect(preview.text).toContain("Lale · 12–15 Kas");
    expect(preview.text).toContain("Yes, there is a baby cot in the closet.");
    const drafted = await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(drafted.status).toBe("awaiting_confirm");
    expect(preview.choices[0]!.id).toBe(hostQuestionButtonId(q.id, drafted.version, "send"));
    // Misafire henüz HİÇBİR ŞEY gitmedi.
    expect(await prisma.message.count({ where: { conversationId: s.conversation.id, direction: "outbound" } })).toBe(0);

    // [Gönder]
    expect((await post(webhook({ id: "wamid.H2", context: "wamid.P2", button: preview.choices[0]!.id }))).status).toBe(200);
    const sent = await prisma.message.findMany({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ body: "Yes, there is a baby cot in the closet.", authorType: "host", senderName: "Ayla Ev Sahibi", aiAssisted: true });
    expect(await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "done", resultMessageId: sent[0]!.id });
    expect(out[out.length - 1]).toMatchObject({ kind: "text", to: HOST_DIGITS, text: HOST_TEXTS.sent });
    // Turun açık öğesi bu cevapla "cevaplandı".
    expect(await prisma.conversationItem.findFirstOrThrow({ where: { conversationId: s.conversation.id } })).toMatchObject({
      status: "answered",
      answeredByMessageId: sent[0]!.id,
    });

    // Aynı düğmenin yeniden teslimi ikinci mesaj üretmez.
    await post(webhook({ id: "wamid.H2", context: "wamid.P2", button: preview.choices[0]!.id }));
    await post(webhook({ id: "wamid.H3", context: "wamid.P2", button: preview.choices[0]!.id }));
    expect(await prisma.message.count({ where: { conversationId: s.conversation.id, direction: "outbound" } })).toBe(1);
  });

  it("soru anahtarı KAPALI: bugünkü davranış — e-posta gider, WhatsApp sorusu kurulmaz", async () => {
    vi.stubEnv("HOST_QUESTIONS_ENABLED", "");
    const s = await seed();
    expect(await askHost(s)).toBe("mailed");
    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(0);
    expect(await prisma.hostQuestion.count()).toBe(0);
  });

  it("ev sahibi [Gönderme] derse misafire hiçbir şey gitmez, soru panelde açık", async () => {
    const s = await seed();
    await askHost(s);
    composeMock.mockResolvedValueOnce({ ok: true, kind: "answer", reply: "Yes, there is a baby cot.", replyTr: "Evet.", uncovered: [] });
    await post(webhook({ id: "wamid.H1", context: "wamid.Q1", text: "var" }));
    const preview = out.find((o) => o.kind === "choices") as Extract<Out, { kind: "choices" }>;
    await post(webhook({ id: "wamid.H2", button: preview.choices[1]!.id }));
    expect(await prisma.message.count({ where: { conversationId: s.conversation.id, direction: "outbound" } })).toBe(0);
    expect((await prisma.hostQuestion.findFirstOrThrow({ where: { conversationId: s.conversation.id } })).status).toBe("declined");
    expect(out[out.length - 1]).toMatchObject({ kind: "text", text: HOST_TEXTS.declined });
  });
});
