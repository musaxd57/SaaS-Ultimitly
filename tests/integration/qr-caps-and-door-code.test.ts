import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// KURUCU KARARLARI 10-11 — QR (karar listesi 15, 17, 18, 19 + Wi-Fi sorusu). Gerçek rota + gerçek PostgreSQL; yalnız model ve e-posta
// taklit.
//  · 15: konaklama başına saatte 40 mesaj — üstünde yapay zekâ çağrılmaz, mesaj KAYDEDİLMEZ, misafir onaylı metni görür (429),
//        ev sahibine saatte TEK kayıt (konuşma "iletildi" işareti + karar kaydı).
//  · 17: acil e-postası konaklama başına saatte en çok 3.
//  · 18: cevapta kapı kodu → bir kez yeniden yazdırılır (kural not olarak); yine kodluysa cevap gitmez, devir.
//  · 19: daire alt kotası — bir dairenin taşması öteki dairelerin QR payını yemez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { suggestReply } from "@/lib/ai";
import { emailService } from "@/lib/email";
import { POST } from "@/app/api/chat/[token]/route";
import { maybeSendQrEscalationEmail, QR_CRITICAL_EMAILS_PER_HOUR } from "@/lib/guest-chat-alerts";
import { consumeDailyAiBudgetForQr } from "@/lib/ai/daily-budget";

const mockSuggest = vi.mocked(suggestReply);
const CAP_TEXT = "Şu anda çok fazla mesaj aldık. Ev sahibiniz bilgilendirildi; kısa süre sonra tekrar yazabilirsiniz.";

const reply = (text: string) => ({
  intent: "general",
  confidence: 0.95,
  reply: text,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
});

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  const res = await prisma.reservation.create({
    data: { propertyId, guestName: "Alex", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "owner@x.com", passwordHash: "x", role: "owner" } });
  return { orgId, propertyId, token, reservationId: res.id };
}

let ipSeq = 0;
function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipSeq % 250}` };
  if (cookie) headers.cookie = cookie;
  return POST(new Request(`http://localhost/api/chat/${token}`, { method: "POST", headers, body: JSON.stringify({ message }) }) as never, {
    params: Promise.resolve({ token }),
  } as never);
}
const deviceCookie = (res: Response) => res.headers.get("set-cookie")?.split(";")[0];
const setStayCounter = (reservationId: string, count: number) =>
  prisma.rateLimitCounter.create({ data: { key: `guestchat-stay:${reservationId}`, count, resetAt: new Date(Date.now() + 3_600_000) } });

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  mockSuggest.mockReset();
  vi.mocked(emailService.sendReporting).mockClear();
  vi.stubEnv("GUEST_CHAT_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("15 — konaklama başına saatte 40 mesaj", () => {
  it("🚨 41. mesaj: 429 + onaylı metin AYNEN, model çağrılmaz, mesaj KAYDEDİLMEZ; ev sahibine TEK kayıt (ikinci aşım yazmaz)", async () => {
    const { token, reservationId } = await seed();
    mockSuggest.mockResolvedValue(reply("Çöp salı günü alınır."));
    const first = await ask(token, "Çöp ne zaman?");
    expect(first.status).toBe(200);
    const cookie = deviceCookie(first);
    const before = await prisma.message.count();
    await prisma.rateLimitCounter.update({ where: { key: `guestchat-stay:${reservationId}` }, data: { count: 40 } });

    mockSuggest.mockClear();
    const capped = await ask(token, "Otopark var mı?", cookie);
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: string }).error).toBe(CAP_TEXT);
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await prisma.message.count()).toBe(before);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { externalReservationId: { contains: reservationId } } });
    expect(convo.priority).toBe("urgent");
    expect(await prisma.riskEvent.count({ where: { reason: "stay_message_cap" } })).toBe(1);

    expect((await ask(token, "Havlu?", cookie)).status).toBe(429);
    expect(await prisma.riskEvent.count({ where: { reason: "stay_message_cap" } })).toBe(1);
    expect(await prisma.message.count()).toBe(before);
  });

  it("KONTROL: 40. mesaj (sayaç 39) normal işlenir — model çağrılır, mesaj kaydedilir", async () => {
    const { token, reservationId } = await seed();
    await setStayCounter(reservationId, 39);
    mockSuggest.mockResolvedValue(reply("Çöp salı günü alınır."));
    const res = await ask(token, "Çöp ne zaman?");
    expect(res.status).toBe(200);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { direction: "inbound" } })).toBe(1);
  });

  it("tavan KONAKLAMA başına: başka konaklamanın sayacı bu konaklamayı durdurmaz", async () => {
    const { token } = await seed();
    await setStayCounter("baska-konaklama", 999);
    mockSuggest.mockResolvedValue(reply("Çöp salı günü alınır."));
    expect((await ask(token, "Çöp ne zaman?")).status).toBe(200);
  });
});

describe("17 — acil e-postası konaklama başına saatte en çok 3", () => {
  it(`🚨 4 farklı acil olay → ${QR_CRITICAL_EMAILS_PER_HOUR} e-posta; dördüncüsü tavanda, sahiplenme bırakılır`, async () => {
    vi.stubEnv("QR_ESCALATION_EMAIL_ENABLED", "1");
    const { orgId, reservationId } = await seed();
    const base = { organizationId: orgId, propertyName: "Lale", reservationId, reason: "ai_escalated" as const, critical: true };
    const out = [];
    for (const id of ["crit:a", "crit:b", "crit:c", "crit:d"]) out.push(await maybeSendQrEscalationEmail({ ...base, eventId: id }));
    expect(out.map((o) => o.sent)).toEqual([true, true, true, false]);
    expect(out[3].capped).toBe(true);
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(3);
    // Tavandaki olay "gönderildi" diye işaretlenmez: sahiplenmesi bırakıldı (mevcut bırakma kuralı alanı boşaltır).
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(row.qrEscalationEmailMessageId).not.toBe("crit:d");
    expect(row.qrEscalationEmailAt).toBeNull();
  });

  it("KONTROL: tavan konaklama başına — başka konaklamanın acil e-postası gider", async () => {
    vi.stubEnv("QR_ESCALATION_EMAIL_ENABLED", "1");
    const { orgId, propertyId, reservationId } = await seed();
    const other = await prisma.reservation.create({
      data: { propertyId, guestName: "Bora", arrivalDate: daysFromNow(5), departureDate: daysFromNow(7), status: "confirmed", channel: "airbnb" },
    });
    const base = { organizationId: orgId, propertyName: "Lale", reason: "ai_escalated" as const, critical: true };
    for (const id of ["crit:a", "crit:b", "crit:c"]) await maybeSendQrEscalationEmail({ ...base, reservationId, eventId: id });
    expect((await maybeSendQrEscalationEmail({ ...base, reservationId: other.id, eventId: "crit:x" })).sent).toBe(true);
  });
});

describe("19 — daire alt kotası", () => {
  it("🚨 5 daireli işletmede bir daire QR payının eşit payının iki katını aşamaz; taşma İŞLETME QR sayacına dokunmaz, öteki daire çalışır", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "10");
    vi.stubEnv("AI_DAILY_QR_SHARE_PERCENT", "100"); // QR payı 10 → daire başına ceil(2×10/5) = 4
    const { orgId, propertyId } = await makeOrgWithProperty();
    const others = [];
    for (let i = 0; i < 4; i++) others.push(await prisma.property.create({ data: { organizationId: orgId, name: `D${i}` } }));
    for (let i = 0; i < 4; i++) expect((await consumeDailyAiBudgetForQr(orgId, propertyId)).ok, `çağrı ${i + 1}`).toBe(true);
    const fifth = await consumeDailyAiBudgetForQr(orgId, propertyId);
    expect(fifth.ok).toBe(false);
    expect(fifth.cap).toBe(4);
    const qrCounter = await prisma.rateLimitCounter.findUnique({ where: { key: `ai-daily-qr:${orgId}` } });
    expect(qrCounter?.count).toBe(4);
    expect((await consumeDailyAiBudgetForQr(orgId, others[0].id)).ok).toBe(true);
  });

  it("KONTROL: iki daireli işletmede alt kota YOK (eşit payın iki katı = payın tamamı)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "10");
    vi.stubEnv("AI_DAILY_QR_SHARE_PERCENT", "100");
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.create({ data: { organizationId: orgId, name: "D2" } });
    for (let i = 0; i < 10; i++) expect((await consumeDailyAiBudgetForQr(orgId, propertyId)).ok, `çağrı ${i + 1}`).toBe(true);
    expect(await prisma.rateLimitCounter.findUnique({ where: { key: `ai-daily-qr-prop:${propertyId}` } })).toBeNull();
  });
});

describe("18 — cevapta kapı kodu: bir kez yeniden yaz, sonra devir", () => {
  it("🚨 ilk taslak kapı kodlu, ikincisi temiz → temiz cevap gider; ikinci çağrı kuralı NOT olarak alır; kod hiçbir yere yazılmaz", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValueOnce(reply("Kapı kodunuz 4590, iyi konaklamalar.")).mockResolvedValueOnce(reply("Çöp salı günü alınır."));
    const res = await ask(token, "Kapı kodu neydi, çöp ne zaman?");
    expect(res.status).toBe(200);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    const notes = (mockSuggest.mock.calls[1][0] as { knowledgeBaseNotes?: string[] }).knowledgeBaseNotes ?? [];
    expect(notes.some((n) => /kod/i.test(n) && /ASLA/.test(n))).toBe(true);
    expect(JSON.stringify(await res.json())).not.toContain("4590");
    expect((await prisma.message.findMany({ select: { body: true } })).map((m) => m.body).join("\n")).not.toContain("4590");
    expect(await prisma.riskEvent.count({ where: { reason: "door_code_in_reply" } })).toBe(0);
  });

  it("🚨 iki taslak da kapı kodlu → cevap GİTMEZ, devir (door_code_in_reply); kod saklanmaz", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(reply("Kapı kodunuz 4590."));
    const res = await ask(token, "Kapı kodu neydi?");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { escalated?: boolean; reply?: string | null };
    expect(body.escalated).toBe(true);
    expect(JSON.stringify(body)).not.toContain("4590");
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(await prisma.riskEvent.count({ where: { reason: "door_code_in_reply" } })).toBe(1);
    expect((await prisma.message.findMany({ select: { body: true } })).map((m) => m.body).join("\n")).not.toContain("4590");
  });

  it("KONTROL: Wi-Fi şifresi içeren cevap yeniden YAZDIRILMAZ (Wi-Fi verilir — kurucu kararı 10-11)", async () => {
    const { token, propertyId } = await seed();
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ LaleNet, şifre gunes1907" } });
    mockSuggest.mockResolvedValue(reply("Wi-Fi ağı LaleNet, şifresi gunes1907."));
    const res = await ask(token, "Wifi şifresi ne?");
    expect(res.status).toBe(200);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const kbSent = (mockSuggest.mock.calls[0][0] as { knowledgeBase: { content: string }[] }).knowledgeBase.map((k) => k.content).join("\n");
    expect(kbSent).toContain("gunes1907"); // Wi-Fi kalemi modele GİDER
  });
});
