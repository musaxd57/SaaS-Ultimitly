import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// ANLAM KATMANI — QR ROTASI BAĞLANTISI (09-24; gerçek rota, DB'li, cevap modeli MOCK, bekçi
// çağrısı sahte fetch). "Yüklem var, argüman yok" sınıfına karşı DAVRANIŞSAL pin: şema beyanı ve
// mülkün saatleri kapıya ULAŞIYOR mu, bekçi yalnız aday için mi koşuyor, kanıt `sc` yazılıyor mu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const DAY = 86_400_000;
const ASK = "Could we get into the flat at 11?";

const DRAFT = {
  reply: "Check-in is from 15:00.",
  intent: "early_checkin",
  riskLevel: "none",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "en",
  usedSources: ["property:checkInTime"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed() {
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
  return { token };
}

let seq = 0;
async function ask(token: string, message: string) {
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `sc${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string; escalated?: boolean };
}

async function lastEvent() {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
  return { ev, sc: (JSON.parse(String(ev.kbEvidenceJson)) as { sc?: Record<string, string> }).sc };
}

const GUARD_GRANTS = {
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: "11:00",
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: true,
  reply_defers_to_host: false,
  reply_refuses: false,
};

describe("QR rotası — anlam katmanı bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("KONTROL: beyansız, kelime ağı sessiz → bot cevaplar; kanıtta 'absent'", async () => {
    mockSuggest.mockResolvedValue(DRAFT);
    const { token } = await seed();
    const out = await ask(token, ASK);
    expect(out.escalated).toBe(false);
    expect(out.reply).toBe(DRAFT.reply);
    expect((await lastEvent()).sc).toEqual({ v: "-", ev: "-", lx: "-", d: "absent", g: "off", u: "off" });
  });

  it("🚨 beyan edilen İZİN → devir; gerekçe `availability_claim`, taslak misafire GİTMEZ", async () => {
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Sure, see you at 11.", stayChange: { asked: "early_checkin", stance: "grants" } });
    const { token } = await seed();
    const out = await ask(token, ASK);
    expect(out.escalated).toBe(true);
    expect(out.reply).not.toContain("see you at 11");
    const { ev, sc } = await lastEvent();
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", d: "early_checkin/grants" });
  });

  it("🚨 bekçi açıkken beyansız izni ikinci model yakalar (mülk saatleri politikaya ulaşır)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(GUARD_GRANTS) } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Sure, see you at 11." });
    const { token } = await seed();
    const out = await ask(token, ASK);
    expect(f).toHaveBeenCalledTimes(1);
    expect(out.escalated).toBe(true);
    const { ev, sc } = await lastEvent();
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ g: "ok", gv: "qat" });
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "");
  });

  it("bekçi yalnız ADAY için: kapı zaten devrettiyse ikinci model çağrılmaz", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...DRAFT, confidence: 0.3 });
    const { token } = await seed();
    const out = await ask(token, ASK);
    expect(out.escalated).toBe(true);
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "");
  });
});
