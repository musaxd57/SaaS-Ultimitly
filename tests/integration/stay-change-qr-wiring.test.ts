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
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

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
function askRaw(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `sc${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}
async function ask(token: string, message: string) {
  return (await (await askRaw(token, message)).json()) as { reply?: string; escalated?: boolean };
}
/** Cihaz bağlama çerezi: aynı cihazdan ikinci mesaj aynı sohbete düşer (farklı cihaz geçmiş görmez). */
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? undefined;

async function lastEvent() {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
  const json = JSON.parse(String(ev.kbEvidenceJson)) as { sc?: Record<string, string>; retrieval?: Record<string, unknown> };
  return { ev, sc: json.sc, retrieval: json.retrieval };
}

/** Şema adına göre cevap veren sahte OpenAI (anlama katmanı ve bekçi aynı uca gider). */
function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}
const bodyOf = (f: ReturnType<typeof semanticFetch>, i: number) => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body));

const NLU_EARLY = {
  language: "en",
  requests: [{ intent: "early_checkin", query_tr: "erken giriş", query_original: "early check-in at 11" }],
  stay_change: { requested: true, kind: "early_checkin", checkin_time: "11:00", checkout_time: null },
};

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
    // Anlama katmanının süreç içi önbelleği testler arasında sızmasın (aynı mesaj = aynı anahtar).
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // Test İÇİNDE açılan bayrak (bekçi/anlama/kip) test yarıda düşse de sonrakine SIZMAZ.
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
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

  it("🚨 anlama katmanı QR kapısına ULAŞIR: gölge kipte bot cevaplar ama sinyal kanıtta; enforce kipinde devir", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    const f = semanticFetch({ guest_message_understanding: NLU_EARLY });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue(DRAFT);
    const { token } = await seed();
    const shadow = await ask(token, ASK);
    expect(bodyOf(f, 0).response_format.json_schema.name).toBe("guest_message_understanding");
    expect(shadow.escalated).toBe(false);
    const first = await lastEvent();
    expect(first.sc).toMatchObject({ v: "-", ev: "availability_unconfirmed", u: "req" });
    // Katman retrieval'da beklenmedi (boş KB) ama özeti karar kaydına YİNE girer.
    expect(first.retrieval).toMatchObject({ un: "ok", ui: ["early_checkin"] });

    await resetDb();
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    const { token: t2 } = await seed();
    const enforced = await ask(t2, ASK);
    expect(enforced.escalated).toBe(true);
    expect((await lastEvent()).ev.reason).toBe("availability_unconfirmed");
  });

  it("🚨 bekçi QR'da modelin gördüğü önceki konuşmayı da görür (takip izni bağlamla anlaşılır)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const clean = { ...GUARD_GRANTS, guest_requests_change: false, kind: "none", requested_checkin_time: null, reply_grants_change: false };
    const f = semanticFetch({ stay_change_guard: clean });
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...DRAFT, intent: "wifi", reply: "The Wi-Fi details are on the card next to the router.", usedSources: [] });
    const { token } = await seed();
    const first = await askRaw(token, "What is the wifi password?");
    expect(((await first.json()) as { escalated?: boolean }).escalated).toBe(false);
    mockSuggest.mockResolvedValue(DRAFT);
    await askRaw(token, ASK, cookieOf(first));
    expect(f).toHaveBeenCalledTimes(2);
    const second = bodyOf(f, f.mock.calls.length - 1).messages[1].content as string;
    expect(second).toContain("EARLIER CONVERSATION (context only, oldest first):");
    expect(second).toContain("Guest: <<<What is the wifi password?>>>");
    expect(second).toContain("[1] <<<Could we get into the flat at 11?>>>");
  });

  it("anlama katmanı DÜŞTÜ → bot eski davranışta; kanıtta 'failed' ('off'tan ayrı)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    mockSuggest.mockResolvedValue(DRAFT);
    const { token } = await seed();
    const out = await ask(token, ASK);
    expect(out.escalated).toBe(false);
    expect((await lastEvent()).sc).toMatchObject({ v: "-", u: "failed" });
  });

  it("🚨 bekçi müsaitlik onayı eksik diye DEVREDİLECEK cevapta da koşar: iki model erteleme → bot cevaplar (kanal paritesi)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const verdict = (defers: boolean) => ({
      ...GUARD_GRANTS,
      kind: "extend",
      requested_checkin_time: null,
      reply_grants_change: false,
      reply_defers_to_host: defers,
    });
    const reply = { ...DRAFT, intent: "extend_stay", reply: "Das muss Ihr Gastgeber entscheiden.", stayChange: { asked: "extend", stance: "defers" } };
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: verdict(true) }));
    mockSuggest.mockResolvedValue(reply);
    const { token } = await seed();
    const out = await ask(token, "Can we stay one more night?");
    expect(out.escalated).toBe(false);
    expect(out.reply).toBe(reply.reply);

    await resetDb();
    vi.stubGlobal("fetch", semanticFetch({ stay_change_guard: verdict(false) }));
    const { token: t2 } = await seed();
    const held = await ask(t2, "Can we stay one more night?");
    expect(held.escalated).toBe(true);
    expect((await lastEvent()).ev.reason).toBe("availability_unconfirmed");
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

  it("🚨 anlama katmanının RİSK NİYETİ QR kapısına ULAŞIR: gölge kipte bot cevaplar (kanıtta `ir`); enforce kipinde devir", async () => {
    // Kelime ağının KAÇIRDIĞI acil durum (ölçüldü: `classifyFallback` + `detectRiskType` engellemiyor).
    const MSG = "My daughter cut her hand badly, where is the nearest hospital?";
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      semanticFetch({
        guest_message_understanding: {
          language: "en",
          requests: [{ intent: "emergency", query_tr: "en yakın hastane", query_original: "nearest hospital" }],
          stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
        },
      }),
    );
    mockSuggest.mockResolvedValue({ ...DRAFT, intent: "general", reply: "The nearest hospital is 2 km away.", usedSources: [] });
    const irOf = async () =>
      (JSON.parse(String((await lastEvent()).ev.kbEvidenceJson)) as { ir?: Record<string, string> }).ir;
    const { token } = await seed();
    const shadow = await ask(token, MSG);
    expect(shadow.escalated).toBe(false);
    expect(await irOf()).toEqual({ v: "-", ev: "understanding_risk", k: "emergency" });

    await resetDb();
    vi.stubEnv("AI_INTENT_POLICY", "enforce");
    const { token: t2 } = await seed();
    const enforced = await ask(t2, MSG);
    expect(enforced.escalated).toBe(true);
    expect(enforced.reply).not.toContain("2 km");
    expect((await lastEvent()).ev.reason).toBe("understanding_risk");
    expect(await irOf()).toEqual({ v: "understanding_risk", ev: "understanding_risk", k: "emergency" });
  });
});
