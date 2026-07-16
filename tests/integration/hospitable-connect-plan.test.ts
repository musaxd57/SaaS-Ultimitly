import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { HospitableError } from "@/lib/hospitable";

// Essentials planı senaryosu: token DOĞRU ama Hospitable planı API erişimi
// içermiyor → verifyToken 402 fırlatır. Bağlanma "token geçersiz" DEĞİL, plan-
// yükseltme yönlendiren DÜRÜST bir hata dönmeli ve token SAKLANMAMALI.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return { ...actual, verifyToken: verifyMock };
});

import { POST } from "@/app/api/hospitable/connect/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/hospitable/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/hospitable/connect — plan (Essentials) gerçeği", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Müşteri" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "Sahip", email: "s@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "s@x.com", name: "Sahip", sessionEpoch: 0 };
  });

  it("402 (plan API erişimi içermiyor): DÜRÜST plan-mesajı döner, token SAKLANMAZ", async () => {
    verifyMock.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 402)", 402));
    const res = await POST(req({ token: "hospitable_pat_gecerli_ama_planlockli" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("API erişimi"); // plan-adı bağımsız, yeteneğe göre
    expect(data.error).not.toContain("geçersiz");
    // Token saklanmadı — org bağlantısız kaldı.
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.hospitableTokenEnc).toBeNull();
  });

  it("401 (gerçekten geçersiz token): 'token geçersiz' mesajı korunur", async () => {
    verifyMock.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    const res = await POST(req({ token: "hospitable_pat_bozuk_anahtar" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("geçersiz");
    expect(data.error).not.toContain("API erişimli");
  });

  it("başarılı doğrulama: token saklanır", async () => {
    verifyMock.mockResolvedValue({ properties: 3 });
    const res = await POST(req({ token: "hospitable_pat_calisir_anahtar" }));
    expect(res.status).toBe(200);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.hospitableTokenEnc).not.toBeNull();
  });
});
