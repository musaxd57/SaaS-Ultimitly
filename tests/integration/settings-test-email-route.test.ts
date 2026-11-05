import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Tur 4 (11-05, ölçüldü): "Test e-postası gönder" e-postasının dipnotu düğmenin yerini "Ayarlar › Bağlantılar" diye gösteriyordu (düğme
// İşletme Ayarları › Genel'de) ve düz metin parçasında "&rsaquo; &ldquo; &rdquo;" çözülmeden kalıyordu. Rota GERÇEKTEN çağrılır;
// gönderilen HTML'in dipnotu sınanır (yaprak sabitin varlığı yetmez — rotanın onu kullandığı da pinli).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
      return { ok: true };
    }),
  },
}));

import { POST } from "@/app/api/settings/test-email/route";

let orgId: string;

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  const made = await makeOrgWithProperty();
  orgId = made.orgId;
  const owner = await prisma.user.create({ data: { organizationId: orgId, email: "o@x.com", name: "O", passwordHash: "x", role: "owner" } });
  await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "o@x.com" } });
  session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("test e-postası rotası", () => {
  it("dipnot düğmenin bulunduğu görünümü adlandırır (Genel), HTML varlığı taşımaz", async () => {
    const res = await POST(new NextRequest("http://localhost/api/settings/test-email", { method: "POST" }), {
      params: Promise.resolve({} as Record<string, never>),
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    expect(html).toContain("Ayarlar › Genel bölümündeki “Test e-postası gönder” düğmesi oluşturdu");
    expect(html).not.toContain("Bağlantılar");
    expect(html).not.toMatch(/&(?:rsaquo|ldquo|rdquo);/);
  });
});
