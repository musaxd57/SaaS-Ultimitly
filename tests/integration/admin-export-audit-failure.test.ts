import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — KAYIT YAZILAMAZSA İNDİRME YOK. Kayıt arızası `auditLog.create` casusuyla kurulur (casus dosya başında BİR
// KEZ kurulur, geri alınmaz — Prisma temsilcisinde geri alma yöntemi siliyor; `armed` bayrağıyla açılır). Ayrı dosya: Prisma
// temsilcisi casusu sonraki testlere sızmasın.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => {}),
}));

import { GET } from "@/app/api/admin/export/route";

let armed = false;
const originalCreate = prisma.auditLog.create.bind(prisma.auditLog);
vi.spyOn(prisma.auditLog, "create").mockImplementation(((args: Parameters<typeof originalCreate>[0]) => {
  if (armed) return Promise.reject(new Error("db down"));
  return originalCreate(args);
}) as never);

const OPERATOR = "operator@lixusai.com";

describe("operatör dışa aktarımı — kayıt arızası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
  });
  afterEach(() => {
    armed = false;
    vi.unstubAllEnvs();
  });

  async function seedAndLogin() {
    const victim = await prisma.organization.create({ data: { name: "Kurban Konaklama" } });
    const opOrg = await prisma.organization.create({ data: { name: "Operatör Org" } });
    const op = await prisma.user.create({ data: { organizationId: opOrg.id, name: "Op", email: OPERATOR, passwordHash: "x", role: "owner" } });
    session = { userId: op.id, organizationId: opOrg.id, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 0, mfa: true };
    return victim.id;
  }

  it("🚨 kayıt yazılamazsa 503 — gövdede işletme verisi YOK", async () => {
    const victimId = await seedAndLogin();
    armed = true;
    const res = await GET(new NextRequest(`http://localhost/api/admin/export?orgId=${victimId}&purpose=support_request`));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("Kurban Konaklama");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("KONTROL — kayıt yazılabiliyorsa indirme olur (casus geçirgen)", async () => {
    const victimId = await seedAndLogin();
    const res = await GET(new NextRequest(`http://localhost/api/admin/export?orgId=${victimId}&purpose=support_request`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Kurban Konaklama");
  });
});
