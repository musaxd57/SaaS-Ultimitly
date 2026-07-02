import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// The demo must never call a real model in tests — and asserting on the mock
// also proves the fictional-apartment pipeline is what gets invoked.
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(async () => ({
    reply: "Örnek cevap",
    intent: "wifi",
    confidence: 0.9,
    riskLevel: "none",
    detectedLanguage: "tr",
    source: "fallback",
    statedCheckoutTime: null,
  })),
}));

import { POST } from "@/app/api/demo/ai/route";
import { suggestReply } from "@/lib/ai";

function req(message: string, ip = "1.2.3.4") {
  return new NextRequest("http://localhost/api/demo/ai", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ message }),
  });
}

describe("POST /api/demo/ai — public landing demo", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is DORMANT (404) unless LANDING_DEMO_ENABLED=1", async () => {
    vi.stubEnv("LANDING_DEMO_ENABLED", "");
    const res = await POST(req("Merhaba"));
    expect(res.status).toBe(404);
    expect(suggestReply).not.toHaveBeenCalled();
  });

  it("answers via the real pipeline with the FICTIONAL apartment (never real org data)", async () => {
    vi.stubEnv("LANDING_DEMO_ENABLED", "1");
    const res = await POST(req("wifi şifresi nedir?"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe("Örnek cevap");
    const call = vi.mocked(suggestReply).mock.calls[0][0];
    expect(call.property.name).toBe("Örnek Daire 3");
    expect(call.knowledgeBase.some((k: { category: string }) => k.category === "wifi")).toBe(true);
  });

  it("stops at the durable global daily cap without calling the model", async () => {
    vi.stubEnv("LANDING_DEMO_ENABLED", "1");
    vi.stubEnv("LANDING_DEMO_DAILY_CAP", "2");
    // Different IPs so the per-IP limiter can't mask the global cap.
    expect((await POST(req("m1", "1.1.1.1"))).status).toBe(200);
    expect((await POST(req("m2", "2.2.2.2"))).status).toBe(200);
    const res = await POST(req("m3", "3.3.3.3"));
    expect(res.status).toBe(429);
    expect(vi.mocked(suggestReply)).toHaveBeenCalledTimes(2);
    // Counter persisted durably (survives restarts/replicas by design).
    const day = new Date().toISOString().slice(0, 10);
    const usage = await prisma.chatUsage.findUnique({
      where: { propertyId_day: { propertyId: "landing-demo", day } },
    });
    expect(usage?.count).toBe(3);
  });

  it("rejects empty and over-long messages", async () => {
    vi.stubEnv("LANDING_DEMO_ENABLED", "1");
    expect((await POST(req(""))).status).toBe(400);
    expect((await POST(req("x".repeat(501)))).status).toBe(400);
  });
});
