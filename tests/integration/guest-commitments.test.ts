import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// AÇIK TAAHHÜT HAFIZASI A (kurucu kararı 10-10; migration 62). Söz YALNIZ ev sahibinin açık işaretinden doğar (metin yok), bir göreve
// bağlanır; görev bitince söz kapanır, geri açılınca açılır, silinince iptal olur; açık söz "Dikkat Gerektirenler"de görünür. Misafire
// hiçbir şey GÖNDERİLMEZ. Gerçek PostgreSQL.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as createPost } from "@/app/api/conversations/[id]/commitments/route";
import { PATCH as commitmentPatch } from "@/app/api/conversations/[id]/commitments/[commitmentId]/route";
import { PATCH as taskPatch, DELETE as taskDelete } from "@/app/api/tasks/[id]/route";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { commitmentDueAt, commitmentDurationLabel } from "@/lib/guest-commitments-core";
import { __commitmentHooks } from "@/lib/guest-commitments";
import { lockProbe } from "../helpers/lock-probe";

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function setup(role: "owner" | "staff" = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Istanbul" } });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "Ev Sahibi", email: `h-${orgId}@x.com`, passwordHash: "x", role } });
  const conversation = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir" } });
  session = { userId: user.id, organizationId: orgId, role, email: user.email, name: user.name, sessionEpoch: 0 };
  return { orgId, propertyId, conversationId: conversation.id, userId: user.id };
}
const create = (conversationId: string, body: unknown) =>
  createPost(json(`http://localhost/api/conversations/${conversationId}/commitments`, "POST", body), {
    params: Promise.resolve({ id: conversationId }),
  });
const setTask = (id: string, status: string) =>
  taskPatch(json(`http://localhost/api/tasks/${id}`, "PATCH", { status }), { params: Promise.resolve({ id }) });

describe("söz anı ve süre metni (saf)", () => {
  it("bugün / yarın + saat işletmenin saat diliminde mutlak ana çevrilir; geçersiz saat → null", () => {
    const now = new Date("2026-10-10T10:00:00Z"); // İstanbul 13:00
    expect(commitmentDueAt({ day: "today", time: "18:00" }, "Europe/Istanbul", now)?.toISOString()).toBe("2026-10-10T15:00:00.000Z");
    expect(commitmentDueAt({ day: "tomorrow", time: "09:30" }, "Europe/Istanbul", now)?.toISOString()).toBe("2026-10-11T06:30:00.000Z");
    // Gece yarısını geçmiş UTC anında "bugün" yerel gündür (İstanbul 10-11 01:00).
    expect(commitmentDueAt({ day: "today", time: "10:00" }, "Europe/Istanbul", new Date("2026-10-10T22:00:00Z"))?.toISOString()).toBe(
      "2026-10-11T07:00:00.000Z",
    );
    expect(commitmentDueAt({ day: "today", time: "24:00" }, "Europe/Istanbul", now)).toBeNull();
    expect(commitmentDueAt({ day: "today", time: "8:00" }, "Europe/Istanbul", now)).toBeNull();
  });

  it("süre metni: dakika / saat + dakika / tam saat; eksi değer mutlak", () => {
    expect(commitmentDurationLabel(30)).toBe("30 dk");
    expect(commitmentDurationLabel(134)).toBe("2 sa 14 dk");
    expect(commitmentDurationLabel(120)).toBe("2 sa");
    expect(commitmentDurationLabel(-45)).toBe("45 dk");
  });
});

describe("söz işaretleme (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  it("🚨 söz + bağlı görev TEK işlemde: görev türü söze göre, kökeni 'manual', son an işletme saatinde; denetim kaydı; misafire mesaj GİTMEZ", async () => {
    const s = await setup();
    const res = await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; taskId: string; dueAt: string };
    const c = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: body.id } });
    expect(c).toMatchObject({ organizationId: s.orgId, conversationId: s.conversationId, kind: "towels", status: "open", taskId: body.taskId });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: body.taskId } });
    expect(task).toMatchObject({ propertyId: s.propertyId, type: "laundry", origin: "manual", status: "todo", title: "Misafire söz: Havlu / çarşaf" });
    expect(task.dueAt?.toISOString()).toBe(c.dueAt.toISOString());
    expect(c.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })).toBe("18:00");
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "commitment.created" } })).toBe(1);
    expect(await prisma.message.count()).toBe(0);
  });

  it("KONTROL: geçersiz tür / gün / saat ve geçmiş saat 400 (saat SABİT — gece yarısı atlanmaz); başka işletmenin konuşması 404; hiçbir şey yazılmaz", async () => {
    const s = await setup();
    expect((await create(s.conversationId, { kind: "wine", day: "today", time: "18:00" })).status).toBe(400);
    expect((await create(s.conversationId, { kind: "towels", day: "someday", time: "18:00" })).status).toBe(400);
    expect((await create(s.conversationId, { kind: "towels", day: "today", time: "25:00" })).status).toBe(400);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z")); // İstanbul 15:00
    try {
      const r = await create(s.conversationId, { kind: "towels", day: "today", time: "13:00" });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { fields: Record<string, string> }).fields.time).toBe("Geçmiş bir saat seçilemez.");
      expect((await create(s.conversationId, { kind: "towels", day: "today", time: "14:57" })).status).toBe(201); // 5 dk pay içinde
    } finally {
      vi.useRealTimers();
    }
    await prisma.guestCommitment.deleteMany();
    await prisma.task.deleteMany();
    const ownerA = session!;
    const other = await setup(); // B'nin konuşması
    session = ownerA; // A'nın KENDİ oturumu
    expect((await create(other.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" })).status).toBe(404);
    expect(await prisma.guestCommitment.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });

  it("🚨 görevi bitiren PERSONEL de sözü kapatır (görev kendisine atalı)", async () => {
    const s = await setup();
    const a = (await (await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" })).json()) as { id: string; taskId: string };
    const staff = await prisma.user.create({ data: { organizationId: s.orgId, name: "Temizlikçi", email: `st-${s.orgId}@x.com`, passwordHash: "x", role: "staff" } });
    await prisma.task.update({ where: { id: a.taskId }, data: { assignedToId: staff.id } });
    session = { userId: staff.id, organizationId: s.orgId, role: "staff", email: staff.email, name: staff.name, sessionEpoch: 0 };
    expect((await setTask(a.taskId, "done")).status).toBe(200);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("done");
  });

  it("🚨 görevin saati değişince AÇIK söz yeni saati izler; kapanmış söz değişmez", async () => {
    const s = await setup();
    const a = (await (await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" })).json()) as { id: string; taskId: string };
    const later = new Date(Date.now() + 3 * 86_400_000);
    const res = await taskPatch(json(`http://localhost/api/tasks/${a.taskId}`, "PATCH", { dueAt: later.toISOString() }), {
      params: Promise.resolve({ id: a.taskId }),
    });
    expect(res.status).toBe(200);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } })).dueAt.toISOString()).toBe(later.toISOString());
    await setTask(a.taskId, "done");
    const evenLater = new Date(Date.now() + 5 * 86_400_000);
    await taskPatch(json(`http://localhost/api/tasks/${a.taskId}`, "PATCH", { dueAt: evenLater.toISOString() }), { params: Promise.resolve({ id: a.taskId }) });
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } })).dueAt.toISOString()).toBe(later.toISOString());
  });

  it("🚨 aynı söz EŞ ZAMANLI 3 kez (çift tıklama / kopan bağlantı) → TEK söz + TEK görev; farklı saat ayrı söz (idempotency denetimi 10-15)", async () => {
    const s = await setup();
    const body = { kind: "towels", day: "tomorrow", time: "18:00" };
    const rs = await Promise.all([create(s.conversationId, body), create(s.conversationId, body), create(s.conversationId, body)]);
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    const ids = await Promise.all(rs.map(async (r) => ((await r.json()) as { id: string; taskId: string })));
    expect(new Set(ids.map((x) => x.id)).size).toBe(1);
    expect(new Set(ids.map((x) => x.taskId)).size).toBe(1);
    expect(await prisma.guestCommitment.count({ where: { conversationId: s.conversationId } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId: s.propertyId } })).toBe(1);
    // Aşırı uygulama yok: farklı saat / farklı tür bilinçli yeni sözdür.
    expect((await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "19:00" })).status).toBe(201);
    expect((await create(s.conversationId, { kind: "supplies", day: "tomorrow", time: "18:00" })).status).toBe(201);
    expect(await prisma.guestCommitment.count({ where: { conversationId: s.conversationId } })).toBe(3);
  });

  it("🚨 BELİRLENİMCİ (Opus B8): aynı konuşmada kilitli bölgeye aynı anda yalnız bir söz isteği girer; kilit kaldırılırsa her koşuda çift söz", async () => {
    const s = await setup();
    const probe = lockProbe();
    __commitmentHooks.afterSameCheck = probe.hook;
    try {
      const body = { kind: "towels", day: "tomorrow", time: "18:00" };
      await Promise.all([create(s.conversationId, body), create(s.conversationId, body)]);
      expect(probe.maxInside()).toBe(1);
    } finally {
      __commitmentHooks.afterSameCheck = null;
    }
    expect(await prisma.guestCommitment.count({ where: { conversationId: s.conversationId } })).toBe(1);
  });

  it("🚨 personel söz veremez (403, yalnız yönetici)", async () => {
    const s = await setup("staff");
    expect((await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" })).status).toBe(403);
    expect(await prisma.guestCommitment.count()).toBe(0);
  });

  it("🚨 görev tamamlanınca söz kapanır; görev geri açılınca söz açılır; iptal edilmiş söz görev tamamlanınca da iptal kalır", async () => {
    const s = await setup();
    const a = (await (await create(s.conversationId, { kind: "cleaning", day: "tomorrow", time: "11:00" })).json()) as { id: string; taskId: string };
    expect((await setTask(a.taskId, "done")).status).toBe(200);
    const done = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } });
    expect(done.status).toBe("done");
    expect(done.closedAt).not.toBeNull();
    expect((await setTask(a.taskId, "in_progress")).status).toBe(200);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "open", closedAt: null });

    const b = (await (await create(s.conversationId, { kind: "supplies", day: "tomorrow", time: "12:00" })).json()) as { id: string; taskId: string };
    const cancel = await commitmentPatch(json("http://localhost/x", "PATCH", { status: "cancelled" }), {
      params: Promise.resolve({ id: s.conversationId, commitmentId: b.id }),
    });
    expect(cancel.status).toBe(200);
    expect(await prisma.task.count({ where: { id: b.taskId } })).toBe(1); // görev silinmez
    await setTask(b.taskId, "done");
    await setTask(b.taskId, "todo");
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("cancelled");
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "commitment.cancelled" } })).toBe(1);
  });

  it("🚨 görev silinince bağlı açık söz İPTAL olur (görevsiz açık söz kalmaz)", async () => {
    const s = await setup();
    const a = (await (await create(s.conversationId, { kind: "maintenance", day: "tomorrow", time: "10:00" })).json()) as { id: string; taskId: string };
    const del = await taskDelete(new NextRequest(`http://localhost/api/tasks/${a.taskId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: a.taskId }),
    });
    expect(del.status).toBe(200);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "cancelled", taskId: null });
  });

  it("KONTROL: iptal yalnız açık söz için; başka işletme / zaten iptal → 404; geçersiz işlem 400", async () => {
    const s = await setup();
    const a = (await (await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" })).json()) as { id: string };
    const patch = (status: unknown, convo = s.conversationId) =>
      commitmentPatch(json("http://localhost/x", "PATCH", { status }), { params: Promise.resolve({ id: convo, commitmentId: a.id }) });
    expect((await patch("done")).status).toBe(400);
    const owner = session!;
    await setup();
    expect((await patch("cancelled")).status).toBe(404); // başka işletmenin oturumu
    session = owner;
    expect((await patch("cancelled")).status).toBe(200);
    expect((await patch("cancelled")).status).toBe(404);
  });

  it("konuşma silinince sözleri de gider (metin yok, iz kalmaz)", async () => {
    const s = await setup();
    await create(s.conversationId, { kind: "towels", day: "tomorrow", time: "18:00" });
    await prisma.conversation.delete({ where: { id: s.conversationId } });
    expect(await prisma.guestCommitment.count()).toBe(0);
  });
});

describe("Dikkat Gerektirenler — söz satırı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  const now = new Date("2026-10-10T12:00:00Z"); // İstanbul 15:00
  async function commitment(s: { orgId: string; conversationId: string }, dueAt: Date, status = "open") {
    return prisma.guestCommitment.create({ data: { organizationId: s.orgId, conversationId: s.conversationId, kind: "towels", dueAt, status } });
  }

  it("🚨 geciken söz üstte (önem 96, kalan dakika eksi), yaklaşan 89, uzaktaki 60; saat işletmenin saatiyle; bağlantı konuşmaya", async () => {
    const s = await setup();
    await commitment(s, new Date("2026-10-10T11:30:00Z")); // 30 dk gecikti (14:30)
    await commitment(s, new Date("2026-10-10T13:00:00Z")); // 60 dk kaldı (16:00)
    await commitment(s, new Date("2026-10-11T06:00:00Z")); // yarın 09:00 (18 sa)
    const rows = (await findAttentionItems(s.orgId, { now })).filter((i) => i.kind === "commitment_due");
    expect(rows.map((r) => [r.severity, r.minutesLeft, r.commitmentTime])).toEqual([
      [96, -30, "14:30"],
      [89, 60, "16:00"],
      [60, 1080, "yarın 09:00"],
    ]);
    expect(rows[0]).toMatchObject({ certainty: "observed", commitmentKind: "towels", href: `/inbox/${s.conversationId}` });
  });

  it("🚨 eski gecikmiş söz tarihle gösterilir (her geçmiş gün 'dün' değil); 48 saatten eskisi listeye girmez; en fazla 3 söz satırı", async () => {
    const s = await setup();
    await commitment(s, new Date("2026-10-08T09:00:00Z")); // 51 sa önce — pencere dışı
    await commitment(s, new Date("2026-10-08T13:00:00Z")); // 47 sa önce → "8 Eki 16:00"
    await commitment(s, new Date("2026-10-09T07:00:00Z")); // dün 10:00
    await commitment(s, new Date("2026-10-10T11:00:00Z")); // bugün 14:00
    await commitment(s, new Date("2026-10-10T13:00:00Z")); // 4. satır — tavan dışı
    const rows = (await findAttentionItems(s.orgId, { now })).filter((i) => i.kind === "commitment_due");
    expect(rows.map((r) => r.commitmentTime)).toEqual(["8 Eki 16:00", "dün 10:00", "14:00"]);
  });

  it("KONTROL: kapanmış / iptal söz ve 24 saatten uzak söz satır üretmez (sakin gün boş kalır)", async () => {
    const s = await setup();
    await commitment(s, new Date("2026-10-10T11:00:00Z"), "done");
    await commitment(s, new Date("2026-10-10T11:00:00Z"), "cancelled");
    await commitment(s, new Date("2026-10-12T12:00:00Z")); // 48 sa sonra
    expect((await findAttentionItems(s.orgId, { now })).filter((i) => i.kind === "commitment_due")).toEqual([]);
  });

  it("KONTROL: başka işletmenin sözü görünmez", async () => {
    const a = await setup();
    const b = await setup();
    await commitment(b, new Date("2026-10-10T11:00:00Z"));
    expect((await findAttentionItems(a.orgId, { now })).filter((i) => i.kind === "commitment_due")).toEqual([]);
  });
});
