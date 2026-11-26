import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// #211 (gece güvenlik turu, S3 P3 — kodda doğrulandı): KİMLİK rotalarının kuralı ("JSON kontrolü IP kovasından ÖNCE", 09-23) kimliksiz
// ANONİM rotalara da uygulanır. `text/plain` CORS-safelisted → başka bir site ziyaretçisinin tarayıcısından preflight'sız POST
// attırıp o ağın (ofis / mobil NAT) demo formu, canlı demo, QR sohbeti ve CSP raporu kovalarını yakabiliyordu; `application/json`
// çapraz sitede preflight ister ve `/api` CORS başlığı yayınlamadığı için hiç gönderilmez. Kova geçersiz JSON gövdede YİNE tüketilir
// (kaba kuvvet koruması aynen); yalnız başlık kontrolü öne alındı. Kendi istemcilerimiz (lead-form, landing-demo, guest-chat) JSON yollar.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));

import { POST as leads } from "@/app/api/leads/route";
import { POST as demoAi } from "@/app/api/demo/ai/route";
import { POST as chat } from "@/app/api/chat/[token]/route";
import { POST as cspReport } from "@/app/api/csp-report/route";

const TOKEN = "t".repeat(32);
const withToken = (h: typeof chat) => (r: NextRequest) => h(r, { params: Promise.resolve({ token: TOKEN }) });

const ROUTES = [
  { name: "leads", handler: leads as (r: NextRequest) => Promise<Response>, url: "http://localhost/api/leads", bucket: "lead:", okType: "application/json" },
  { name: "demo/ai", handler: demoAi as (r: NextRequest) => Promise<Response>, url: "http://localhost/api/demo/ai", bucket: "demo-ai:", okType: "application/json" },
  { name: "chat/[token]", handler: withToken(chat), url: `http://localhost/api/chat/${TOKEN}`, bucket: "guestchat-ip:", okType: "application/json" },
  { name: "csp-report", handler: cspReport as (r: NextRequest) => Promise<Response>, url: "http://localhost/api/csp-report", bucket: "csp-report:", okType: "application/csp-report" },
] as const;

const req = (url: string, contentType: string, body: string) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.9" }, body });

describe.each(ROUTES)("$name — tarayıcıdan gönderilebilen JSON-dışı istek kovaya DOKUNMAZ", ({ handler, url, bucket, okType }) => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("LANDING_DEMO_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 25 × text/plain (+ form) → hepsi 415, IP kovası HİÇ yazılmaz; meşru istek kovayı tüketir", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await handler(req(url, i % 2 ? "text/plain" : "application/x-www-form-urlencoded", JSON.stringify({ message: "x" })));
      expect(res.status).toBe(415);
    }
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: bucket } } }), "JSON-dışı istek IP kovasını tüketti").toBe(0);

    const ok = await handler(req(url, okType, JSON.stringify({})));
    expect([415, 429]).not.toContain(ok.status);
    // ANTİ-VAKUM: meşru biçimdeki istek kovayı GERÇEKTEN tüketiyor (geçersiz gövdede de — kaba kuvvet koruması aynen).
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: bucket } } })).toBe(1);
  });

  it("parametreli başlık (charset) kabul edilir", async () => {
    const res = await handler(req(url, `${okType}; charset=utf-8`, JSON.stringify({})));
    expect(res.status).not.toBe(415);
  });
});

describe("csp-report — tarayıcının iki rapor MIME'ı + düz json kabul (davranış aynen)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });
  it("application/reports+json ve application/json 415 değil", async () => {
    for (const t of ["application/reports+json", "application/json"]) {
      const res = await cspReport(req("http://localhost/api/csp-report", t, "[]"));
      expect(res.status, t).not.toBe(415);
    }
  });
});
