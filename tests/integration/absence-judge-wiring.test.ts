import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// BAĞLAM HAKEMİ BAĞLANTISI (kurucu 10-21: "kelime bazlı tutmasın, bağlam bazlı tutsun"). Cevap modeli MOCK, veritabanı gerçek, hakem
// çağrısı sahte fetch (şema adı `absence_judge`). Pinlenen: anahtar kapalıyken bugünkü kelime kuralı birebir (hakem HİÇ çağrılmaz);
// açıkken kelime kuralının adayını hakem okur — "itiraf değil" → gider, "itiraf" → tutulur, hakem düşerse → tutulur; katı kip kelime
// kuralının kaçırdığı itirafı tutar. Kanal ve QR aynı kural.
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
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

/** Gerçek ölçümden (10-21): kelime kuralı "is not available" görüp tutuyordu; cevap bir OLGUDUR, itiraf değil. */
const FACT = "For security, the safe is not available for guest use.";
/**
 * Kelime kuralının SUSTUĞU geçiştirme ("bilgim yok"un örtük hâli). Kurucu 10-23 akşam 4.5'ten beri "Your host can confirm …" yönlendirmesini
 * kelime kuralı da tutar; burada yönlendirmesiz bir geçiştirme gerekir.
 */
const DEFLECT = "Whether there is a pool is best checked on arrival.";

const DRAFT = (reply: string) => ({
  intent: "amenities",
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

function judgeFetch(verdict: { admits_missing_info: boolean; quote: string } | null) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "absence_judge") throw new Error(`beklenmeyen şema: ${name}`);
    if (!verdict) return new Response("upstream down", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}
const NOT_ADMIT = { admits_missing_info: false, quote: "" };
const ADMITS = (quote: string) => ({ admits_missing_info: true, quote });

async function seedChannel(ask: string) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: ask, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}
/** Kapıyı kapatan kontrolün ayrıntısı (karar kaydının `g.d` alanı). */
const reasonOf = async (conversationId: string) =>
  JSON.parse((await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } })).kbEvidenceJson ?? "{}").g?.d;

describe("bağlam hakemi — kanal oto-yanıtı", () => {
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

  it("anahtar KAPALI: kelime kuralı tutar, hakem çağrılmaz (bugünkü davranış birebir)", async () => {
    const f = judgeFetch(NOT_ADMIT);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const id = await seedChannel("Can we use the safe?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_absence");
    expect(f).not.toHaveBeenCalled();
  });

  it("anahtar AÇIK + hakem 'itiraf değil' → cevap gider (yanlış tutma kalkar)", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    const f = judgeFetch(NOT_ADMIT);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const id = await seedChannel("Can we use the safe?");
    await applyChannelAutoReply(id);
    // S2 (10-22): iki okuma — misafir mesajıyla ve misafir mesajı OLMADAN; serbest bırakma ikisi de "itiraf yok" derse.
    expect(f).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const users = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).messages[1].content as string);
    // Bağlamlı okuma misafirin mesajını gördü; ikinci okuma görmedi. İkisinde de cevap çitlerin içinde.
    expect(users.filter((u) => u.includes("Can we use the safe?"))).toHaveLength(1);
    expect(users.every((u) => u.includes(FACT))).toBe(true);
  });

  it("anahtar AÇIK + hakem 'itiraf' → tutulur", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    vi.stubGlobal("fetch", judgeFetch(ADMITS(FACT)));
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const id = await seedChannel("Can we use the safe?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_absence");
  });

  it("anahtar AÇIK + hakem düştü (503) → bugünkü kelime kuralı tutar", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    vi.stubGlobal("fetch", judgeFetch(null));
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const id = await seedChannel("Can we use the safe?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_absence");
  });

  it("katı kip: kelime kuralının kaçırdığı geçiştirmeyi hakem 'itiraf' derse tutar", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    vi.stubEnv("AI_ABSENCE_JUDGE_STRICT", "1");
    vi.stubGlobal("fetch", judgeFetch(ADMITS(DEFLECT)));
    mockSuggest.mockResolvedValue(DRAFT(DEFLECT));
    const id = await seedChannel("Is there a pool?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await reasonOf(id)).toBe("reply_absence");
  });

  it("KONTROL: katı kip KAPALI → kelime kuralının sustuğu cevaba hakem çağrılmaz, gider", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    const f = judgeFetch(ADMITS(DEFLECT));
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(DEFLECT));
    const id = await seedChannel("Is there a pool?");
    await applyChannelAutoReply(id);
    expect(f).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

// ── QR ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
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
      body: JSON.stringify({ message, requestId: `aj${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string; escalated?: boolean };
}

describe("bağlam hakemi — QR misafir sohbeti (kanal kapısıyla aynı kural)", () => {
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

  it("anahtar KAPALI: devir (bugünkü davranış), hakem çağrılmaz", async () => {
    const f = judgeFetch(NOT_ADMIT);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const out = await ask(await seedQr(), "Can we use the safe?");
    expect(out.escalated).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("anahtar AÇIK + hakem 'itiraf değil' → misafir cevabı alır", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    const f = judgeFetch(NOT_ADMIT);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const out = await ask(await seedQr(), "Can we use the safe?");
    expect(f).toHaveBeenCalledTimes(2); // S2: bağlamlı + yalnız taslak okuması
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(FACT);
  });

  it("anahtar AÇIK + hakem düştü → devir", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    vi.stubGlobal("fetch", judgeFetch(null));
    mockSuggest.mockResolvedValue(DRAFT(FACT));
    const out = await ask(await seedQr(), "Can we use the safe?");
    expect(out.escalated).toBe(true);
  });

  it("katı kip: geçiştirme 'itiraf' → devir; katı kip kapalıyken aynı cevap gider", async () => {
    vi.stubEnv("AI_ABSENCE_JUDGE_ENABLED", "1");
    vi.stubEnv("AI_ABSENCE_JUDGE_STRICT", "1");
    vi.stubGlobal("fetch", judgeFetch(ADMITS(DEFLECT)));
    mockSuggest.mockResolvedValue(DRAFT(DEFLECT));
    expect((await ask(await seedQr(), "Is there a pool?")).escalated).toBe(true);
    await resetDb();
    vi.stubEnv("AI_ABSENCE_JUDGE_STRICT", "");
    const out = await ask(await seedQr(), "Is there a pool?");
    expect(out.escalated).toBeFalsy();
    expect(out.reply).toBe(DEFLECT);
  });
});
