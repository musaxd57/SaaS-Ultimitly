import { describe, it, expect, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// M-2 (kurucu 11-06, tasarım §13): girişteki onarım yarışı BELİRLENİMLİ. Eşzamanlı ikinci giriş, onarımın kendi yazımı `skipDuplicates`
// ile boşa düştüğünde (ilk giriş satırı az önce yazdı) üyeliği YENİDEN seçmeli — yoksa ikinci kişi boşuna 403 alırdı. Gerçek eşzamanlılık
// testte garanti değil; araya giren yazım burada onarımın KENDİ yazımının hemen öncesine konur.
// Prisma temsilcisine casus → AYRI dosya ve dosya düzeyinde casus, GERİ ALINMAZ (CLAUDE.md).
// ---------------------------------------------------------------------------

const jar = vi.hoisted(() => ({ set: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (a: string | { name: string; value: string }, b?: string) => {
      jar.set.push(typeof a === "string" ? { name: a, value: b ?? "" } : a);
    },
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

const race = vi.hoisted(() => ({ armed: false, interleaved: 0 }));
const realCreateMany = prisma.membership.createMany.bind(prisma.membership);
vi.spyOn(prisma.membership, "createMany").mockImplementation((async (args: Parameters<typeof realCreateMany>[0]) => {
  if (race.armed) {
    race.armed = false;
    // "İlk giriş" onarımın yazacağı satırın aynısını az önce yazdı.
    const row = (Array.isArray(args?.data) ? args.data[0] : args?.data) as { userId: string; organizationId: string; role: string };
    await prisma.membership.create({
      data: { userId: row.userId, organizationId: row.organizationId, role: row.role, origin: "repair", singleMembershipGuard: row.userId },
    });
    race.interleaved += 1;
  }
  return realCreateMany(args);
}) as never);

import { POST as login } from "@/app/api/auth/login/route";

describe("girişteki onarım — eşzamanlı yazım", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    jar.set.length = 0;
    race.armed = false;
    race.interleaved = 0;
  });

  it("🚨 onarımın yazımı başka girişin satırına çarpınca üyelik YENİDEN seçilir: giriş 200, tek satır", async () => {
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    const u = await prisma.user.create({
      data: { organizationId: org.id, name: "Eski", email: "yaris-onar@example.test", passwordHash: await bcrypt.hash("secret123", 4), role: "owner", emailVerifiedAt: new Date() },
    });
    race.armed = true;
    const res = await login(
      new NextRequest("http://www.lixusai.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.61" },
        body: JSON.stringify({ email: "yaris-onar@example.test", password: "secret123" }),
      }),
    );
    expect(race.interleaved).toBe(1); // araya girme gerçekten kuruldu (vakum değil)
    expect(res.status).toBe(200);
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(1);
    const written = [...jar.set].reverse().find((c) => c.value && c.name.endsWith(SESSION_COOKIE))!;
    expect(await verifySession(written.value)).toMatchObject({ userId: u.id, organizationId: org.id, role: "owner" });
  });
});
