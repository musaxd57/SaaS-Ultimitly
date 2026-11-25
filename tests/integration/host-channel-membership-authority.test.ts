import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeUser } from "../helpers/db";

// ---------------------------------------------------------------------------
// K23 (Codex 11-25; tasarım M-2 §10.1 S6): ev sahibi WhatsApp kanalının yetkisi ana işletme AYNASINDAN (`User.organizationId` / `User.role`)
// veriliyordu — web oturumu ise üyelikten doğrulanıyor. Ayna çıkarmayı / askıyı / üyelikteki rol düşürmeyi görmez. Bugün üyeliği `revoked`
// yapan ya da rolünü aynasız değiştiren yazıcı YOK (ekipten çıkarma dilim 6a ile gelir); testler bu durumları doğrudan veritabanında kurar —
// kural geldiğinde kanal web oturumuyla AYNI kararı vermeli. Kontrol: etkin sahip / yönetici üyeliği kanalı kullanır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { usableHostBindingForOrg } from "@/lib/host-channel/binding";
import { handleHostAnswer } from "@/lib/host-channel/answer";

async function world(role: "owner" | "manager" | "staff" = "owner") {
  const org = await prisma.organization.create({ data: { name: "Lale İşletme" } });
  const user = await makeUser({ data: { organizationId: org.id, name: "Sahip", email: `s${Math.random()}@example.com`, passwordHash: "x", role } });
  const binding = await prisma.hostChannelBinding.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      provider: "fake",
      addressHash: `h-${Math.random()}`,
      addressEnc: "x",
      status: "active",
      verifiedAt: new Date(),
      userSessionEpoch: user.sessionEpoch,
    },
  });
  const answer = () =>
    handleHostAnswer({
      binding: { id: binding.id, organizationId: org.id },
      to: "905320000000",
      event: { kind: "unsupported", from: "905320000000", providerMessageId: `wamid.${Math.random()}`, contextId: null, media: "image", at: new Date() },
      transport: null,
    });
  return { orgId: org.id, userId: user.id, bindingId: binding.id, answer };
}

describe("K23 — ev sahibi kanalının yetkisi ÜYELİKTEN", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("KONTROL: etkin sahip ve yönetici üyeliği kanalı kullanır", async () => {
    const o = await world("owner");
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: o.bindingId, userId: o.userId });
    expect(await o.answer()).not.toBe("not_usable");
    const m = await world("manager");
    expect(await usableHostBindingForOrg(m.orgId)).toEqual({ id: m.bindingId, userId: m.userId });
  });

  it("🚨 üyeliği etkin olmayan (çıkarılmış) kişi: soru almaz, cevabı işlenmez — ayna hâlâ 'sahip' dese de", async () => {
    const o = await world("owner");
    await prisma.membership.updateMany({ where: { userId: o.userId, organizationId: o.orgId }, data: { status: "revoked", revokedAt: new Date(), epoch: { increment: 1 } } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })).role).toBe("owner"); // ayna değişmedi
    expect(await usableHostBindingForOrg(o.orgId)).toBeNull();
    expect(await o.answer()).toBe("not_usable");
  });

  it("🚨 rolü ÜYELİKTE personele düşürülmüş kişi: kanal yetkisi düşer", async () => {
    const o = await world("owner");
    await prisma.membership.updateMany({ where: { userId: o.userId, organizationId: o.orgId }, data: { role: "staff", epoch: { increment: 1 } } });
    expect(await usableHostBindingForOrg(o.orgId)).toBeNull();
    expect(await o.answer()).toBe("not_usable");
  });

  it("KONTROL: personel üyeliği kanal kullanamaz (bugünkü kural aynen)", async () => {
    const s = await world("staff");
    expect(await usableHostBindingForOrg(s.orgId)).toBeNull();
    expect(await s.answer()).toBe("not_usable");
  });
});
