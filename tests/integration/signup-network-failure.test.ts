import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// K1 kayıt ağı izi — ARIZA yolu AYRI dosyada (CLAUDE.md dersi: Prisma temsilcisine `vi.spyOn` sonraki testlere sızar). İz yazımı hata verse de
// kayıt 201 döner ve hesap açılır (fail-open).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";

function registerReq(email: string, ip: string) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", "x-forwarded-for": ip },
    body: JSON.stringify({ organizationName: "İşletme", name: "Test Host", email, password: "sifre12345", consent: true }),
  });
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.stubEnv("REGISTRATION_OPEN", "1");
  vi.stubEnv("SIGNUP_NETWORK_TRACE_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("kayıt ağı izi arızası", () => {
  it("🚨 iz yazımı hata verirse kayıt YİNE 201 (fail-open) ve hesap açılır", async () => {
    vi.spyOn(prisma.signupNetworkTrace, "create").mockRejectedValueOnce(new Error("db down"));
    expect((await register(registerReq("b@example.com", "203.0.113.9"))).status).toBe(201);
    expect(await prisma.user.count({ where: { email: "b@example.com" } })).toBe(1);
    expect(await prisma.signupNetworkTrace.count()).toBe(0);
  });
});
