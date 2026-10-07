import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// U26 (Codex 10-07, 15c8663): GÖREV KONTROL LİSTESİ — bayat form / eşzamanlı işaret başka işareti SİLMEZ (gerçek PostgreSQL).
//  · Eski pano listenin TAMAMINI gönderiyordu: yönetici 1. maddeyi, personel 2. maddeyi işaretleyince sonuncu yazan öbürünü siliyordu.
//  · Liste arada değiştiyse (aynı uzunlukta, sıra / etiket farklı) personelin işareti SIRAYLA başka maddeye düşüyordu.
//  · Liste işlem DIŞINDA okunuyordu → eşzamanlı iki tek madde işareti de birbirini ezebilirdi.
// Doğru: tek madde (sıra + beklenen etiket) kilitli satıra yazılır; etiket tutmazsa 409, hiçbir şey yazılmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/tasks/[id]/route";

let ids: { org: string; staff: string; owner: string; task: string };
const ITEMS = Array.from({ length: 12 }, (_, i) => `Madde ${i + 1}`);

const req = (body: unknown) =>
  new NextRequest(`http://localhost/api/tasks/${ids.task}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = () => ({ params: Promise.resolve({ id: ids.task }) });
const asStaff = () =>
  (session = { userId: ids.staff, organizationId: ids.org, role: "staff", email: "s@x.com", name: "S", sessionEpoch: 0 });
const asOwner = () =>
  (session = { userId: ids.owner, organizationId: ids.org, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 });
const stored = async () =>
  JSON.parse((await prisma.task.findUniqueOrThrow({ where: { id: ids.task }, select: { checklistJson: true } })).checklistJson!) as {
    label: string;
    done: boolean;
  }[];

describe("U26 — kontrol listesi işaretleri kaybolmaz", () => {
  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const staff = await prisma.user.create({ data: { organizationId: org.id, name: "S", email: "s@x.com", passwordHash: "x", role: "staff" } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
    const task = await prisma.task.create({
      data: {
        propertyId: property.id, type: "cleaning", title: "Temizlik", status: "todo", priority: "standard", assignedToId: staff.id,
        checklistJson: JSON.stringify(ITEMS.map((label) => ({ label, done: false }))),
      },
    });
    ids = { org: org.id, staff: staff.id, owner: owner.id, task: task.id };
  });

  it("🚨 yönetici 1. maddeyi, personel 2. maddeyi işaretler → İKİSİ de işaretli kalır", async () => {
    asOwner();
    expect((await PATCH(req({ checklistToggle: { index: 0, label: "Madde 1", done: true } }), ctx())).status).toBe(200);
    asStaff();
    expect((await PATCH(req({ checklistToggle: { index: 1, label: "Madde 2", done: true } }), ctx())).status).toBe(200);
    const list = await stored();
    expect(list[0].done).toBe(true); // ⬅️ ESKİ panoda (tam liste) ikinci yazan birinciyi siliyordu
    expect(list[1].done).toBe(true);
    expect(list.filter((x) => x.done)).toHaveLength(2);
  });

  it("🚨 GERÇEK EŞZAMANLILIK: 12 madde aynı anda ayrı isteklerle işaretlenir → 12'si de işaretli", async () => {
    asStaff();
    const res = await Promise.all(ITEMS.map((label, index) => PATCH(req({ checklistToggle: { index, label, done: true } }), ctx())));
    expect(res.map((r) => r.status)).toEqual(ITEMS.map(() => 200));
    expect((await stored()).every((x) => x.done)).toBe(true); // ⬅️ kilitsiz okumada bazı işaretler kaybolur
  });

  it("🚨 liste arada değişti (yönetici sırayı değiştirdi) → personelin bayat işareti 409, hiçbir madde değişmez", async () => {
    const swapped = [...ITEMS];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    await prisma.task.update({ where: { id: ids.task }, data: { checklistJson: JSON.stringify(swapped.map((label) => ({ label, done: false }))) } });
    asStaff();
    const res = await PATCH(req({ checklistToggle: { index: 0, label: "Madde 1", done: true } }), ctx());
    expect(res.status).toBe(409);
    expect((await stored()).every((x) => !x.done)).toBe(true); // ⬅️ eski sırayla "Madde 2" işaretlenirdi
    // Tam liste gönderen bayat form da aynı: işaret başka maddeye DÜŞMEZ.
    const stale = ITEMS.map((label, i) => ({ label, done: i === 0 }));
    expect((await PATCH(req({ checklist: stale }), ctx())).status).toBe(409);
    expect((await stored()).every((x) => !x.done)).toBe(true);
  });

  it("liste + tek madde birlikte gönderilemez (400)", async () => {
    asOwner();
    const res = await PATCH(
      req({ checklist: ITEMS.map((label) => ({ label, done: true })), checklistToggle: { index: 0, label: "Madde 1", done: true } }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it("KONTROL: işaret geri alınabilir; başka kişiye atanmış görevde personel yine 403; yönetici tam listeyi yazabilir", async () => {
    asStaff();
    expect((await PATCH(req({ checklistToggle: { index: 2, label: "Madde 3", done: true } }), ctx())).status).toBe(200);
    expect((await PATCH(req({ checklistToggle: { index: 2, label: "Madde 3", done: false } }), ctx())).status).toBe(200);
    expect((await stored())[2].done).toBe(false);
    await prisma.task.update({ where: { id: ids.task }, data: { assignedToId: ids.owner } });
    expect((await PATCH(req({ checklistToggle: { index: 0, label: "Madde 1", done: true } }), ctx())).status).toBe(403);
    asOwner();
    expect((await PATCH(req({ checklist: [{ label: "Yeni", done: false }] }), ctx())).status).toBe(200);
    expect(await stored()).toEqual([{ label: "Yeni", done: false }]);
  });
});
