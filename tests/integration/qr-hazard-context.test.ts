import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// 55 + 51 — QR ROTASI BAĞLANTISI (kurucu onayı 10-02 akşam; gerçek rota, DB'li, cevap modeli MOCK, anlama katmanı sahte fetch).
//  · AÇIK tehlike: model BEKLENMEDEN güvenlik satırı (misafirin dilinde), ücretli çağrı yok, karar kaydı `physical_hazard`.
//  · OLASI tehlike: karar anlama katmanında; katman koşmadıysa güvenli taraf (satır), koştu ve "acil değil" dediyse alarm kalkar.
//  · ANILAN tehlike ("yangın çıkarsa…"): kelime ağının acil etiketi bağlamla kalkar, misafir cevabını alır.
//  · Alarm bağlamla kalktıysa "normaldir / endişelenmeyin" güvencesi bilgi tabanı dayanağı olmadan GİTMEZ (`hazard_reassurance`).
//  · Model çağrısı OLMAYAN dallar (bütçe): olası tehlike satır alır, anılan tehlike almaz.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const DAY = 86_400_000;

const DRAFT = {
  reply: "Bina girişinin yanındaki merdivenden çıkabilirsiniz.",
  intent: "general",
  riskLevel: "none",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
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
function askRaw(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `hz${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}
async function ask(token: string, message: string, cookie?: string) {
  return (await (await askRaw(token, message, cookie)).json()) as { reply?: string | null; escalated?: boolean };
}
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? undefined;

async function lastEvent() {
  return prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
}

/** Anlama katmanı sahte cevabı (şema adına göre). */
function understandingFetch(intent: string) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    const verdict = {
      language: "tr",
      requests: [{ intent, query_tr: "çaydanlık duman", query_original: "çaydanlık duman" }],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}

const KETTLE = "Çaydanlıktan duman çıkıyor, normal mi?";
const FIRE_IF = "Yangın çıkarsa hangi kapıdan çıkmalıyız?";

describe("QR rotası — bağlamla tehlike (55 + 51)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 AÇIK tehlike (Fransızca): model ÇAĞRILMAZ, misafire HİÇBİR metin gitmez (kurucu 10-11), devir; karar kaydı physical_hazard", async () => {
    const { token } = await seed();
    const out = await ask(token, "Il y a le feu dans la cuisine !");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull(); // kurucu kararı 10-11: 112 satırı YOK
    const ev = await lastEvent();
    expect(ev.reason).toBe("physical_hazard");
    expect(ev.riskType).toBe("safety_emergency");
    expect(ev.finalDecision).toBe("human_review");
  });

  it("🚨 AÇIK tehlike (Türkçe): misafire metin yok, devir; ücretli çağrı yok", async () => {
    const { token } = await seed();
    const out = await ask(token, "Mutfakta gaz kokusu var!");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull(); // kurucu kararı 10-11: 112 satırı YOK
  });

  it("OLASI tehlike + anlama katmanı KAPALI (değerlendirecek model yok) → güvenli taraf: devir, misafire metin yok", async () => {
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin." });
    const { token } = await seed();
    const out = await ask(token, KETTLE);
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull(); // kurucu kararı 10-11: 112 satırı YOK
    expect((await lastEvent()).reason).toBe("keyword_risk_type");
  });

  it("OLASI tehlike + anlama katmanı 'acil değil' → acil DEĞİL (112 satırı yok) ama şikâyet akışı: ev sahibinde, misafire metin yok", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin." });
    const { token } = await seed();
    const out = await ask(token, KETTLE);
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull();
    const ev = await lastEvent();
    expect(ev.reason).toBe("keyword_risk_type");
  });

  it("🚨 OLASI tehlike + anlama katmanı 'acil' → devir, misafire metin yok", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("emergency"));
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin." });
    const { token } = await seed();
    const out = await ask(token, KETTLE);
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull(); // kurucu kararı 10-11: 112 satırı YOK
  });

  it("🚨 alarm bağlamla kalktıysa KAYNAKSIZ güvence ('normaldir, endişelenmeyin') gitmez → hazard_reassurance, misafire metin yok", async () => {
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Bina tamamen güvenlidir, endişelenmeyin; çıkış merdiveni koridorun sonunda." });
    const { token } = await seed();
    const out = await ask(token, FIRE_IF);
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull();
    expect((await lastEvent()).reason).toBe("hazard_reassurance");
  });

  it("ANILAN tehlike ('yangın çıkarsa…'), anlama katmanı kapalı da olsa: acil etiketi kalkar, cevap gider", async () => {
    mockSuggest.mockResolvedValue(DRAFT);
    const { token } = await seed();
    const out = await ask(token, FIRE_IF);
    expect(out.escalated).toBe(false);
    expect(out.reply).toBe(DRAFT.reply);
    expect((await lastEvent()).reason).toBe("gate_passed");
  });

  it("model çağrısı OLMAYAN dal (org bütçesi dolu): olası da anılan tehlike de devir — misafire metin yok", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Çöp kutusu girişin solunda." });
    const { token } = await seed();
    const first = await askRaw(token, "Çöp nereye atılıyor?");
    const cookie = cookieOf(first);
    const possible = await ask(token, KETTLE, cookie);
    expect(possible.escalated).toBe(true);
    expect(possible.reply ?? null).toBeNull(); // kurucu kararı 10-11: 112 satırı YOK
    const mentioned = await ask(token, FIRE_IF, cookie);
    expect(mentioned.escalated).toBe(true);
    expect(mentioned.reply ?? null).toBeNull();
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });
});
