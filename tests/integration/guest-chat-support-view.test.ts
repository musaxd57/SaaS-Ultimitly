import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import { signSession, sessionCookieName, type SessionPayload } from "@/lib/auth/session";
import { SUPPORT_VIEW_GUEST_CHAT_MESSAGE } from "@/lib/guest-chat-support-view";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — DESTEK GÖRÜNÜMÜ MİSAFİR SOHBETİNE GİRMEZ. QR sohbeti her konaklamada onu İLK açan cihaza kilitlenir;
// bürünmüş operatörün bir göz atması gerçek misafiri dışarıda bırakırdı. Uçlar (GET / POST / PIN) ve sayfa, imzası doğrulanmış
// bürünme oturumunda sohbeti AÇMAZ, cihaz BAĞLAMAZ; mülk sayfası destek görünümünde bağlantıyı / karekodu göstermez.
// KONTROL: ev sahibinin kendi oturumu ve çerezsiz misafir bugünkü gibi.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
let pageCookie = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["cookie", pageCookie], ["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));

import { suggestReply } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { GET, POST } from "@/app/api/chat/[token]/route";
import GuestChatPage from "@/app/c/[token]/page";
import PropertyDetailPage from "@/app/(app)/properties/[id]/page";
import { GuestChatSettings } from "@/components/properties/guest-chat-settings";
import { CalendarFeed } from "@/components/properties/calendar-feed";
import { generateCalendarToken } from "@/lib/export/ics";

const mockSuggest = vi.mocked(suggestReply);
const mockAuth = vi.mocked(requireAuth);

let orgId = "";
let propertyId = "";
let reservationId = "";
let token = "";

const ownerSession = (): SessionPayload => ({
  userId: "owner-1",
  organizationId: orgId,
  role: "owner",
  email: "sahip@example.com",
  name: "Sahip",
  sessionEpoch: 0,
});
const supportSession = (): SessionPayload => ({
  ...ownerSession(),
  mfa: true,
  actorUserId: "operator-1",
  actorEmail: "operator@lixusai.com",
  impersonatedAt: Math.floor(Date.now() / 1000),
});
const cookieFor = async (s: SessionPayload) => `${sessionCookieName()}=${await signSession(s)}`;

function call(method: "GET" | "POST", cookie?: string, body?: unknown) {
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" };
  if (cookie) headers.cookie = cookie;
  if (method === "POST") headers["content-type"] = "application/json";
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body ?? { message: "Wi-Fi şifresi nedir?" }) } : {}),
  });
  return (method === "GET" ? GET : POST)(req as never, { params: Promise.resolve({ token }) });
}
const boundHash = async () => (await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } })).chatBoundHash;

describe("destek görünümü — misafir sohbeti (kurucu kararı 09-30)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
    reservationId = (
      await prisma.reservation.create({
        data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
      })
    ).id;
    pageCookie = "";
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 GET: bürünme oturumu → 403, konaklama cihaza BAĞLANMAZ, çerez verilmez", async () => {
    const res = await call("GET", await cookieFor(supportSession()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(SUPPORT_VIEW_GUEST_CHAT_MESSAGE);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await boundHash()).toBeNull();
  });

  it("🚨 POST (mesaj ve PIN): bürünme oturumu → 403, bağlama yok, mesaj yazılmaz, model çağrılmaz", async () => {
    const cookie = await cookieFor(supportSession());
    expect((await call("POST", cookie)).status).toBe(403);
    expect((await call("POST", cookie, { pin: "123456" })).status).toBe(403);
    expect(await boundHash()).toBeNull();
    expect(await prisma.message.count()).toBe(0);
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("🚨 sayfa: bürünme oturumunda sohbet bileşeni YÜKLENMEZ, açıklama gösterilir", async () => {
    pageCookie = await cookieFor(supportSession());
    const el = (await GuestChatPage({ params: Promise.resolve({ token }) })) as React.ReactElement<{ title?: string }>;
    expect(el.props.title).toBe("Destek görünümünde misafir sohbeti açılmaz");
  });

  it("KONTROL — ev sahibinin kendi oturumu ve çerezsiz misafir bugünkü gibi (ilk açan bağlanır)", async () => {
    const own = await call("GET", await cookieFor(ownerSession()));
    expect(own.status).toBe(200);
    expect(await boundHash()).not.toBeNull();
    await prisma.reservation.update({ where: { id: reservationId }, data: { chatBoundHash: null, chatBoundAt: null } });
    const guest = await call("GET");
    expect(guest.status).toBe(200);
    expect(await boundHash()).not.toBeNull();
  });

  it("KONTROL — imzası geçersiz 'bürünme' çerezi sıradan ziyaretçidir (403 değil)", async () => {
    const forged = `${sessionCookieName()}=eyJhbGciOiJIUzI1NiJ9.eyJhY3RvclVzZXJJZCI6Im9wIn0.sahte`;
    expect((await call("GET", forged)).status).toBe(200);
  });

  it("KONTROL — sayfa: sahibin oturumunda sohbet bileşeni yüklenir", async () => {
    pageCookie = await cookieFor(ownerSession());
    const el = (await GuestChatPage({ params: Promise.resolve({ token }) })) as React.ReactElement<{ token?: string; title?: string }>;
    expect(el.props.title).toBeUndefined();
    expect(el.props.token).toBe(token);
  });
});

describe("mülk sayfası — destek görünümünde bağlantı / karekod YOK", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  });
  afterEach(() => vi.unstubAllEnvs());

  function findSettings(node: unknown): { url: string | null; supportView?: boolean } | null {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findSettings(n);
        if (hit) return hit;
      }
      return null;
    }
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (node.type === GuestChatSettings) return props as { url: string | null; supportView?: boolean };
      return findSettings(props.children);
    }
    return null;
  }
  const render = () => PropertyDetailPage({ params: Promise.resolve({ id: propertyId }), searchParams: Promise.resolve({}) });

  it("🚨 bürünme oturumu → bağlantı sayfaya yazılmaz, açıklama işareti verilir", async () => {
    mockAuth.mockResolvedValue(supportSession() as never);
    const settings = findSettings(await render());
    expect(settings).not.toBeNull();
    expect(settings!.url).toBeNull();
    expect(settings!.supportView).toBe(true);
  });

  it("KONTROL — sahibin oturumunda bağlantı görünür", async () => {
    mockAuth.mockResolvedValue(ownerSession() as never);
    const settings = findSettings(await render());
    expect(settings!.url).toContain(`/c/${token}`);
    expect(settings!.supportView).toBe(false);
  });

  // 10-01 (15 ajan incelemesi A02-F1): takvim beslemesinin adresi de kalıcı gizli bağlantıdır — 2 saatlik sınırdan sonra da çalışır.
  function containsString(node: unknown, needle: string): boolean {
    if (typeof node === "string") return node.includes(needle);
    if (node == null || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some((n) => containsString(n, needle));
    if (React.isValidElement(node)) return containsString(node.props, needle);
    return Object.values(node as Record<string, unknown>).some((v) => containsString(v, needle));
  }
  function findFeed(node: unknown): { feedUrl: string } | null {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = findFeed(n);
        if (hit) return hit;
      }
      return null;
    }
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (node.type === CalendarFeed) return props as { feedUrl: string };
      return findFeed(props.children);
    }
    return null;
  }

  it("🚨 bürünme oturumu → takvim besleme bağlantısı (gizli belirteç) sayfanın HİÇBİR yerinde yok", async () => {
    const icalToken = generateCalendarToken();
    await prisma.property.update({ where: { id: propertyId }, data: { icalToken } });
    mockAuth.mockResolvedValue(supportSession() as never);
    const tree = await render();
    expect(findFeed(tree)).toBeNull();
    expect(containsString(tree, icalToken)).toBe(false);
  });

  it("KONTROL — sahibin oturumunda takvim besleme bağlantısı belirteçle görünür", async () => {
    const icalToken = generateCalendarToken();
    await prisma.property.update({ where: { id: propertyId }, data: { icalToken } });
    mockAuth.mockResolvedValue(ownerSession() as never);
    const feed = findFeed(await render());
    expect(feed!.feedUrl).toContain(`/api/calendar/${icalToken}`);
  });
});
