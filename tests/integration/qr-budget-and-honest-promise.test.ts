import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// QR CONCIERGE — İKİ BULGU (derin denetim, 2026-08-01 — YÜKSEK).
//
// (15) ORG GÜNLÜK AI BÜTÇESİNİN TAMAMEN DIŞINDAYDI. `suggestReply` çağıran 8
//      yerden 7'si org bütçesini tüketiyordu; QR TEK istisnaydı — ve aynı
//      zamanda kimlik doğrulaması OLMAYAN tek AI yüzeyi. Tek tavanı DAİRE
//      başınaydı (50/100/200) → 25 daireli bir İşletme müşterisinde 25 × 200 =
//      5.000 model çağrısı, oysa aynı planın org tavanı 1.500. `daily-budget.ts`
//      kendi gerekçesini yazıyor: "sayaç ORG başınadır; üye ekleyerek tavanı
//      çoğaltmak mümkün olmamalı" — daire-başına delinmişti.
//
// (16) MİSAFİRE VERİLEN SÖZ KOŞULSUZ "EV SAHİBİNE İLETTİM"di. Host'a giden TEK
//      push kanalı `QR_ESCALATION_EMAIL_ENABLED` ve VARSAYILAN KAPALI; ikinci
//      kanal da yok (QR konuşması bilerek "answered" doğar, panelin dikkat
//      listesi new/waiting/problem süzer). Yani varsayılan kurulumda misafir
//      "yardım yolda" sanıyor, ev sahibi hiçbir şey duymuyordu — güvenlik acili
//      dahil. Bayrak ÜRÜN KARARIYLA kapalı; burada açılmıyor, metin gerçeğe
//      uyduruluyor.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);

const benign = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Çöp kutusu girişin solunda.",
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
};

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Alex",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  return { orgId, token, propertyId };
}

function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "1.2.3.4",
  };
  // Konaklama başına cihaz bağlama: ilk istek çerezi kurar, sonrakiler taşımalı.
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) } as never);
}

/** Sunucunun kurduğu cihaz çerezi, istek başlığı biçiminde. */
function deviceCookie(res: Response): string | undefined {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : undefined;
}

describe("QR concierge — org bütçesi ve dürüst söz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(benign);
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("org günlük AI tavanı dolunca MODEL ÇAĞRILMAZ ve misafir devir cevabı alır", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1"); // tek çağrılık tavan
    const { token } = await seed();

    const first = await ask(token, "Çöp nereye atılıyor?");
    expect(first.status).toBe(200);
    expect(mockSuggest).toHaveBeenCalledTimes(1);

    const second = await ask(token, "Otopark var mı?", deviceCookie(first));
    expect(second.status).toBe(200);
    // ⬅️ ARIZADA 2 olurdu: QR bütçenin tamamen dışındaydı.
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const body = await second.json();
    expect(body.escalated).toBe(true);
  });

  it("tavan dolunca konuşma yine kaydedilir (misafir mesajı kaybolmaz)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    const { token, propertyId } = await seed();
    const first = await ask(token, "Çöp nereye atılıyor?");
    await ask(token, "Otopark var mı?", deviceCookie(first));

    const msgs = await prisma.message.findMany({
      where: { conversation: { propertyId } },
      orderBy: { createdAt: "asc" },
      select: { direction: true, body: true },
    });
    expect(msgs.filter((m) => m.direction === "inbound").map((m) => m.body)).toContain(
      "Otopark var mı?",
    );
  });

  it("bütçe İÇİNDEYKEN normal yanıtlanır (regresyon pini)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "100");
    const { token } = await seed();
    const res = await ask(token, "Çöp nereye atılıyor?");
    const body = await res.json();
    expect(body.escalated).toBeFalsy();
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("uyarı bayrağı KAPALIYKEN misafire 'ilettim' DENMEZ (yanlış beyan yok)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    // QR_ESCALATION_EMAIL_ENABLED set edilmedi → varsayılan KAPALI.
    const { token } = await seed();
    const first = await ask(token, "Çöp nereye atılıyor?");
    const res = await ask(token, "Otopark var mı?", deviceCookie(first));
    const body = await res.json();

    expect(body.reply).not.toContain("ilettim");
    expect(body.reply).toContain("kaydedildi");
  });

  it("🚨 uyarı bayrağı AÇIKKEN DE 'ilettim' DENMEZ (Codex 09-08: bayrak ≠ gönderim garantisi)", async () => {
    // ESKİ BEKLENTİ `toContain("ilettim")` İDİ ve yanlış beyanı pinliyordu.
    // Bayrağın açık olması e-postanın GİTTİĞİ anlamına gelmez: olay-kimliği
    // dedupe, 5 dk anti-flood cooldown, alıcı yokluğu (org alertEmail + owner
    // boş) ve sağlayıcı hatası dallarının hepsi sessizce `{sent:false}` döner.
    // Üstelik yanıt metni kayıt transaction'ında, e-posta çağrısından ÖNCE
    // yazılır ve `sendQrEscalationAlertBounded` `Promise<void>` — sonuç hiç
    // okunmaz. Canlı transkriptte (09-08) dört ardışık devirde dördü de
    // "ilettim" dedi; cooldown yüzünden en fazla biri mail üretmiş olabilir.
    // Sözleşme: metin YALNIZ garanti edileni söyler.
    vi.stubEnv("AI_DAILY_CALL_CAP", "1");
    vi.stubEnv("QR_ESCALATION_EMAIL_ENABLED", "1");
    const { token } = await seed();
    const first = await ask(token, "Çöp nereye atılıyor?");
    const res = await ask(token, "Otopark var mı?", deviceCookie(first));
    const body = await res.json();

    expect(body.reply).not.toMatch(/ilettim/i);
    expect(body.reply).toContain("kaydedildi");
    expect(body.reply).toMatch(/sohbet ekranından/i);
  });

  it("güvenlik eskalasyonunda da söz bayrağa göre dürüst (bayrak KAPALI)", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "100");
    const { token } = await seed();
    const res = await ask(token, "Daireden gaz kokusu geliyor!");
    const body = await res.json();

    expect(body.escalated).toBe(true);
    expect(body.reply).not.toContain("ilettim");
    expect(body.reply).toContain("kaydedildi");
  });
});
