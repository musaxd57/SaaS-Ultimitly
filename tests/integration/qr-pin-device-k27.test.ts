import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken, qrWifiDeviceVerified } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// K27-K10 (Codex 11-25 ikinci rapor, "öncelikli güvenlik bulgusu"): QR sohbetinde PIN politikası ile cihaz yetkisi.
// Gerçek rota + gerçek PostgreSQL; yalnız model ve e-posta taklit.
//  Kurucu kararı 11-25 gece: "Yeniden PIN sorulsun" — kod değişince de, kod sonradan zorunlu olunca da eski telefon güncel kodu girer.
//  (a) Ev sahibi sohbet kodunu OLUŞTURUNCA / YENİLEYİNCE bağlı cihaz düşer — güncel kodu girmeden okuyamaz / yazamaz.
//      Kodu KALDIRMAK (gevşetme) bağı düşürmez.
//  (b) İşletme "sohbet kodu iste"yi AÇINCA güncel kodla bağlanmamış cihazlar düşer (yalnız o işletme; kodla bağlanmış cihaz kalır).
//  (c) Wi-Fi kalemi modele yalnız BU konaklamanın GÜNCEL koduyla bağlanmış cihazın sohbetinde girer (derin savunma: bağ silinmeden
//      kalan yol — `QR_PIN_ENABLED` sonradan açıldı — yine Wi-Fi almaz).
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { suggestReply } from "@/lib/ai";
import { setReservationPin, clearReservationPin } from "@/lib/guest-chat-pin";
import { GET, POST } from "@/app/api/chat/[token]/route";
import { PATCH as settingsPatch } from "@/app/api/settings/route";
import type { SessionPayload } from "@/lib/auth";

const mockSuggest = vi.mocked(suggestReply);

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

const WIFI_SECRET = "gunes1907";

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  const res = await prisma.reservation.create({
    data: { propertyId, guestName: "Alex", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  const owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: `owner-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 };
  await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: `Ağ LaleNet, şifre ${WIFI_SECRET}` } });
  await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "faq", title: "Çöp", content: "Çöp salı günü alınır." } });
  return { orgId, propertyId, token, reservationId: res.id };
}

let ipSeq = 0;
function post(token: string, payload: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.${++ipSeq % 250}.1` };
  if (cookie) headers.cookie = cookie;
  return POST(new Request(`http://localhost/api/chat/${token}`, { method: "POST", headers, body: JSON.stringify(payload) }) as never, {
    params: Promise.resolve({ token }),
  } as never);
}
function get(token: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.${++ipSeq % 250}.1` };
  if (cookie) headers.cookie = cookie;
  return GET(new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers }) as never, {
    params: Promise.resolve({ token }),
  } as never);
}
const deviceCookie = (res: Response) => res.headers.get("set-cookie")?.split(";")[0];

/** Modele giden bilgi tabanı metni (son çağrı). */
function kbSentToModel(): string {
  const calls = mockSuggest.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][0] as { knowledgeBase: { content: string }[] }).knowledgeBase.map((k) => k.content).join("\n");
}

/** Kodla bağlan: kodu gir, çerezi al. */
async function unlockWith(token: string, pin: string): Promise<string> {
  const res = await post(token, { pin });
  expect(((await res.json()) as { unlocked?: boolean }).unlocked).toBe(true);
  const cookie = deviceCookie(res);
  expect(cookie).toBeTruthy();
  return cookie!;
}

/** Kodsuz (ilk tarayan) bağlan: QR_PIN kapısı bu konaklamada istenmiyorken ilk GET cihazı bağlar. */
async function firstScanBind(token: string): Promise<string> {
  const res = await get(token);
  const body = (await res.json()) as { open?: boolean; pinRequired?: boolean };
  expect(body.open).toBe(true);
  expect(body.pinRequired).toBeUndefined();
  const cookie = deviceCookie(res);
  expect(cookie).toBeTruthy();
  return cookie!;
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  mockSuggest.mockReset();
  mockSuggest.mockResolvedValue(reply("Bu konuda size hemen dönüyoruz."));
  vi.stubEnv("GUEST_CHAT_ENABLED", "1");
  vi.stubEnv("QR_PIN_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("K10 (a) — kodu yenilemek eski kodla bağlanmış cihazı düşürür", () => {
  it("🚨 yenilemeden sonra eski cihaz GET'te kod ekranını görür, mesaj atamaz (model çağrılmaz); yeni kodla yeniden bağlanır", async () => {
    const { token, reservationId } = await seed();
    const oldPin = await setReservationPin(reservationId);
    const cookie = await unlockWith(token, oldPin);
    // Bağlı cihaz sohbeti görüyor (kontrol).
    expect(((await (await get(token, cookie)).json()) as { messages?: unknown[] }).messages).toBeDefined();

    const newPin = await setReservationPin(reservationId);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true, chatBoundAt: true } });
    expect(row?.chatBoundHash).toBeNull();
    expect(row?.chatBoundAt).toBeNull();

    const g = (await (await get(token, cookie)).json()) as { pinRequired?: boolean; messages?: unknown[] };
    expect(g.pinRequired).toBe(true);
    expect(g.messages).toEqual([]);

    const p = (await (await post(token, { message: "Wifi şifresi ne?" }, cookie)).json()) as { pinRequired?: boolean };
    expect(p.pinRequired).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();

    // Aynı cihaz eski kodla açamaz, yeni kodla açar.
    expect(((await (await post(token, { pin: oldPin }, cookie)).json()) as { pinError?: boolean }).pinError).toBe(true);
    const again = await unlockWith(token, newPin);
    await post(token, { message: "Wifi şifresi ne?" }, again);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(kbSentToModel()).toContain(WIFI_SECRET);
  });

  it("KONTROL: kodu KALDIRMAK bağı düşürmez (gevşetme; işletme 'kod iste' kapalıyken bağlı cihaz sürer)", async () => {
    const { token, reservationId } = await seed();
    const pin = await setReservationPin(reservationId);
    const cookie = await unlockWith(token, pin);
    await clearReservationPin(reservationId);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true } });
    expect(row?.chatBoundHash).not.toBeNull();
    const g = (await (await get(token, cookie)).json()) as { pinRequired?: boolean; boundElsewhere?: boolean };
    expect(g.pinRequired).toBeUndefined();
    expect(g.boundElsewhere).toBeUndefined();
  });

  it("🚨 konaklamaya İLK kez kod vermek de kodsuz bağlanmış cihazı düşürür; güncel kodu girince Wi-Fi alır", async () => {
    const { token, reservationId } = await seed();
    const cookie = await firstScanBind(token);
    const pin = await setReservationPin(reservationId);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true } });
    expect(row?.chatBoundHash).toBeNull();
    const g = (await (await get(token, cookie)).json()) as { pinRequired?: boolean; messages?: unknown[] };
    expect(g.pinRequired).toBe(true);
    expect(g.messages).toEqual([]);
    expect(((await (await post(token, { message: "Wifi şifresi ne?" }, cookie)).json()) as { pinRequired?: boolean }).pinRequired).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    const again = await unlockWith(token, pin);
    await post(token, { message: "Wifi şifresi ne?" }, again);
    expect(kbSentToModel()).toContain(WIFI_SECRET);
  });
});

function patchSettings(body: Record<string, unknown>) {
  return settingsPatch(
    new NextRequest("http://localhost/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) } as never,
  );
}

describe("K10 (b) — 'sohbet kodu iste' açılınca güncel kodla bağlanmamış cihaz düşer", () => {
  it("🚨 kodsuz bağlanmış cihaz (konaklamada kod YOK): kod ekranı; kod oluşturulup girilince Wi-Fi", async () => {
    const { token, reservationId } = await seed();
    const cookie = await firstScanBind(token);
    expect((await patchSettings({ qrChatPinRequired: true })).status).toBe(200);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true } }))?.chatBoundHash).toBeNull();
    const g = (await (await get(token, cookie)).json()) as { pinRequired?: boolean; messages?: unknown[] };
    expect(g.pinRequired).toBe(true);
    expect(g.messages).toEqual([]);
    expect(((await (await post(token, { message: "Wifi şifresi ne?" }, cookie)).json()) as { pinRequired?: boolean }).pinRequired).toBe(true);
    expect(mockSuggest).not.toHaveBeenCalled();
    const pin = await setReservationPin(reservationId);
    const again = await unlockWith(token, pin);
    await post(token, { message: "Wifi şifresi ne?" }, again);
    expect(kbSentToModel()).toContain(WIFI_SECRET);
  });

  it("🚨 koddan ÖNCE bağlanmış cihaz (bağ anı < kod anı; eski sürümden kalan) düşer", async () => {
    const { token, reservationId } = await seed();
    await firstScanBind(token);
    // Eski sürüm kod verince bağı silmiyordu: o durumu doğrudan kur (kod anı bağdan sonra, bağ yerinde).
    const at = (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { chatBoundAt: true } })).chatBoundAt!;
    await prisma.reservation.update({ where: { id: reservationId }, data: { chatPinHash: "f".repeat(64), chatPinSetAt: new Date(at.getTime() + 1_000) } });
    expect((await patchSettings({ qrChatPinRequired: true })).status).toBe(200);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true } }))?.chatBoundHash).toBeNull();
  });

  it("KONTROL: güncel kodla bağlanmış cihaz DÜŞMEZ; başka işletmenin kodsuz bağı DÜŞMEZ; özellik kapalıyken bağa dokunulmaz", async () => {
    const a = await seed();
    const b = await seed(); // `session` artık b'nin sahibi
    const pinB = await setReservationPin(b.reservationId);
    const cookieB = await unlockWith(b.token, pinB);
    await firstScanBind(a.token);
    const boundA = async () => (await prisma.reservation.findUnique({ where: { id: a.reservationId }, select: { chatBoundHash: true } }))?.chatBoundHash;

    // b'de ikinci, kodsuz bağlanmış konaklama (aynı işletme, başka daire): özellik kapalıyken kalır, açıkken düşer.
    const b2prop = await prisma.property.create({ data: { organizationId: b.orgId, name: "Lale 2" } });
    const b2token = generateChatToken();
    await prisma.property.update({ where: { id: b2prop.id }, data: { chatToken: b2token, chatEnabled: true } });
    const b2 = await prisma.reservation.create({
      data: { propertyId: b2prop.id, guestName: "Deniz", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });
    await firstScanBind(b2token);
    const boundB2 = async () => (await prisma.reservation.findUnique({ where: { id: b2.id }, select: { chatBoundHash: true } }))?.chatBoundHash;

    // Özellik kapalı: b işletmesinde ayar açılır, hiçbir bağ silinmez.
    vi.stubEnv("QR_PIN_ENABLED", "");
    expect((await patchSettings({ qrChatPinRequired: true })).status).toBe(200);
    vi.stubEnv("QR_PIN_ENABLED", "1");
    expect(await boundA()).not.toBeNull();
    expect(await boundB2()).not.toBeNull();

    // Özellik açık: b işletmesinde ayar yeniden kaydedilir → b'nin kodsuz bağı düşer, kodla bağlı cihazı kalır; a (başka işletme) kalır.
    expect((await patchSettings({ qrChatPinRequired: true })).status).toBe(200);
    expect(await boundB2()).toBeNull();
    expect(await boundA()).not.toBeNull();
    const gB = (await (await get(b.token, cookieB)).json()) as { pinRequired?: boolean; messages?: unknown[] };
    expect(gB.pinRequired).toBeUndefined();
    expect(gB.messages).toBeDefined();
    expect((await prisma.organization.findUnique({ where: { id: b.orgId } }))?.qrChatPinRequired).toBe(true);
    expect((await prisma.organization.findUnique({ where: { id: a.orgId } }))?.qrChatPinRequired).toBe(false);
  });

  it("KONTROL: 'kod iste' KAPATMAK bağa dokunmaz", async () => {
    const { token, reservationId } = await seed();
    await firstScanBind(token);
    expect((await patchSettings({ qrChatPinRequired: false })).status).toBe(200);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId }, select: { chatBoundHash: true } }))?.chatBoundHash).not.toBeNull();
  });
});

describe("K10 (c) — Wi-Fi yalnız güncel kodla bağlanmış cihaza", () => {
  it("KONTROL: kodla bağlanan cihazın sohbetinde Wi-Fi modele gider", async () => {
    const { token, reservationId } = await seed();
    const pin = await setReservationPin(reservationId);
    const cookie = await unlockWith(token, pin);
    await post(token, { message: "Wifi şifresi ne?" }, cookie);
    expect(kbSentToModel()).toContain(WIFI_SECRET);
  });

  it("🚨 derin savunma: 'kod iste' kod özelliği KAPALIYKEN açıldı (bağ silinmedi), özellik sonra açıldı → eski cihaz Wi-Fi ALMAZ", async () => {
    const { token } = await seed();
    const cookie = await firstScanBind(token);
    vi.stubEnv("QR_PIN_ENABLED", "");
    expect((await patchSettings({ qrChatPinRequired: true })).status).toBe(200);
    vi.stubEnv("QR_PIN_ENABLED", "1");
    // Bilinen sınır (açılış belgesine not önerisi, `docs/INCELEME-2026-11-25-k27-C1.md`): bağ kod özelliği kapalıyken kaldı, cihaz sohbete
    // devam eder — ama Wi-Fi ondan esirgenir.
    await post(token, { message: "Wifi şifresi ne?" }, cookie);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    const kb = kbSentToModel();
    expect(kb).not.toContain(WIFI_SECRET);
    expect(kb).toContain("Çöp salı günü");
  });
});

describe("K10 (c) — qrWifiDeviceVerified (saf karar)", () => {
  const t0 = new Date("2026-01-10T12:00:00Z");
  const after = new Date(t0.getTime() + 60_000);
  const before = new Date(t0.getTime() - 60_000);
  const base = { chatPinHash: "h", chatPinSetAt: t0, chatBoundHash: "b", chatBoundAt: after };

  it("güncel kodla (koddan sonra) bağlanmış cihaz → evet; eşit an → evet", () => {
    expect(qrWifiDeviceVerified(base, true)).toBe(true);
    expect(qrWifiDeviceVerified({ ...base, chatBoundAt: t0 }, true)).toBe(true);
  });
  it("kod istenmiyor / kod yok / kod anı yok / bağ yok / bağ anı yok / bağ koddan önce → hayır", () => {
    expect(qrWifiDeviceVerified(base, false)).toBe(false);
    expect(qrWifiDeviceVerified({ ...base, chatPinHash: null }, true)).toBe(false);
    expect(qrWifiDeviceVerified({ ...base, chatPinSetAt: null }, true)).toBe(false);
    expect(qrWifiDeviceVerified({ ...base, chatBoundHash: null }, true)).toBe(false);
    expect(qrWifiDeviceVerified({ ...base, chatBoundAt: null }, true)).toBe(false);
    expect(qrWifiDeviceVerified({ ...base, chatBoundAt: before }, true)).toBe(false);
  });
});
