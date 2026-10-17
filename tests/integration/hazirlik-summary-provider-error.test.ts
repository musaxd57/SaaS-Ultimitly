import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GECE-4 S7-02: AI özeti başarısızsa sağlayıcının HAM sebebi ("HTTP 401 (model=…) … Incorrect API key provided: sk-proj-abcd***wxyz",
// iç ana makine / IP) müşteri yöneticisine GİTMEZ — yalnız sade metin. (Maskeleme OpenAI'nin maskeli anahtar biçimini ve org kimliğini
// tanımıyordu.)
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/supply", async (orig) => ({ ...(await orig<typeof import("@/lib/supply")>()), getPrepPlan: vi.fn(async () => ({})) }));
vi.mock("@/lib/supply-ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/supply-ai")>()),
  supplyAiConfigured: () => true,
  planHasBuyables: () => true,
  generateSupplySummary: vi.fn(async () => ({
    ok: false,
    reason: 'HTTP 401 (model=gpt-5.6-luna) {"error":{"message":"Incorrect API key provided: sk-proj-abcd********wxyz. Organization org-AbCdEf123456"}} connect ECONNREFUSED 10.0.3.4:443',
  })),
}));

import { POST } from "@/app/api/hazirlik/summary/route";

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/hazirlik/summary — sağlayıcı hatası kiracıya gitmez", () => {
  it("🚨 502 gövdesinde YALNIZ sade metin; anahtar parçası / org kimliği / IP / model adı YOK", async () => {
    const { orgId } = await makeOrgWithProperty();
    session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 } as SessionPayload;
    const res = await POST(
      new NextRequest("http://localhost/api/hazirlik/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 7 }) }),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Özet oluşturulamadı, lütfen tekrar deneyin." });
    for (const leak of ["sk-proj", "org-AbCdEf", "10.0.3.4", "gpt-5.6", "HTTP 401", "detail"]) expect(text).not.toContain(leak);
  });
});
