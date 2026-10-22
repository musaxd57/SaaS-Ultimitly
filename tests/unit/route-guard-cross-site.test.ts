import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Başka siteden yazma kapısı (güvenlik 2. tur 10-22): oturum çerezi `SameSite=Lax` olduğu için başka siteden POST zaten oturumsuz gelir;
// açık kalan iki yol kardeş alt alan adından (same-site) gelen istek ve JSON ön-uçuşu tetiklemeyen GÖVDESİZ yazmaydı. Ortak kapı
// (`withAuth`) ve kapı dışındaki üç gövdesiz yazma rotası tarayıcının `Sec-Fetch-Site` başlığına bakar. Başlık yoksa geçer (sunucu
// istemcisi / eski tarayıcı — asıl kapı çerez); okuma hiç bakılmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/host-write-limit", () => ({ hostWriteLimited: vi.fn(async () => null) }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
const exitImpersonation = vi.fn(async () => undefined);
vi.mock("@/lib/admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/admin")>();
  return { ...actual, exitImpersonation: () => exitImpersonation(), isSuperAdmin: () => true };
});
const runQualityAudit = vi.fn();
vi.mock("@/lib/quality-audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/quality-audit")>();
  return { ...actual, runQualityAudit: (...a: unknown[]) => runQualityAudit(...a) };
});

import { NextRequest } from "next/server";
import { withAuth, crossSiteWrite } from "@/lib/route-guard";
import { hostWriteLimited } from "@/lib/host-write-limit";
import { POST as resumeAi } from "@/app/api/guest-chats/[id]/resume-ai/route";
import { POST as adminExit } from "@/app/api/admin/exit/route";
import { POST as qualityAudit } from "@/app/api/admin/quality-audit/route";

const owner: SessionPayload = {
  userId: "u1",
  organizationId: "org-x",
  role: "owner",
  email: "u1@x.test",
  name: "u1",
  sessionEpoch: 0,
} as SessionPayload;

const req = (method: string, site?: string, url = "http://localhost/api/x") =>
  new NextRequest(url, { method, headers: site ? { "sec-fetch-site": site } : {} });

describe("crossSiteWrite", () => {
  it("yazma + cross-site / same-site → başka site", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
      expect(crossSiteWrite(req(m.toUpperCase(), "cross-site"))).toBe(true);
      expect(crossSiteWrite(req(m.toUpperCase(), "same-site"))).toBe(true);
    }
  });
  it("aynı köken, adres çubuğu (none) ve başlıksız istek geçer", () => {
    expect(crossSiteWrite(req("POST", "same-origin"))).toBe(false);
    expect(crossSiteWrite(req("POST", "none"))).toBe(false);
    expect(crossSiteWrite(req("POST"))).toBe(false);
  });
  it("okuma (GET / HEAD / OPTIONS) hiç bakılmaz — başka siteden bağlantı açılabilir", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(crossSiteWrite(req(m, "cross-site"))).toBe(false);
  });
});

describe("withAuth başka siteden yazmayı keser", () => {
  const handler = vi.fn(async () => new Response("ok"));
  const route = withAuth(handler);
  const call = (method: string, site?: string) => route(req(method, site), { params: Promise.resolve({}) });

  beforeEach(() => {
    session = owner;
    handler.mockClear();
    vi.mocked(hostWriteLimited).mockClear();
  });

  it("same-site / cross-site POST → 403; işleyici çağrılmaz, yazma kovası yakılmaz", async () => {
    for (const site of ["same-site", "cross-site"]) {
      expect((await call("POST", site)).status).toBe(403);
      expect((await call("DELETE", site)).status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(hostWriteLimited).not.toHaveBeenCalled();
  });

  it("aynı kökenden ve başlıksız yazma geçer; başka siteden okuma geçer", async () => {
    expect((await call("POST", "same-origin")).status).toBe(200);
    expect((await call("PATCH")).status).toBe(200);
    expect((await call("GET", "cross-site")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("oturumsuz istek yine 401 (kapı oturumdan sonra)", async () => {
    session = null;
    expect((await call("POST", "cross-site")).status).toBe(401);
  });
});

describe("ortak kapı dışındaki gövdesiz yazma rotaları", () => {
  beforeEach(() => {
    session = owner;
    exitImpersonation.mockClear();
    runQualityAudit.mockClear();
  });

  it("QR yapay zekâyı yeniden aç: başka siteden 403", async () => {
    const res = await resumeAi(req("POST", "same-site", "http://localhost/api/guest-chats/c1/resume-ai"), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(403);
  });

  it("bürünmeden çıkış: başka siteden 403, çıkış yapılmaz; aynı kökenden çıkış yapılır", async () => {
    expect((await adminExit(req("POST", "cross-site", "http://localhost/api/admin/exit"))).status).toBe(403);
    expect(exitImpersonation).not.toHaveBeenCalled();
    expect((await adminExit(req("POST", "same-origin", "http://localhost/api/admin/exit"))).status).toBe(200);
    expect(exitImpersonation).toHaveBeenCalledTimes(1);
  });

  it("kalite denetimi (ücretli): başka siteden 403, denetim koşmaz", async () => {
    const res = await qualityAudit(req("POST", "same-site", "http://localhost/api/admin/quality-audit"));
    expect(res.status).toBe(403);
    expect(runQualityAudit).not.toHaveBeenCalled();
  });
});
