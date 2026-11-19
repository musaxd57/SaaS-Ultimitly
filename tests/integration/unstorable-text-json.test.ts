import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// G2 YENİDEN ÜRETME (11-19) — A-1 sınıfının (sızma testi 11-14) NUL DIŞI ikizi: TEK VEKİL (lone surrogate, "\ud800").
// 11-14 düzeltmesi `readJsonCapped` → `parseJsonWithoutNul` ile JSON dize değerinden YALNIZ NUL'u siliyor. JSON'da geçerli olan
// "\ud800" kaçışı JSON.parse'tan sağ çıkar; Prisma 6.2.1 sorgu motoru dizeyi reddeder ("lone leading surrogate in hex escape" —
// PrismaClientKnownRequestError, P2002 değil) → rota catch'i → `serverError` → `reportError("api")` → 500. A-1'in açıkça saydığı kardeş
// yüzeyler ("leads / kayıt gövdesi → 'api' kovası") KİMLİKSİZ ve NUL yerine tek vekille aynen açık. Ürün kodunu DEĞİŞTİRMEZ.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const reported: string[] = [];
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async (context: string) => {
      reported.push(context);
      return { notified: false, throttled: false, configured: false };
    }),
  };
});

import { NextRequest } from "next/server";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as leadsPost } from "@/app/api/leads/route";
import { POST as propertiesPost } from "@/app/api/properties/route";
import { __resetRateLimit } from "@/lib/rate-limit";

// Gövde HAM metin olarak kurulur: "\\ud800" JSON kaçışı tel üzerinde geçerli JSON'dur (JSON.stringify de tek vekili böyle yazar).
const rawJson = (url: string, raw: string) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, body: raw });

describe("(G2 11-19) JSON gövdede tek vekil karakter — 500 / uyarı kovası YOK", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.length = 0;
    process.env.REGISTRATION_OPEN = "1";
    process.env.EMAIL_OUTBOX_ENABLED = "1"; // canlıdaki gibi (RAILWAY-ACILIS §1): doğrulama e-postası kuyruğa yazılır
  });
  afterEach(() => {
    delete process.env.REGISTRATION_OPEN;
    delete process.env.EMAIL_OUTBOX_ENABLED;
  });
  const apiReports = () => reported.filter((c) => c === "api");
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: düz Türkçe işletme adıyla kayıt → 201, alarm yok", async () => {
    const res = await registerPost(
      rawJson("http://localhost/api/auth/register", '{"organizationName":"Lale Evleri","name":"Ada","email":"ada@example.com","password":"cok-gizli-parola-123","consent":true}'),
    );
    expect(res.status).toBe(201);
    expect(apiReports()).toEqual([]);
  });

  it("🚨 KİMLİKSİZ kayıt: organizationName içinde tek vekil → 201/400", async () => {
    const res = await registerPost(
      rawJson("http://localhost/api/auth/register", '{"organizationName":"Lale \\ud800 Evleri","name":"Ada","email":"ada2@example.com","password":"cok-gizli-parola-123","consent":true}'),
    );
    expect({ status: res.status, api: apiReports() }).toEqual({ status: 201, api: [] });
  });

  it("🚨 KİMLİKSİZ demo talebi (leads): ad içinde tek vekil → 200/400", async () => {
    const res = await leadsPost(
      rawJson("http://localhost/api/leads", '{"name":"Ada \\udc00","email":"lead@example.com","phone":"","message":"merhaba","consent":true}'),
    );
    expect({ under500: res.status < 500, api: apiReports() }).toEqual({ under500: true, api: [] });
  });

  it("🚨 oturumlu (deneme sahibi): daire adı içinde tek vekil → 201/400", async () => {
    const { orgId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    const res = await propertiesPost(rawJson("http://localhost/api/properties", '{"name":"Lale \\ud800 2","checkInTime":"15:00","checkOutTime":"11:00"}'), {
      params: Promise.resolve({}),
    });
    expect({ status: res.status, api: apiReports() }).toEqual({ status: 201, api: [] });
  });
});
