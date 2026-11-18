import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// E2 (Codex 11-17, kurucu 11-18 "Elle görev oluşturma hâlâ tekrar güvenli değil"): form başarılı cevabı ağda kaybedip AYNI isteği yeniden
// gönderince ikinci görev açılıyordu (düğme kilidi yalnız aynı sekmedeki eşzamanlı basışı önler). Sözleşme (bu dosya pinler):
//  1. Aynı işletme + aynı istek kimliği → TEK görev; ikinci istek aynı görevi döndürür (ardışık ve eşzamanlı).
//  2. Kimliksiz istek bugünkü gibi her seferinde yeni görev (aşırı uygulama yok).
//  3. Başka işletmenin aynı kimliği KENDİ görevini açar (kimlik işletme kapsamında).
//  4. Aynı kimlik, farklı görev (daire / tür / başlık) → var olan doğrulama yolu (400 "Geçersiz istek"); görev açılmaz.
//  5. Yanıtta iç anahtar (`dedupeKey`) yok.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as createTaskRoute, GET as listTasksRoute } from "@/app/api/tasks/route";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[id]/route";
import { emailService } from "@/lib/email";
import { __manualTaskHooks } from "@/lib/tasks/manual-request";

const REQ_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function post(body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return createTaskRoute(req, { params: Promise.resolve({} as Record<string, never>) });
}

describe("POST /api/tasks — istek kimliğiyle tekrar güvenliği (E2)", () => {
  let orgId: string;
  let propertyId: string;
  let staffId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    const owner = await prisma.user.create({
      data: { organizationId: orgId, name: "Sahip", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    const staff = await prisma.user.create({
      data: { organizationId: orgId, name: "Ayşe", email: "ayse@x.com", passwordHash: "x", role: "staff" },
    });
    staffId = staff.id;
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "Sahip", sessionEpoch: 0 };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __manualTaskHooks.afterPriorRead = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const body = () => ({
    propertyId,
    type: "cleaning",
    title: "Balkonu yıka",
    status: "todo",
    priority: "standard",
    assignedToId: staffId,
    requestId: REQ_ID,
  });

  it("🚨 KIRMIZI-ÖNCE: cevap kaybolup aynı istek yeniden gönderilince İKİNCİ görev açılmaz; ikinci yanıt aynı görev", async () => {
    const first = await post(body());
    expect(first.status).toBe(201);
    const a = (await first.json()) as { id: string };
    const second = await post(body());
    expect(second.ok).toBe(true);
    const b = (await second.json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 KIRMIZI-ÖNCE: aynı kimlikle EŞZAMANLI iki istek → tek görev, iki yanıt aynı kimliği taşır", async () => {
    const [r1, r2] = await Promise.all([post(body()), post(body())]);
    expect(r1.ok && r2.ok).toBe(true);
    const [a, b] = (await Promise.all([r1.json(), r2.json()])) as { id: string }[];
    expect(a.id).toBe(b.id);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 eşzamanlılık şansa kalmaz: 'var mı?' okumasından sonra iki istek de bekletilir — kilit varken ikincisi kilitte bekler, yine tek görev", async () => {
    // Engel: iki istek de okumayı geçerse (kilit yoksa) ikisi birlikte bırakılır → iki görev. Kilit varken ikincisi okumaya hiç varamaz;
    // birincisi 700 ms sonra tek başına devam eder.
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    __manualTaskHooks.afterPriorRead = async () => {
      arrived += 1;
      if (arrived >= 2) release();
      await Promise.race([gate, new Promise((r) => setTimeout(r, 700))]);
    };
    const [r1, r2] = await Promise.all([post(body()), post(body())]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(arrived).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("bitmiş görev de tekrar sayılır (durum süzgeci yok): görev arada 'Tamamlandı' olsa da tekrar istek yeni görev açmaz", async () => {
    const a = (await (await post(body())).json()) as { id: string };
    await prisma.task.update({ where: { id: a.id }, data: { status: "done", assignedToId: null } });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(a.id);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("KONTROL — kimliksiz iki istek bugünkü gibi iki görev açar", async () => {
    const { requestId: _omit, ...noId } = body();
    void _omit;
    expect((await post(noId)).status).toBe(201);
    expect((await post(noId)).status).toBe(201);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("KONTROL — farklı kimlikli iki istek iki görev açar (kimlik içerikten değil istekten)", async () => {
    expect((await post(body())).status).toBe(201);
    expect((await post({ ...body(), requestId: "ffffffffffffffffffffffffffffffff" })).status).toBe(201);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("kiracı: başka işletmenin AYNI kimliği kendi görevini açar (bu işletmenin görevi dönmez)", async () => {
    expect((await post(body())).status).toBe(201);
    const other = await makeOrgWithProperty();
    const otherOwner = await prisma.user.create({
      data: { organizationId: other.orgId, name: "Diğer", email: "d@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: otherOwner.id, organizationId: other.orgId, role: "owner", email: "d@x.com", name: "Diğer", sessionEpoch: 0 };
    const res = await post({ ...body(), propertyId: other.propertyId, assignedToId: "" });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; propertyId: string };
    expect(created.propertyId).toBe(other.propertyId);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId: other.propertyId } })).toBe(1);
  });

  it("aynı kimlik, FARKLI başlık → var olan doğrulama yolu (400 'Geçersiz istek'), ikinci görev yok", async () => {
    expect((await post(body())).status).toBe(201);
    const res = await post({ ...body(), title: "Mutfağı sil" });
    expect(res.status).toBe(400);
    const out = (await res.json()) as { fields?: Record<string, string> };
    expect(out.fields?.requestId).toBe("Geçersiz istek");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("yanıtta iç anahtar yok: ilk (201) ve tekrar (200) yanıtında `dedupeKey` alanı bulunmaz", async () => {
    const first = (await (await post(body())).json()) as Record<string, unknown>;
    const again = (await (await post(body())).json()) as Record<string, unknown>;
    expect("dedupeKey" in first).toBe(false);
    expect("dedupeKey" in again).toBe(false);
  });

  it("BİLİNEN SINIR (bilinçli): görev açıldıktan sonra başlığı düzenlendiyse aynı isteğin tekrarı 400 görür; ikinci görev YOK", async () => {
    const a = (await (await post(body())).json()) as { id: string };
    await prisma.task.update({ where: { id: a.id }, data: { title: "Balkonu ve camları yıka" } });
    const res = await post(body());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields?: Record<string, string> }).fields?.requestId).toBe("Geçersiz istek");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("silinmiş görev: kayıt kalmadığı için aynı kimliğin tekrarı YENİ görev açar (201)", async () => {
    const a = (await (await post(body())).json()) as { id: string };
    await prisma.task.delete({ where: { id: a.id } });
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).not.toBe(a.id);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("iç anahtar liste (yönetici + personel) ve güncelleme yanıtına da girmez", async () => {
    const a = (await (await post(body())).json()) as { id: string };
    const list = (await (await listTasksRoute(new NextRequest("http://localhost/api/tasks"), { params: Promise.resolve({} as Record<string, never>) })).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect("dedupeKey" in list[0]).toBe(false);
    const patched = await patchTaskRoute(
      new NextRequest(`http://localhost/api/tasks/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ priority: "urgent" }) }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(patched.status).toBe(200);
    expect("dedupeKey" in ((await patched.json()) as Record<string, unknown>)).toBe(false);
    session = { userId: staffId, organizationId: orgId, role: "staff", email: "ayse@x.com", name: "Ayşe", sessionEpoch: 0 };
    const staffList = (await (await listTasksRoute(new NextRequest("http://localhost/api/tasks"), { params: Promise.resolve({} as Record<string, never>) })).json()) as Record<string, unknown>[];
    expect(staffList).toHaveLength(1);
    expect("dedupeKey" in staffList[0]).toBe(false);
    // Satırda anahtar gerçekten var (ayıklama boşa test edilmiyor).
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).dedupeKey).toBe(`manual-req:${orgId}:${REQ_ID}`);
  });

  it("bildirim: tekrarlanan istek e-posta göndermez (oluşturma rotası atama e-postası göndermiyor — iki istekte de sıfır)", async () => {
    const send = vi.spyOn(emailService, "send");
    const sendReporting = vi.spyOn(emailService, "sendReporting");
    await post(body());
    await post(body());
    expect(send).not.toHaveBeenCalled();
    expect(sendReporting).not.toHaveBeenCalled();
  });

  it("biçimsiz kimlik reddedilir (KB / söz kimliğiyle aynı biçim)", async () => {
    const res = await post({ ...body(), requestId: "kısa" });
    expect(res.status).toBe(400);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(0);
  });
});
