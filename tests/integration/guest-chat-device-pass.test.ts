import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import { splitStayCookie, stayCookieValue } from "@/lib/guest-chat-pass";
import type { SuggestReplyResult } from "@/lib/ai/types";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { suggestReply } from "@/lib/ai";
import { GET, POST } from "@/app/api/chat/[token]/route";

// ---------------------------------------------------------------------------
// 🚨 K-5 (kurucu / Codex 11-06): İMZALI CİHAZ GEÇİŞİ. Eskiden: aynı IP'den dakikada 240+ istek (bina Wi-Fi'si) kaba IP tavanını doldurunca
// o IP'deki bağlı misafirin sohbeti de donuyordu (doğrulama veritabanı okuması, tavandan sonra). Şimdi: cihaz çerezindeki imzalı geçiş
// veritabanına gitmeden doğrulanır, istek cihazın kendi kovasına gider. Geçiş ERİŞİM VERMEZ; süresi dolmuş, başka anahtara ait ya da bağı
// sıfırlanmış geçiş bir şey kazandırmaz (istek kaba tavandan da geçer).
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;
const FLOOD_IP = "203.0.113.60";

function get(token: string, ip: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return GET(new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers }) as never, { params: Promise.resolve({ token }) });
}
function post(token: string, ip: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return POST(new Request(`http://localhost/api/chat/${token}`, { method: "POST", headers, body: JSON.stringify({ message }) }) as never, {
    params: Promise.resolve({ token }),
  });
}
/** Yanıtın kurduğu cihaz çerezi ("ad=değer"). */
const setCookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? null;
const nameOf = (cookie: string) => cookie.slice(0, cookie.indexOf("="));
const valueOf = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);

async function chatProperty(orgId: string, n: number) {
  const token = generateChatToken();
  const property = await prisma.property.create({ data: { organizationId: orgId, name: `Lale ${n}`, chatToken: token, chatEnabled: true } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return { token, propertyId: property.id, reservationId: reservation.id };
}

/** Kaba IP tavanını (240/dk) geçersiz anahtarlarla doldurur — gerçek saldırı yolu. */
async function floodGet(ip: string) {
  for (let i = 0; i < 240; i++) await get(`yok${i}`.padEnd(64, "x"), ip);
  expect((await get("yok-son".padEnd(64, "x"), ip)).status).toBe(429);
}

function reply(): SuggestReplyResult {
  return {
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
  };
}

describe("QR sohbeti — imzalı cihaz geçişi (K-5)", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    process.env.GUEST_CHAT_ENABLED = "1";
    orgId = (await makeOrgWithProperty()).orgId;
    vi.mocked(suggestReply).mockResolvedValue(reply());
  });
  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("bağlanınca çerez = sır + imzalı geçiş; geçişli çerez sonraki yanıtlarda YENİDEN yazılmaz", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await get(token, "198.51.100.1"))!;
    expect(valueOf(cookie).split(".")).toHaveLength(3);
    const again = await get(token, "198.51.100.1", cookie);
    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("🚨 aynı IP'den sel kaba tavanı doldurdu: geçişli bağlı cihaz sohbetini GÖRMEYE devam eder; geçişsiz (eski biçim) aynı cihaz 429", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await post(token, FLOOD_IP, "Çöp ne zaman?"))!;
    await floodGet(FLOOD_IP);
    const withPass = await get(token, FLOOD_IP, cookie);
    expect(withPass.status).toBe(200);
    const body = await withPass.json();
    expect(body.boundElsewhere).toBeUndefined();
    expect(body.messages.map((m: { text: string }) => m.text)).toContain("Çöp ne zaman?");
    const legacy = `${nameOf(cookie)}=${splitStayCookie(valueOf(cookie)).secret}`;
    expect((await get(token, FLOOD_IP, legacy)).status).toBe(429);
  }, 120_000);

  it("🚨 mesaj gönderme: aynı IP'den sel IP kovasını (20/dk) doldurdu; geçişli bağlı cihaz mesajını YİNE gönderir, geçişsiz 429", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await post(token, FLOOD_IP, "Merhaba"))!;
    for (let i = 0; i < 25; i++) await post(`yok${i}`.padEnd(64, "x"), FLOOD_IP, "x");
    expect((await post("yok-son".padEnd(64, "x"), FLOOD_IP, "x")).status).toBe(429);
    const ok = await post(token, FLOOD_IP, "Çöp ne zaman?", cookie);
    expect(ok.status).toBe(200);
    expect(await prisma.message.count({ where: { direction: "inbound", body: "Çöp ne zaman?" } })).toBe(1);
    const legacy = `${nameOf(cookie)}=${splitStayCookie(valueOf(cookie)).secret}`;
    expect((await post(token, FLOOD_IP, "Tekrar", legacy)).status).toBe(429);
  }, 120_000);

  it("🚨 geçiş ERİŞİM VERMEZ: geçerli geçiş BAŞKA bir sırla taşınırsa sohbet açılmaz (başka cihaz) — selde 429", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await get(token, "198.51.100.2"))!;
    const grafted = `${nameOf(cookie)}=${"0".repeat(64)}.${splitStayCookie(valueOf(cookie)).pass}`;
    const res = await get(token, "198.51.100.3", grafted);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ boundElsewhere: true, messages: [] });
    await floodGet(FLOOD_IP);
    expect((await get(token, FLOOD_IP, grafted)).status).toBe(429);
  }, 120_000);

  it("🚨 ev sahibi cihaz bağını sıfırladı: eski geçiş selde bir şey kazandırmaz (429)", async () => {
    const { token, reservationId } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await get(token, FLOOD_IP))!;
    await prisma.reservation.update({ where: { id: reservationId }, data: { chatBoundHash: null, chatBoundAt: null } });
    await floodGet(FLOOD_IP);
    expect((await get(token, FLOOD_IP, cookie)).status).toBe(429);
  }, 120_000);

  it("🚨 süresi dolmuş geçiş yok sayılır (selde 429); başka dairenin QR'ındaki geçiş bu dairede geçmez", async () => {
    const a = await chatProperty(orgId, 1);
    const b = await chatProperty(orgId, 2);
    const cookie = setCookieOf(await get(a.token, FLOOD_IP))!;
    const secret = splitStayCookie(valueOf(cookie)).secret!;
    const expired = `${nameOf(cookie)}=${stayCookieValue(secret, a.reservationId, a.token, new Date(Date.now() - 1000))}`;
    await floodGet(FLOOD_IP);
    expect((await get(a.token, FLOOD_IP, expired)).status).toBe(429);
    expect((await get(b.token, FLOOD_IP, cookie)).status).toBe(429);
    // KONTROL — geçerli geçiş kendi dairesinde selde de çalışır.
    expect((await get(a.token, FLOOD_IP, cookie)).status).toBe(200);
  }, 120_000);

  it("cihaz başı sınır TEK kova: geçişsiz (veritabanında doğrulanmış) ve geçişli istekler aynı kovayı paylaşır — 61. istek 429", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await get(token, "198.51.100.10"))!;
    const legacy = `${nameOf(cookie)}=${splitStayCookie(valueOf(cookie)).secret}`;
    for (let i = 0; i < 30; i++) expect((await get(token, `198.51.100.${20 + i}`, legacy)).status).toBe(200);
    for (let i = 0; i < 30; i++) expect((await get(token, `198.51.100.${60 + i}`, cookie)).status).toBe(200);
    expect((await get(token, "198.51.100.99", cookie)).status).toBe(429);
  }, 120_000);

  it("eski biçimli çerez bağ doğrulanınca geçişli biçime BİR KEZ yükseltilir; sır aynı kalır", async () => {
    const { token } = await chatProperty(orgId, 1);
    const cookie = setCookieOf(await get(token, "198.51.100.30"))!;
    const secret = splitStayCookie(valueOf(cookie)).secret!;
    const upgraded = setCookieOf(await get(token, "198.51.100.30", `${nameOf(cookie)}=${secret}`))!;
    expect(upgraded).not.toBeNull();
    expect(splitStayCookie(valueOf(upgraded)).secret).toBe(secret);
    expect(splitStayCookie(valueOf(upgraded)).pass).not.toBeNull();
    expect((await get(token, "198.51.100.30", upgraded)).headers.get("set-cookie")).toBeNull();
  });

  it("KONTROL — bozuk / uydurma geçişli çerezler sayaç satırı ÜRETMEZ (yalnız kaba IP kovası)", async () => {
    const before = await prisma.rateLimitCounter.count();
    for (let i = 0; i < 30; i++) {
      expect((await get(`yok${i}`.padEnd(64, "x"), "198.51.100.40", `gcs_p${i}=${"a".repeat(64)}.e30.${"b".repeat(43)}`)).status).toBe(404);
    }
    expect((await prisma.rateLimitCounter.count()) - before).toBeLessThanOrEqual(1);
  }, 120_000);
});
