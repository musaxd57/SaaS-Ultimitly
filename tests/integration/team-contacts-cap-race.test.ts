import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, makeUser } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EKİP KİŞİSİ ÜST SINIRI EŞZAMANLI İSTEKTE DE TUTAR (G2 tur 2 T2-B9, 11-19; anahtar `TEAM_CONTACTS_ENABLED` KAPALI). Sınır (işletme başına
// 50) eskiden kilitsiz "say → yaz"dı: 48 kişi varken 15 eşzamanlı istek 60–63 kişi üretti (saatlik 20 hak, sınırın en çok ~20 aşılmasına izin
// veriyordu). Artık sayım + oluşturma tek işlemde, işletme başına danışma kilidi altında (daire / bilgi tabanı sınırlarının kalıbı): eşzamanlı
// istekler sıraya girer, sınırdaki istek hiç oluşturmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  // Rastgele parola özeti testte hızlansın (bcrypt eşzamanlılık kapısı da devreden çıkar); yarış penceresi say → yaz arasıdır.
  return { ...actual, hashPassword: vi.fn(async () => "$2b$04$test-hash-not-real-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") };
});

import { POST } from "@/app/api/team-contacts/route";
import { __resetRateLimit } from "@/lib/rate-limit";

const req = (name: string) =>
  new NextRequest("http://localhost/api/team-contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
const post = (name: string) => POST(req(name), { params: Promise.resolve({}) });

describe("ekip kişisi üst sınırı — eşzamanlı istekler (G2 T2-B9)", () => {
  let orgId: string;
  const contacts = (org = orgId) => prisma.user.count({ where: { organizationId: org, loginDisabled: true } });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TEAM_CONTACTS_ENABLED", "1");
    orgId = (await makeOrgWithProperty()).orgId;
    const owner = await makeUser({ data: { organizationId: orgId, name: "Sahip", email: `owner-${orgId}@example.com`, passwordHash: "x", role: "owner" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: owner.email, name: "Sahip", sessionEpoch: 0 };
    // 48 kişi hazır (sınır 50).
    for (let i = 0; i < 48; i++) {
      await makeUser({ data: { organizationId: orgId, name: `Kisi ${i}`, email: `team-${i}-${orgId}@team.invalid`, passwordHash: "x", role: "staff", loginDisabled: true } });
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sıralı isteklerde sınır tutar: 48 → 50, sonra 400 (bugünkü ileti)", async () => {
    const res: { status: number; body: unknown }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await post(`Sirali ${i}`);
      res.push({ status: r.status, body: await r.json() });
    }
    expect(res.map((r) => r.status)).toEqual([200, 200, 400, 400]);
    expect(JSON.stringify(res[2]!.body)).toContain("Ekip kişisi sınırına ulaştınız.");
    expect(await contacts()).toBe(50);
  });

  it("🚨 15 eşzamanlı istek (48 kişi varken) → tam 2 kişi eklenir, 13 istek sınır iletisiyle 400; işletmede 50 kişi", async () => {
    const res = await Promise.all(Array.from({ length: 15 }, (_, i) => post(`Esz ${i}`)));
    expect(await contacts()).toBe(50);
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    const rejected = res.filter((r) => r.status === 400);
    expect(rejected).toHaveLength(13);
    for (const r of rejected) expect(JSON.stringify(await r.json())).toContain("Ekip kişisi sınırına ulaştınız.");
  });

  it("kilit işletme başınadır: sınırdaki işletmenin istekleri başka işletmenin ekleyebildiği kişiyi etkilemez", async () => {
    const other = (await makeOrgWithProperty()).orgId;
    const otherOwner = await makeUser({ data: { organizationId: other, name: "Sahip 2", email: `owner-${other}@example.com`, passwordHash: "x", role: "owner" } });
    const mine = session;
    const theirs: SessionPayload = { userId: otherOwner.id, organizationId: other, role: "owner", email: otherOwner.email, name: "Sahip 2", sessionEpoch: 0 };
    session = theirs;
    for (let i = 0; i < 3; i++) expect((await post(`Oteki ${i}`)).status).toBe(200);
    session = mine;
    expect((await post("Benim")).status).toBe(200);
    expect(await contacts(other)).toBe(3);
    expect(await contacts()).toBe(49);
  });
});
