import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// KIDEMLİ OKUYUCU BAĞLANTISI (T-b, kurucu 10-22: "bütün kontrolleri tek çağrıda toplayabiliriz en iyi şekilde kontrol sağlansın"; anahtar
// `AI_SENIOR_READER_ENABLED` KAPALI). Cevap modeli MOCK, veritabanı gerçek, okuyucu sahte fetch (şema adı `senior_reader`). Pinlenen:
// anahtar kapalıyken okuyucu HİÇ çağrılmaz (bugünkü davranış birebir); açıkken kelime adayı olmayan, kapıdan geçen cevap da okunur ve
// ev sahibine platform dışı ödeme (T-d) / Airbnb'de onaysız konuşmada platform dışı iletişim / özür (T-a) cevabı TUTAR; onaylı konaklamada
// iletişim bilgisi gider; okuyucu düşerse bugünkü kurallar (gider). Kanal ve QR.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { NextRequest } from "next/server";
import { suggestReply } from "@/lib/ai";
import { emailService } from "@/lib/email";
import { SENIOR_REWRITE_NOTES } from "@/lib/ai/semantic/senior-rewrite";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

const CONTACT = "Check-in is from 15:00. For anything else, just message me on WhatsApp.";
const PAY_HOST = "Check-in is from 15:00. The parking fee can be paid to me in cash when you arrive.";
const PARKING_THIRD_PARTY = "Check-in is from 15:00. The public car park on the corner charges 150 TL a day, paid at the booth.";

const DRAFT = (reply: string) => ({
  intent: "check_in",
  confidence: 0.9,
  reply,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["property:checkInTime"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
});

type Checks = Partial<{ payHost: boolean; contact: boolean; apology: boolean }>;
const NOTHING = {
  admits_missing_info: false,
  quote: "",
  pays_host_off_platform: false,
  payment_quote: "",
  off_platform_contact: false,
  contact_quote: "",
  apology_or_fault: false,
  apology_quote: "",
};
/** Gerçek okuyucu gibi: "evet" dediği hükümde taslaktan bir cümle alıntılar (kanıt şartı, `groundReading`) — testlerde sorunlu cümle sonda. */
function lastDraftSentence(init?: RequestInit): string {
  const user = String(JSON.parse(String(init?.body)).messages?.[1]?.content ?? "");
  const draft = user.split("DRAFT REPLY:")[1]?.replace(/^\s*<<</, "").replace(/>>>\s*$/, "") ?? "";
  const parts = draft.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
}
function readerFetch(c: Checks | null) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "senior_reader") throw new Error(`beklenmeyen şema: ${name}`);
    if (!c) return new Response("upstream down", { status: 503 });
    const q = lastDraftSentence(init);
    const verdict = {
      admits_missing_info: false,
      quote: "",
      pays_host_off_platform: c.payHost === true,
      payment_quote: c.payHost ? q : "",
      off_platform_contact: c.contact === true,
      contact_quote: c.contact ? q : "",
      apology_or_fault: c.apology === true,
      apology_quote: c.apology ? q : "",
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}

async function seedChannel(opts: { reservation?: "confirmed_in_stay" | "pending" } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = opts.reservation
    ? await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: "Alex",
          arrivalDate: new Date(Date.now() - DAY),
          departureDate: new Date(Date.now() + 2 * DAY),
          status: opts.reservation === "confirmed_in_stay" ? "confirmed" : "pending",
          channel: "airbnb",
          currency: "EUR",
        },
        select: { id: true },
      })
    : null;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      reservationId: reservation?.id,
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", body: "What time is check-in?", createdAt: new Date(Date.now() - 60_000) }],
      },
    },
    select: { id: true },
  });
  return conversation.id;
}
const reasonOf = async (conversationId: string) =>
  JSON.parse((await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } })).kbEvidenceJson ?? "{}").g?.d;

describe("kıdemli okuyucu — kanal oto-yanıtı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtar KAPALI: okuyucu çağrılmaz, cevap bugünkü gibi gider", async () => {
    const f = readerFetch({ contact: true });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const id = await seedChannel();
    await applyChannelAutoReply(id);
    expect(f).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("açık: kelime adayı olmayan aday da okunur — Airbnb ön soruda platform dışı iletişim: bir kez yeniden yazılır, yine takılırsa TUTULUR", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const f = readerFetch({ contact: true });
    vi.stubGlobal("fetch", f);
    // Yeniden yazılan taslak FARKLI metin (aynı metin olsaydı okuyucunun hükmü yeniden kullanılır, ikinci okuma olmazdı — ayrı test).
    mockSuggest.mockResolvedValueOnce(DRAFT(CONTACT)).mockResolvedValue(DRAFT(`${CONTACT} See you soon!`));
    const id = await seedChannel();
    await applyChannelAutoReply(id);
    // İlk taslak (iki okuma) → yeniden yazma → yeni taslak (iki okuma): 4 okuma, 2 cevap çağrısı, TEK yeniden yazma.
    expect(f).toHaveBeenCalledTimes(4);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_offplatform_contact");
    // Kurucu: "cevap gitmedi diye sürekli hosta mail gitmesin" — bu tutuş e-posta göndermez.
    expect(vi.mocked(emailService.send)).not.toHaveBeenCalled();
    expect(vi.mocked(emailService.sendReporting)).not.toHaveBeenCalled();
  });

  it("açık: yeniden yazma AYNI metni dönerse okuyucu ikinci kez çağrılmaz (hüküm aynı metne bağlı), cevap yine tutulur", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const f = readerFetch({ contact: true });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const id = await seedChannel();
    await applyChannelAutoReply(id);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_offplatform_contact");
  });

  it("açık: yeniden yazılan metin OKUNAMAZSA (okuma düştü) ilk taslak kalır ve TUTULUR — okunmamış metin gitmez (Haiku 10-22)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    let n = 0;
    const flagged = readerFetch({ contact: true });
    const f = vi.fn(async (url: string, init?: RequestInit) => (++n <= 2 ? flagged(url, init) : new Response("down", { status: 503 })));
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValueOnce(DRAFT(CONTACT)).mockResolvedValue(DRAFT("Check-in is from 15:00. See you soon!"));
    const id = await seedChannel();
    await applyChannelAutoReply(id);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_offplatform_contact");
  });

  it("🚨 açık: ilk taslak Airbnb'nin engelleyeceği iletişim taşıyor → model SEBEBİ not alıp aynı anlamda yeniden yazar → temiz taslak GİDER", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const CLEAN = "Check-in is from 15:00. For anything else, just write to me here in this chat.";
    // Okuyucu metne bakar: WhatsApp geçen taslak "iletişim", geçmeyen temiz.
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const user = JSON.parse(String(init?.body)).messages[1].content as string;
      const contact = /whatsapp/i.test(user.split("DRAFT REPLY:")[1] ?? "");
      const v = { ...NOTHING, off_platform_contact: contact, contact_quote: contact ? lastDraftSentence(init) : "" };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(v) } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValueOnce(DRAFT(CONTACT)).mockResolvedValueOnce(DRAFT(CLEAN));
    const id = await seedChannel();
    await applyChannelAutoReply(id);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    // İkinci çağrı sebebi biliyor: Airbnb notu modele gitti.
    const notes = (mockSuggest.mock.calls[1][0] as { knowledgeBaseNotes?: string[] }).knowledgeBaseNotes ?? [];
    expect(notes).toContain(SENIOR_REWRITE_NOTES.contact);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockSend.mock.calls[0])).toContain("write to me here in this chat");
    expect(JSON.stringify(mockSend.mock.calls[0])).not.toMatch(/whatsapp/i);
    // Kanıt kaydı: yeniden yazma sebebi (kapalı küme kod, metin yok).
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(JSON.parse(ev.kbEvidenceJson ?? "{}").rw).toEqual(["contact"]);
  });

  it("açık: onaylı konaklamada iletişim bilgisi kural değil → yeniden yazma YOK, ilk taslak gider", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({ contact: true }));
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const id = await seedChannel({ reservation: "confirmed_in_stay" });
    await applyChannelAutoReply(id);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("açık: talep (pending) rezervasyonda da tutulur; onaylı konaklama SÜRERKEN iletişim bilgisi gider (Airbnb de paylaşır)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({ contact: true }));
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const pending = await seedChannel({ reservation: "pending" });
    await applyChannelAutoReply(pending);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(pending)).toBe("reply_offplatform_contact");
    await resetDb();
    const inStay = await seedChannel({ reservation: "confirmed_in_stay" });
    await applyChannelAutoReply(inStay);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("açık: ev sahibine platform dışı ödeme onaylı konaklamada da TUTULUR (T-d)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({ payHost: true }));
    mockSuggest.mockResolvedValue(DRAFT(PAY_HOST));
    const id = await seedChannel({ reservation: "confirmed_in_stay" });
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_offplatform_payment");
  });

  it("açık: üçüncü tarafa ödeme bilgisi (otopark gişesi) gider", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({}));
    mockSuggest.mockResolvedValue(DRAFT(PARKING_THIRD_PARTY));
    const id = await seedChannel({ reservation: "confirmed_in_stay" });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("açık: özür yalnız özür kuralı açıkken tutar (T-a)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({ apology: true }));
    const SORRY = "We are sorry for the trouble. Check-in is from 15:00.";
    mockSuggest.mockResolvedValue(DRAFT(SORRY));
    const ruleOn = await seedChannel({ reservation: "confirmed_in_stay" });
    vi.stubEnv("AI_NO_APOLOGY_RULE_ENABLED", "1");
    await applyChannelAutoReply(ruleOn);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(ruleOn)).toBe("reply_apology");
  });

  it("açık + okuyucu düştü (503): bugünkü kurallar — kelime adayı yoksa cevap gider", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch(null));
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const id = await seedChannel({ reservation: "confirmed_in_stay" });
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ── QR ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function seedQr() {
  const { propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return token;
}
let seq = 0;
async function ask(token: string, message: string) {
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `sr${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string; escalated?: boolean };
}

describe("kıdemli okuyucu — QR misafir sohbeti", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("anahtar KAPALI: okuyucu çağrılmaz, cevap gider", async () => {
    const f = readerFetch({ payHost: true });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(PAY_HOST));
    const out = await ask(await seedQr(), "What time is check-in?");
    expect(f).not.toHaveBeenCalled();
    expect(out.escalated).toBeFalsy();
  });

  it("açık: ev sahibine ödeme ilk taslakta → bir kez yeniden yazılır; temiz taslak misafire gider (devir yok)", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    const CLEAN = "Check-in is from 15:00. The cleaning fee is part of your booking total.";
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const user = JSON.parse(String(init?.body)).messages[1].content as string;
      const payHost = /in cash/i.test(user.split("DRAFT REPLY:")[1] ?? "");
      const v = { ...NOTHING, pays_host_off_platform: payHost };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(v) } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValueOnce(DRAFT(PAY_HOST)).mockResolvedValueOnce(DRAFT(CLEAN));
    const out = await ask(await seedQr(), "What time is check-in?");
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(CLEAN);
  });

  it("açık: ev sahibine platform dışı ödeme → devir; platform dışı iletişim QR'da kural DEĞİL (OTA yok) → gider", async () => {
    vi.stubEnv("AI_SENIOR_READER_ENABLED", "1");
    vi.stubGlobal("fetch", readerFetch({ payHost: true }));
    mockSuggest.mockResolvedValue(DRAFT(PAY_HOST));
    expect((await ask(await seedQr(), "What time is check-in?")).escalated).toBe(true);
    await resetDb();
    vi.stubGlobal("fetch", readerFetch({ contact: true }));
    mockSuggest.mockResolvedValue(DRAFT(CONTACT));
    const out = await ask(await seedQr(), "What time is check-in?");
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(CONTACT);
  });
});
