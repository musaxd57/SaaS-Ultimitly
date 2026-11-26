import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { resolveGuestChat, generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
// Bilgi tabanının TEK okuyucusu sarmalanır (asıl işi yapar, çağrıyı sayar). Prisma temsilcisine casus bağlamak çağrıyı bozuyordu.
vi.mock("@/lib/ai/kb-fetch", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai/kb-fetch")>();
  return { ...mod, fetchKnowledgeBaseForPrompt: vi.fn(mod.fetchKnowledgeBaseForPrompt) };
});
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { GET } from "@/app/api/chat/[token]/route";
import { withoutRandomIds } from "../helpers/random-ids";

const kbFetch = vi.mocked(fetchKnowledgeBaseForPrompt);

// ---------------------------------------------------------------------------
// #211 (gece güvenlik turu, S3 P2-2 — kodda doğrulandı): halka açık QR sayfası (`/c/[token]`) ve istemcinin 5 sn'de bir çağırdığı GET
// ucu yalnız "sohbet açık mı / hangi konaklama" bilgisini kullanıyor, ama `resolveGuestChat` her çağrıda bilgi tabanını (200 kaleme kadar)
// çekip her kalemi İKİ KEZ tam sır taramasından geçiriyordu (6 kalıp × 3 katlama × 24k'ya kadar). Sayfa hız sınırsız → bağlantıyı bilen
// herkes veritabanı + CPU yükü doğurabiliyordu; GET açık her sohbet sekmesinde dakikada 12 kez aynı işi yapıyordu. Artık bu iki yol
// bilgi tabanısız çözümler; çıktıları birebir aynı. POST (cevap üreten yol) tam çözümlemeyi kullanmaya devam eder.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

async function enableChat(propertyId: string, withStay = true) {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  await prisma.knowledgeBaseItem.createMany({
    data: [
      { propertyId, category: "faq", title: "Çöp", content: "Çöp salı günü toplanır." },
      { propertyId, category: "general", title: "Giriş", content: "Anahtar kutusu kodu 9090." },
    ],
  });
  if (withStay) {
    await prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });
  }
  return token;
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  process.env.GUEST_CHAT_ENABLED = "1";
});
afterEach(() => kbFetch.mockClear());
afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
  else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
});

describe("resolveGuestChat — bilgi tabanısız çözümleme", () => {
  it("🚨 açık konaklamada aynı sohbet bilgisi, bilgi tabanı SORGULANMAZ", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const full = await resolveGuestChat(token);
    expect(full?.open).toBe(true);
    expect(full!.knowledgeBase.length).toBeGreaterThan(0);

    kbFetch.mockClear();
    const light = await resolveGuestChat(token, undefined, { knowledgeBase: false });
    expect(kbFetch).not.toHaveBeenCalled();
    expect(light).not.toBeNull();
    expect(light!.knowledgeBase).toEqual([]);
    expect(light!.knowledgeBaseDropped).toBe(0);
    const pick = (c: typeof full) => ({ property: c!.property, open: c!.open, activeReservation: c!.activeReservation, pinRequired: c!.pinRequired });
    expect(pick(light)).toEqual(pick(full));
  });

  it("KONTROL — kapalı konaklama ve kapalı sohbet iki çözümlemede de aynı", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId, false);
    expect(await resolveGuestChat(token, undefined, { knowledgeBase: false })).toEqual(await resolveGuestChat(token));
    await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: false } });
    expect(await resolveGuestChat(token, undefined, { knowledgeBase: false })).toBeNull();
  });

  it("KONTROL — varsayılan çağrı bilgi tabanını yine çeker (sır taramalı)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    kbFetch.mockClear();
    const ctx = await resolveGuestChat(token);
    expect(kbFetch).toHaveBeenCalledTimes(1);
    expect(withoutRandomIds(JSON.stringify(ctx!.knowledgeBase))).not.toContain("9090"); // blob kalem kimliği taşır
    expect(JSON.stringify(ctx!.knowledgeBase)).toContain("Çöp salı");
  });
});

describe("GET /api/chat/[token] — bilgi tabanına dokunmaz, yanıt aynı", () => {
  it("🚨 açık sohbette yanıt { open: true, messages } ve bilgi tabanı sorgusu YOK", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    kbFetch.mockClear();
    const res = await GET(new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers: { "x-forwarded-for": "203.0.113.41" } }) as never, {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: true, messages: [] });
    expect(kbFetch).not.toHaveBeenCalled();
  });
});

describe("bağlantı pini: sayfa + GET hafif, POST tam çözümler", () => {
  const route = readFileSync("src/app/api/chat/[token]/route.ts", "utf8");
  const page = readFileSync("src/app/c/[token]/page.tsx", "utf8");
  it("sayfa bilgi tabanısız çözümler", () => {
    expect(page).toContain("resolveGuestChat(token, undefined, { knowledgeBase: false })");
  });
  it("GET gövdesi hafif, POST gövdesi tam çözümler", () => {
    const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    const postBody = route.slice(route.indexOf("async function handleGuestChatPost"));
    expect(route.indexOf("export async function GET")).toBeGreaterThan(-1);
    expect(route.indexOf("async function handleGuestChatPost")).toBeGreaterThan(-1);
    expect(getBody).toContain("resolveGuestChat(token, undefined, { knowledgeBase: false })");
    expect(postBody).toContain("resolveGuestChat(token)");
    expect(postBody).not.toContain("knowledgeBase: false");
  });
});
