import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// 10-01 (15 ajan incelemesi A02-F12): operatörün müşteri hesabı açma yolu e-postayı DOĞRULANMIŞ sayar. Operatör listesindeki
// (SUPERADMIN_EMAILS) ama hesabı henüz olmayan bir adres (planlanan ikinci operatör, takma ad) bu yolla açılırsa, çalınmış bir operatör
// oturumu o hesaba kendi 2FA'sını kurup gerçek operatörün şifre değişikliğinden etkilenmeyen KALICI bir operatör kimliği elde ederdi.
// Kural: listedeki adres müşteri hesabı olarak açılmaz. KONTROL: sıradan adres bugünkü gibi açılır.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/admin/customers/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const RESERVED_EMAIL = "ikinci-operator@lixusai.com";

async function operatorSession(): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: "Operatör org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" },
  });
  return { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa: true };
}

const createReq = (email: string) =>
  new NextRequest("http://localhost/api/admin/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationName: "Lale Konaklama", name: "Lale Sahibi", email, password: "uzun-bir-sifre-123" }),
  });

describe("operatör müşteri hesabı açma — operatör listesindeki adres reddedilir", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("SUPERADMIN_EMAILS", `${OPERATOR_EMAIL}, ${RESERVED_EMAIL}`);
    session = await operatorSession();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 listedeki (hesabı olmayan) adres → 400, kullanıcı / org AÇILMAZ (büyük harfle yazılsa da)", async () => {
    for (const email of [RESERVED_EMAIL, "Ikinci-Operator@LixusAI.com"]) {
      const res = await POST(createReq(email));
      expect(res.status).toBe(400);
      expect((await res.json()).fields?.email).toBe("Bu adres operatör hesabı için ayrılmış; müşteri hesabında kullanılamaz.");
    }
    expect(await prisma.user.count({ where: { email: RESERVED_EMAIL } })).toBe(0);
    expect(await prisma.organization.count({ where: { name: "Lale Konaklama" } })).toBe(0);
  });

  it("KONTROL — sıradan müşteri adresi bugünkü gibi açılır (doğrulanmış, sahip)", async () => {
    const res = await POST(createReq("lale@example.com"));
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "lale@example.com" } });
    expect(user.role).toBe("owner");
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});
