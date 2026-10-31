import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// TEMİZLİKÇİ MİSAFİR VERİSİ GÖRMEZ (09-24, kanıt modeli dilim 3; kurucu: "temizlikçi misafir mesajını, adını,
// iletişimini ASLA görmez"). Personel oturumuyla görev listesi ve görev güncelleme cevabı; personele atama e-postası.
// Sistem görev başlığı misafir ADI taşır, yapay zekâ görevinin açıklaması misafirin MESAJIDIR. Yönetici tam görür.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { GET } from "@/app/api/tasks/route";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { emailService } from "@/lib/email";

const mockEmail = vi.mocked(emailService.sendReporting);
const GUEST = "Ayşe Yılmaz";
const MESSAGE = "Klima bozuk, ben Ayşe Yılmaz, numaram 0532 111 22 33";
const LEAK = /Ayşe|Yılmaz|0532|Klima bozuk/;

let ids: { orgId: string; staffId: string; ownerId: string; managerId: string; system: string; ai: string; manual: string };

const as = (role: SessionPayload["role"], userId: string) => {
  session = { userId, organizationId: ids.orgId, role, email: `${role}@x.com`, name: role, sessionEpoch: 0 };
};
const list = async () => (await (await GET(new NextRequest("http://localhost/api/tasks"), { params: Promise.resolve({}) })).json()) as Record<string, unknown>[];
const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

describe("görevler — temizlikçi görünümü (API + e-posta)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const staff = await prisma.user.create({ data: { organizationId: org.id, name: "Temizlik", email: "s@x.com", passwordHash: "x", role: "staff" } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: "o@x.com", passwordHash: "x", role: "owner" } });
    const manager = await prisma.user.create({ data: { organizationId: org.id, name: "Yönetici", email: "m@x.com", passwordHash: "x", role: "manager" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const reservation = await prisma.reservation.create({
      data: { propertyId: property.id, guestName: GUEST, arrivalDate: new Date("2026-10-12T00:00:00Z"), departureDate: new Date("2026-10-14T00:00:00Z"), status: "confirmed", channel: "airbnb" },
    });
    const system = await prisma.task.create({
      data: {
        propertyId: property.id,
        reservationId: reservation.id,
        type: "cleaning",
        origin: "system",
        title: `Çıkış temizliği - ${GUEST}`,
        description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi.",
        status: "todo",
        assignedToId: staff.id,
      },
    });
    const ai = await prisma.task.create({
      data: { propertyId: property.id, reservationId: reservation.id, type: "maintenance", origin: "ai", title: `Şikayet: ${GUEST}`, description: MESSAGE, status: "todo", assignedToId: staff.id },
    });
    const manual = await prisma.task.create({
      data: { propertyId: property.id, type: "cleaning", origin: "manual", title: "Balkon camları", description: "Anahtar kutuda.", status: "todo", assignedToId: staff.id },
    });
    ids = { orgId: org.id, staffId: staff.id, ownerId: owner.id, managerId: manager.id, system: system.id, ai: ai.id, manual: manual.id };
  });

  it("🚨 personelin görev listesi misafir adı ve mesajı taşımaz; kendi yazdığı (host) görev aynen", async () => {
    as("staff", ids.staffId);
    const rows = await list();
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(LEAK);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[ids.system]).toMatchObject({ title: "Çıkış temizliği", description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi." });
    expect(byId[ids.ai]).toMatchObject({ title: "Bakım", description: null, sourceMessageId: null });
    expect(byId[ids.manual]).toMatchObject({ title: "Balkon camları", description: "Anahtar kutuda." });
  });

  it("yönetici/sahip tam görür (host görünümü değişmedi)", async () => {
    as("owner", ids.ownerId);
    const rows = await list();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[ids.system]).toMatchObject({ title: `Çıkış temizliği - ${GUEST}` });
    expect(byId[ids.ai]).toMatchObject({ title: `Şikayet: ${GUEST}`, description: MESSAGE });
  });

  it("🚨 personelin görev güncelleme cevabı da temizlikçi görünümüdür (durum değişikliği kaydedilir)", async () => {
    as("staff", ids.staffId);
    const res = await patch(ids.ai, { status: "in_progress" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(LEAK);
    expect(body).toMatchObject({ title: "Bakım", description: null, status: "in_progress" });
    // Veri değişmedi: yalnız görünüm.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ids.ai } })).title).toBe(`Şikayet: ${GUEST}`);
  });

  it("🚨 personele atama e-postası misafir adı ve mesajı taşımaz; yöneticiye giden tam içerik", async () => {
    // Görevi önce kimseye atanmamış yap, sonra personele ata.
    await prisma.task.update({ where: { id: ids.ai }, data: { assignedToId: null } });
    as("owner", ids.ownerId);
    expect((await patch(ids.ai, { assignedToId: ids.staffId })).status).toBe(200);
    await vi.waitFor(() => expect(mockEmail).toHaveBeenCalledTimes(1));
    const [to, subject, html] = mockEmail.mock.calls[0] as [string, string, string];
    expect(to).toBe("s@x.com");
    expect(`${subject} ${html}`).not.toMatch(LEAK);
    expect(subject).toBe("Yeni Görev: Bakım");
    // Yöneticiye atama: host görünümü (misafir bilgisini yönetici zaten görür).
    mockEmail.mockClear();
    expect((await patch(ids.ai, { assignedToId: ids.managerId })).status).toBe(200);
    await vi.waitFor(() => expect(mockEmail).toHaveBeenCalledTimes(1));
    const [, managerSubject] = mockEmail.mock.calls[0] as [string, string, string];
    expect(managerSubject).toBe(`Yeni Görev: Şikayet: ${GUEST}`);
  });
});
