import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K8 (kurucu kararı 09-28): operatör bürünmesi SALT-OKUNUR destek görünümü — müşteri hesabında hiçbir yazma (sarmalı uçlar
// `withAuth` tek boğazında, sarmalayıcısız müşteri uçları kendi kontrolüyle); tüm misafir verisini dışa aktarma ve kanal
// bağlama kapalı; bürünme en çok 2 saat (damgasız eski belirteç dolmuş). Gerçek `requireSession` + `withAuth` (yalnız
// `getSession` taklit).
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => currentSession) };
});

import { GET as kbGet, POST as kbPost } from "@/app/api/kb/route";
import { GET as exportGet } from "@/app/api/account/export/route";
import { POST as guestChatReply } from "@/app/api/guest-chats/[id]/reply/route";
import { POST as connectPost, DELETE as connectDelete } from "@/app/api/hospitable/connect/route";
import { GET as oauthAuthorize } from "@/app/api/hospitable/oauth/authorize/route";
import { IMPERSONATION_READ_ONLY_MESSAGE } from "@/lib/auth/impersonation";

const OPERATOR = "ops@lixusai.com";
const noCtx = { params: Promise.resolve({} as Record<string, never>) };
const nowSec = () => Math.floor(Date.now() / 1000);

let orgId: string;
let propertyId: string;
let customer: SessionPayload;
let impersonated: SessionPayload;

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, email: "owner@x.com", name: "Sahip", passwordHash: "x", role: "owner", sessionEpoch: 1 },
  });
  const opOrg = await prisma.organization.create({ data: { name: "Lixus" } });
  const operator = await prisma.user.create({
    data: {
      organizationId: opOrg.id,
      email: OPERATOR,
      name: "Operatör",
      passwordHash: "x",
      role: "owner",
      sessionEpoch: 1,
      twoFactorEnabledAt: new Date(),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  orgId = org.id;
  propertyId = property.id;
  customer = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 1 };
  impersonated = {
    ...customer,
    actorUserId: operator.id,
    actorEmail: OPERATOR,
    actorName: "Operatör",
    actorSessionEpoch: 1,
    mfa: true,
    impersonatedAt: nowSec() - 60,
  };
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const kbBody = () => ({ propertyId, category: "general", title: "Otopark", content: "Bina önünde ücretsiz." });

describe("K8 — salt-okunur destek görünümü", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    await seed();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    currentSession = null;
  });

  it("🚨 sarmalı uç: bürünmüşken YAZMA 403 (sade ileti), veritabanı değişmez", async () => {
    currentSession = impersonated;
    const res = await kbPost(json("http://localhost/api/kb", "POST", kbBody()), noCtx);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(IMPERSONATION_READ_ONLY_MESSAGE);
    expect(await prisma.knowledgeBaseItem.count()).toBe(0);
  });

  it("bürünmüşken OKUMA serbest (destek görebilir)", async () => {
    currentSession = impersonated;
    const res = await kbGet(new NextRequest("http://localhost/api/kb"), noCtx);
    expect(res.status).toBe(200);
  });

  it("KONTROL — müşterinin kendisi aynı yazmayı yapar", async () => {
    currentSession = customer;
    const res = await kbPost(json("http://localhost/api/kb", "POST", kbBody()), noCtx);
    expect(res.status).toBe(201);
    expect(await prisma.knowledgeBaseItem.count()).toBe(1);
  });

  it("🚨 2 saati aşan bürünme hiçbir uca erişemez (okuma dahil)", async () => {
    currentSession = { ...impersonated, impersonatedAt: nowSec() - 2 * 3600 - 60 };
    expect((await kbGet(new NextRequest("http://localhost/api/kb"), noCtx)).status).toBe(401);
  });

  it("🚨 damgasız (bu sürümden önce basılmış) bürünme belirteci dolmuş sayılır", async () => {
    const legacy: SessionPayload = { ...impersonated };
    delete legacy.impersonatedAt;
    currentSession = legacy;
    expect((await kbGet(new NextRequest("http://localhost/api/kb"), noCtx)).status).toBe(401);
  });

  it("KONTROL — 2 saatin içindeki bürünme okuyabilir", async () => {
    currentSession = { ...impersonated, impersonatedAt: nowSec() - 2 * 3600 + 120 };
    expect((await kbGet(new NextRequest("http://localhost/api/kb"), noCtx)).status).toBe(200);
  });

  it("🚨 tüm misafir verisini dışa aktarma bürünmüşken kapalı (GET olsa da)", async () => {
    currentSession = impersonated;
    const res = await exportGet(new NextRequest("http://localhost/api/account/export"), noCtx);
    expect(res.status).toBe(403);
  });

  it("🚨 sarmalayıcısız müşteri uçları da kapalı: QR sohbet cevabı, kanal bağlama / kaldırma", async () => {
    currentSession = impersonated;
    const reply = await guestChatReply(json("http://localhost/api/guest-chats/x/reply", "POST", { body: "Merhaba" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(reply.status).toBe(403);
    expect((await connectPost(json("http://localhost/api/hospitable/connect", "POST", { token: "t" }))).status).toBe(403);
    expect((await connectDelete()).status).toBe(403);
  });

  it("🚨 OAuth ile kanal bağlama bürünmüşken ayarlara geri döner (akış başlamaz)", async () => {
    currentSession = impersonated;
    const res = await oauthAuthorize(new NextRequest("http://localhost/api/hospitable/oauth/authorize", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toMatch(/settings\?hospitable=forbidden/);
  });
});
