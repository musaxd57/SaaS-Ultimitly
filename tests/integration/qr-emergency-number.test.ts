// ---------------------------------------------------------------------------
// QR — ACİL NUMARA SORUSU → KOD METNİ (kurucu kararları 10-11; anahtar `AI_EMERGENCY_NUMBER_ENABLED`, VARSAYILAN KAPALI). Gerçek rota +
// gerçek PostgreSQL + gerçek QR kapısı; cevap modeli MOCK, anlama katmanı sahte fetch. Her "gider" iddiasının aynı tohumla "gitmez"
// kontrolü var (anahtar kapalı / ev sahibi sözcüğü / konaklama konusu / önceki mesaj / Türkiye dışı).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { emailService } from "@/lib/email";

/** Ev sahibine giden uyarı e-postalarının gövdeleri (QR_ESCALATION_EMAIL_ENABLED açık). */
const alertBodies = () => vi.mocked(emailService.sendReporting).mock.calls.map((c) => String(c[2]));

const MODEL_DRAFT = "Size yardımcı olmaya çalışıyorum.";
let intents: string[] = ["emergency"];
let understandingLanguage = "tr";

const model = () => ({
  reply: MODEL_DRAFT,
  intent: "general",
  riskLevel: "low",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  usedSources: [],
  missingInfo: [],
  detectedLanguage: understandingLanguage,
});

function fakeFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const content =
      name === "stay_change_guard"
        ? JSON.stringify({
            guest_requests_change: false,
            kind: "none",
            requested_checkin_time: null,
            requested_checkout_time: null,
            reply_states_calendar: false,
            reply_grants_change: false,
            reply_defers_to_host: false,
            reply_refuses: false,
            reply_price_terms: false,
            reply_amounts: [],
          })
        : JSON.stringify({
            language: understandingLanguage,
            requests: intents.map((intent) => ({ intent, query_tr: "soru", query_original: "soru" })),
            stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
          });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
  });
}

async function seed(opts: { timezone?: string } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "owner@x.com", passwordHash: "x", role: "owner" } });
  if (opts.timezone) await prisma.organization.update({ where: { id: orgId }, data: { timezone: opts.timezone } });
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token } });
  await prisma.reservation.create({
    data: { propertyId, guestName: "Ayşe Yılmaz", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return { propertyId, token };
}

let seq = 0;
let cookie: string | undefined;
const ask = async (token: string, message: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${++seq % 250}` };
  if (cookie) headers.cookie = cookie;
  const res = await POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `en-${seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return res;
};

const botReplies = async (propertyId: string) =>
  (await prisma.message.findMany({ where: { direction: "outbound", conversation: { propertyId } }, orderBy: { createdAt: "asc" } })).map(
    (m) => m.body,
  );
const lastEvent = () => prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] });
const conversationOf = (propertyId: string) => prisma.conversation.findFirstOrThrow({ where: { propertyId } });

describe("QR — acil numara sorusu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    cookie = undefined;
    intents = ["emergency"];
    understandingLanguage = "tr";
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "1");
    vi.stubEnv("QR_ESCALATION_EMAIL_ENABLED", "1");
    vi.stubGlobal("fetch", fakeFetch());
    mockSuggest.mockResolvedValue(model());
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 hastalık + ambulans numarası → YALNIZ 'Ambulans: 112' gider (modelin taslağı değil); ev sahibi acil olarak uyarılır", async () => {
    const s = await seed();
    expect((await ask(s.token, "Annem fenalaştı, ambulans numarası kaçtı?")).status).toBe(200);
    expect(await botReplies(s.propertyId)).toEqual(["Ambulans: 112"]);
    const ev = await lastEvent();
    expect(ev.reason).toBe("emergency_number");
    expect(ev.finalDecision).toBe("human_review");
    expect((await conversationOf(s.propertyId)).priority).toBe("urgent");
    // Ev sahibinin e-postası numaranın GİTTİĞİNİ söyler — "yanıtlamadı" yanlış beyan olurdu (Haiku 10-11).
    const [mail] = alertBodies();
    expect(mail).toContain("yalnız o numarayı gönderdi");
    expect(mail).not.toContain("yanıtlamadı");
  });

  it("KONTROL: anahtar KAPALI → aynı mesajda numara GİTMEZ (bugünkü davranış: misafire hiçbir şey, ev sahibine devir)", async () => {
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "");
    const s = await seed();
    await ask(s.token, "Annem fenalaştı, ambulans numarası kaçtı?");
    expect(await botReplies(s.propertyId)).toEqual([]);
    expect((await lastEvent()).reason).not.toBe("emergency_number");
    expect(alertBodies().every((m) => !m.includes("numarayı gönderdi"))).toBe(true);
  });

  it("kısa İngilizce soru (metinden dil okunamıyor) → anlama katmanının dili: 'Police: 155' (mutasyon R9)", async () => {
    understandingLanguage = "en";
    const s = await seed();
    await ask(s.token, "Police number?");
    expect(await botReplies(s.propertyId)).toEqual(["Police: 155"]);
  });

  it("servis başına numara + misafirin dili: polis 155, İngilizce soruya İngilizce etiket", async () => {
    const s = await seed();
    await ask(s.token, "Arabamızın camı kırılmış, çantamız çalınmış. Polisin numarası ne?");
    understandingLanguage = "en";
    await ask(s.token, "What's the ambulance number here? My husband has chest pain.");
    expect(await botReplies(s.propertyId)).toEqual(["Polis: 155", "Ambulance: 112"]);
  });

  it("🚨 ev sahibi şikâyeti → numara GİTMEZ (anlama katmanı yalnız 'acil' dese de — ölçümdeki h1 tekrar 2)", async () => {
    const s = await seed();
    await ask(s.token, "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
    expect((await lastEvent()).reason).not.toBe("emergency_number");
  });

  it.each([
    ["anlama: şikâyet + acil", ["complaint_issue", "emergency"]],
    ["anlama: yalnız acil", ["emergency"]],
  ])(
    "🚨 ev sahibinin KENDİSİ tehdit (%s) → ACİL devir, misafire HİÇBİR mesaj (kurucu 10-11: 'bu acil olsun, bir şey gitmesin')",
    async (_n, given) => {
      intents = given as string[];
      const s = await seed();
      await ask(s.token, "Ev sahibi kapıyı izinsiz açıp içeri girdi, korkuyorum. Polis numarası ne?");
      expect(await botReplies(s.propertyId)).toEqual([]);
      const ev = await lastEvent();
      expect(ev.reason).not.toBe("emergency_number");
      expect(ev.finalDecision).toBe("human_review");
      expect((await conversationOf(s.propertyId)).priority).toBe("urgent");
      expect(alertBodies()).toHaveLength(1);
      expect(alertBodies()[0]).not.toContain("numarayı gönderdi");
    },
  );

  it("🚨 anlama katmanı şikâyet dedi → numara GİTMEZ (ev sahibi sözcüğü olmasa da)", async () => {
    intents = ["complaint_issue", "emergency"];
    const s = await seed();
    await ask(s.token, "Üst kat sürekli gürültü yapıyor, uyuyamıyoruz. Polis numarası ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
  });

  it("🚨 konaklama konusuyla birlikte (kapı kodu çalışmıyor + polis) → numara GİTMEZ (ölçümdeki h4)", async () => {
    intents = ["access_keys", "emergency"];
    const s = await seed();
    await ask(s.token, "Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
  });

  it("🚨 aynı turdaki önceki cevapsız mesajda ev sahibi şikâyeti → sonraki 'Polis numarası ne?' de numara GİTMEZ", async () => {
    const s = await seed();
    intents = ["complaint_issue"];
    await ask(s.token, "Ev sahibi depozitomu vermiyor.");
    intents = ["emergency"];
    await ask(s.token, "Polis numarası ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
  });

  it("KONTROL: önceki mesaj ev sahibiyle ilgisizse ikinci mesajdaki numara sorusu cevaplanır", async () => {
    const s = await seed();
    intents = ["other"];
    mockSuggest.mockResolvedValueOnce({ ...model(), confidence: 0.2 });
    await ask(s.token, "Arabamızın camı kırılmış.");
    intents = ["emergency"];
    await ask(s.token, "Polis numarası ne?");
    expect((await botReplies(s.propertyId)).at(-1)).toBe("Polis: 155");
  });

  it("KONTROL: işletmenin saat dilimi Türkiye değil → numara GİTMEZ (numaralar Türkiye'nin)", async () => {
    const s = await seed({ timezone: "Europe/Berlin" });
    await ask(s.token, "Annem fenalaştı, ambulans numarası kaçtı?");
    expect(await botReplies(s.propertyId)).toEqual([]);
  });

  it("🚨 AÇIK tehlike + numara sorusu → model çağrılmadan 'İtfaiye: 110'; ev sahibine acil devir aynen", async () => {
    const s = await seed();
    await ask(s.token, "Mutfakta yangın çıktı! İtfaiye numarası ne?");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await botReplies(s.propertyId)).toEqual(["İtfaiye: 110"]);
    const ev = await lastEvent();
    expect(ev.reason).toBe("physical_hazard");
    expect(ev.finalDecision).toBe("human_review");
    expect((await conversationOf(s.propertyId)).priority).toBe("urgent");
    expect(alertBodies()[0]).toContain("yalnız o numarayı gönderdi");
  });

  it("🚨 AÇIK tehlike + numara sorusu, aynı turda önceki mesajda ev sahibi şikâyeti → numara GİTMEZ", async () => {
    const s = await seed();
    intents = ["complaint_issue"];
    await ask(s.token, "Ev sahibi hiç cevap vermiyor.");
    await ask(s.token, "Mutfakta yangın çıktı! İtfaiye numarası ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
    expect((await lastEvent()).reason).toBe("physical_hazard");
  });

  it("numara giderken ev sahibi HER ZAMAN uyarılır — anlama katmanı 'acil' demese de (misafirin numara sorması bilinmesi gereken olay)", async () => {
    intents = ["other"];
    understandingLanguage = "ru";
    const s = await seed();
    await ask(s.token, "Какой номер скорой помощи?");
    expect(await botReplies(s.propertyId)).toEqual(["Скорая помощь: 112"]);
    expect((await lastEvent()).finalDecision).toBe("human_review");
    expect((await conversationOf(s.propertyId)).priority).toBe("urgent");
  });

  it("KONTROL: AÇIK tehlike, numara SORULMADI → misafire hiçbir şey (kurucu: yönlendirme yok)", async () => {
    const s = await seed();
    await ask(s.token, "Mutfakta yangın çıktı!");
    expect(await botReplies(s.propertyId)).toEqual([]);
    expect(alertBodies()[0]).toContain("yanıtlamadı");
  });

  // Kurucu 10-31 (devam eden kişisel tehlike): QR hızlı devir aynı tehlike okuyucusunu okur — model çağrılmaz, misafire metin gitmez, ev
  // sahibine kritik uyarı. Varsayımsal / önlem sorusu normal akışta modele gider.
  it("🚨 QR: 'Biri kapıyı zorluyor!' → model çağrılmaz, misafire hiçbir şey, ev sahibine kritik uyarı + Acil", async () => {
    const s = await seed();
    await ask(s.token, "Biri kapıyı zorluyor!");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await botReplies(s.propertyId)).toEqual([]);
    expect((await lastEvent()).reason).toBe("physical_hazard");
    expect((await conversationOf(s.propertyId)).priority).toBe("urgent");
    expect(alertBodies()[0]).toContain("yanıtlamadı");
  });

  it("KONTROL QR: 'Hırsızlığa karşı kasa var mı?' hızlı devir DEĞİL — model normal akışta çağrılır", async () => {
    intents = ["other"];
    const s = await seed();
    await ask(s.token, "Hırsızlığa karşı kasa var mı?");
    expect(mockSuggest).toHaveBeenCalled();
  });

  it("KONTROL: AÇIK tehlike + numara sorusu, anahtar KAPALI → misafire hiçbir şey", async () => {
    vi.stubEnv("AI_EMERGENCY_NUMBER_ENABLED", "");
    const s = await seed();
    await ask(s.token, "Mutfakta yangın çıktı! İtfaiye numarası ne?");
    expect(await botReplies(s.propertyId)).toEqual([]);
  });
});
