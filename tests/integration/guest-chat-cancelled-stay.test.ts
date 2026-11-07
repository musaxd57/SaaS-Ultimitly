import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// İPTAL EDİLMİŞ KONAKLAMADA QR (kurucu 10-12): "Modele rezervasyonun durumunu ver; iptal edilmişse AI yanıtlamasın ve hosta söylesin
// rezervasyon iptal edilmiş; gene de yazarsa kötü niyetli şekilde AI cevap vermesin, AI kullanım hakkından da yemesin, hosta bildirsin."
// Karar KODDA, modelden önce: iptal edilmiş konaklamada model HİÇ çağrılmaz (kota düşmez), yazana genel "sohbet kapalı" cevabı gider
// (iptal bilgisi verilmez — QR'ı tarayan rezervasyon sahibi olmayabilir), mesaj panelde ev sahibi için kaydedilir, ev sahibine
// "iptal edilmiş rezervasyon" uyarısı gider (6 saatte en çok bir), kayıt saatte en çok 10 mesaj.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => {}),
}));

import { suggestReply } from "@/lib/ai";
import { emailService } from "@/lib/email";
import { POST } from "@/app/api/chat/[token]/route";
import { CANCELLED_STAY_MESSAGES_PER_HOUR, __drainDetachedForTest, cancelledStayMailKey } from "@/lib/guest-chat-alerts";
import { ANON_NAME } from "@/lib/anon-sentinels";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);
const CLOSED = "Şu an bu daire için aktif bir konaklama görünmüyor; sohbet kapalı. Bir konaklamanız varsa lütfen giriş gününüzde tekrar deneyin.";

/** İstek + yanıttan SONRA yürüyen kayıt işinin bitmesi (yanıt o işi beklemez — süre farkı sızmasın). */
async function call(token: string, message: string, requestId?: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
    body: JSON.stringify({ message, ...(requestId ? { requestId } : {}) }),
  });
  const res = await POST(req as never, { params: Promise.resolve({ token }) });
  await __drainDetachedForTest();
  return res;
}

async function fixture(status: "cancelled" | "confirmed" | "pending", guestName = "İptalci Misafir", arrivalInDays = -1) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName, arrivalDate: daysFromNow(arrivalInDays), departureDate: daysFromNow(arrivalInDays + 3), status, channel: "airbnb" },
  });
  return { orgId, propertyId, token, reservationId: reservation.id };
}

const qrMessages = (propertyId: string) =>
  prisma.message.findMany({ where: { conversation: { propertyId } }, orderBy: { createdAt: "asc" }, select: { body: true, direction: true } });

const ENV = ["GUEST_CHAT_ENABLED", "QR_ESCALATION_EMAIL_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  for (const k of ENV) saved[k] = process.env[k];
  process.env.GUEST_CHAT_ENABLED = "1";
  process.env.QR_ESCALATION_EMAIL_ENABLED = "1";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("🚨 iptal edilmiş konaklamada QR — yapay zekâ cevap vermez, kota düşmez, ev sahibine bildirim", () => {
  it("yazana genel 'sohbet kapalı' (iptal söylenmez); model ÇAĞRILMAZ; mesaj panelde acil kaydedilir; ev sahibine uyarı", async () => {
    const f = await fixture("cancelled");
    const res = await call(f.token, "Kapı kodu ne, içerideyim");
    const body = await res.json();
    expect(body).toEqual({ closed: true, reply: CLOSED });
    expect(JSON.stringify(body)).not.toMatch(/iptal|cancel/i);
    expect(mockSuggest).not.toHaveBeenCalled();

    expect(await qrMessages(f.propertyId)).toEqual([{ body: "Kapı kodu ne, içerideyim", direction: "inbound" }]);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { propertyId: f.propertyId } });
    expect(convo).toMatchObject({ reservationId: f.reservationId, priority: "urgent" });

    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(String(mockMail.mock.calls[0][2])).toContain("İPTAL EDİLMİŞ");
  });

  it("gene de yazarsa: model yine çağrılmaz, mesajlar kaydedilir, e-posta 6 saat içinde TEKRARLANMAZ; kayıt saatte tavanla sınırlı", async () => {
    const f = await fixture("cancelled");
    for (let i = 0; i < CANCELLED_STAY_MESSAGES_PER_HOUR + 3; i++) {
      expect((await (await call(f.token, `mesaj ${i}`)).json()).closed).toBe(true);
    }
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(await qrMessages(f.propertyId)).toHaveLength(CANCELLED_STAY_MESSAGES_PER_HOUR);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("e-posta 6 saatlik pencerede bir kez: 5 dakikalık bekleme geçse de aynı pencerede ikinci e-posta yok; yeni pencerede yeniden uyarır", async () => {
    const f = await fixture("cancelled");
    await call(f.token, "ilk");
    expect(mockMail).toHaveBeenCalledTimes(1);
    // Kısa bekleme (5 dk) geçti, aynı 6 saatlik pencere → yine yok.
    await prisma.reservation.update({ where: { id: f.reservationId }, data: { qrEscalationEmailAt: new Date(Date.now() - 10 * 60_000) } });
    await call(f.token, "ikinci");
    expect(mockMail).toHaveBeenCalledTimes(1);
    // Kayan 6 saat doldu (sayaç satırı süresi geçti) → yeniden uyarır.
    await prisma.rateLimitCounter.deleteMany({ where: { key: cancelledStayMailKey(f.reservationId) } });
    await call(f.token, "üçüncü");
    expect(mockMail).toHaveBeenCalledTimes(2);
  });

  it("KONTROL: şu anı KAPSAMAYAN iptal kaydı (yarın başlayan) ve onaylanmamış talep (pending) → kayıt yok, uyarı yok", async () => {
    const tomorrow = await fixture("cancelled", "Yarınki", 1);
    expect((await (await call(tomorrow.token, "merhaba")).json()).closed).toBe(true);
    expect(await qrMessages(tomorrow.propertyId)).toEqual([]);
    const pending = await fixture("pending", "Talep");
    expect((await (await call(pending.token, "merhaba")).json()).closed).toBe(true);
    expect(await qrMessages(pending.propertyId)).toEqual([]);
    expect(mockMail).not.toHaveBeenCalled();
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("🚨 devir günü: iptal A çıkış sabahı + onaylı B öğleden sonra giriş (henüz açık değil) → B'nin erken mesajı A'nın iptal sohbetine DÜŞMEZ, uyarı yok", async () => {
    const f = await fixture("cancelled", "İptal A", -2); // A: dün-önceki gün giriş, ileride çıkış — şu an pencerede
    await prisma.reservation.create({
      data: { propertyId: f.propertyId, guestName: "Onaylı B", arrivalDate: daysFromNow(1), departureDate: daysFromNow(4), status: "confirmed", channel: "airbnb" },
    });
    expect((await (await call(f.token, "Erken geldik, kapı kodu ne?")).json()).closed).toBe(true);
    expect(await qrMessages(f.propertyId)).toEqual([]);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("aynı istek kimliğiyle yeniden deneme (bağlantı koptu) ikinci kez KAYDEDİLMEZ", async () => {
    const f = await fixture("cancelled");
    await call(f.token, "merhaba", "req-cancel-0001");
    await call(f.token, "merhaba", "req-cancel-0001");
    expect(await qrMessages(f.propertyId)).toHaveLength(1);
    await call(f.token, "ikinci mesaj", "req-cancel-0002");
    expect(await qrMessages(f.propertyId)).toHaveLength(2);
  });

  it("KONTROL: onaylı (iptal edilmemiş) konaklama bugünkü gibi — model çağrılır; iptal uyarısı yok", async () => {
    const f = await fixture("confirmed");
    mockSuggest.mockResolvedValue({
      intent: "general",
      confidence: 0.9,
      reply: "Çöp salı günü toplanır.",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
    } as never);
    const body = await (await call(f.token, "Çöp ne zaman toplanıyor?")).json();
    expect(body.closed).toBeUndefined();
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("KONTROL: hiç konaklama yokken (boş daire) yazılan mesaj KAYDEDİLMEZ, uyarı yok (bugünkü davranış)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
    expect((await (await call(token, "merhaba")).json()).closed).toBe(true);
    expect(await qrMessages(propertyId)).toEqual([]);
    expect(mockMail).not.toHaveBeenCalled();
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("🚨 KVKK: silinmiş (anonimleştirilmiş) iptal kaydı geri doğmaz — mesaj kaydedilmez, uyarı yok", async () => {
    const f = await fixture("cancelled", ANON_NAME); // silme / saklama süresi sonrası maskeleme sentinel'i
    expect((await (await call(f.token, "merhaba")).json()).closed).toBe(true);
    expect(await qrMessages(f.propertyId)).toEqual([]);
    expect(mockMail).not.toHaveBeenCalled();
  });
});
