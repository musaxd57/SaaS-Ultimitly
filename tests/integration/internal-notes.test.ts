import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// İÇ NOT — dilim D1 (tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.1; kurucu 11-18 akşam: "Telefon görüşmesini
// kaydetmek → Konaklamada İç not ekle. Konaklama yoksa daireye not. Sırf not için misafir sohbeti açılmaz."). Gerçek PostgreSQL.
// Sabitlenen: ekle / listele / sil · kiracı kapsamı · personel 403 · bürünme yazamaz · bağ sunucuda çözülür · NOT MESAJ DEĞİLDİR (mesaj,
// konuşma satırı, öğe, söz, görev değişmez) · çift tıklama tek satır (eşzamanlı + tekil dizin yolu) · silme yetkisi · 1.000 sınırı ·
// tanınmayan alan · sayfalama · hız sınırı. Veritabanı arızası ayrı dosyada (`internal-notes-db-failure.test.ts`).
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { __resetRateLimit } from "@/lib/rate-limit";
import { GET as listGet, POST as createPost } from "@/app/api/internal-notes/route";
import { DELETE as noteDelete } from "@/app/api/internal-notes/[id]/route";
import { __internalNoteHooks } from "@/lib/internal-notes/service";
import { UNRECOGNIZED_FIELD_MESSAGE } from "@/lib/zod-tr";

const RID = (c: string) => c.repeat(32).slice(0, 32);

const post = (body: unknown) =>
  createPost(
    new NextRequest("http://localhost/api/internal-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
const list = (qs: string) => listGet(new NextRequest(`http://localhost/api/internal-notes?${qs}`), { params: Promise.resolve({}) });
const del = (id: string) =>
  noteDelete(new NextRequest(`http://localhost/api/internal-notes/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

type NoteJson = { id: string; body: string; authorName: string; createdAt: string; canDelete: boolean };

async function world(role: "owner" | "manager" | "staff" = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const otherProperty = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe Sahip", email: `o-${orgId}@x.com`, passwordHash: "x", role } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Ada Lale", arrivalDate: stayDay(1), departureDate: stayDay(3), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ada", status: "waiting", lastMessageAt: new Date(Date.now() - 3_600_000) },
  });
  const bare = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Can", status: "new" } });
  session = { userId: user.id, organizationId: orgId, role, email: user.email, name: user.name, sessionEpoch: 0 };
  return { orgId, propertyId, otherPropertyId: otherProperty.id, userId: user.id, reservationId: reservation.id, conversationId: conversation.id, bareId: bare.id };
}

async function member(orgId: string, role: "owner" | "manager" | "staff", name: string) {
  const u = await prisma.user.create({ data: { organizationId: orgId, name, email: `${role}-${name.length}-${orgId}@x.com`, passwordHash: "x", role } });
  return { userId: u.id, organizationId: orgId, role, email: u.email, name: u.name, sessionEpoch: 0 } satisfies SessionPayload;
}

describe("iç not (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    __internalNoteHooks.afterReplayCheck = null;
  });
  afterEach(() => {
    __internalNoteHooks.afterReplayCheck = null;
  });

  it("🚨 konuşmadan ekle: daire ve konaklama KONUŞMADAN; yazan adı kopyalanır; denetim kaydı METİNSİZ; liste yeniden eskiye", async () => {
    const w = await world();
    const r1 = await post({ conversationId: w.conversationId, body: "  Misafir telefonla aradı, 23:00'te gelecek.  " });
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { note: NoteJson; reused: boolean };
    expect(b1.reused).toBe(false);
    expect(b1.note).toMatchObject({ body: "Misafir telefonla aradı, 23:00'te gelecek.", authorName: "Ayşe Sahip", canDelete: true });
    expect(Object.keys(b1.note).sort()).toEqual(["authorName", "body", "canDelete", "createdAt", "id"]);
    const row = await prisma.internalNote.findUniqueOrThrow({ where: { id: b1.note.id } });
    expect(row).toMatchObject({ organizationId: w.orgId, propertyId: w.propertyId, reservationId: w.reservationId, conversationId: w.conversationId, authorUserId: w.userId });
    const audits = await prisma.auditLog.findMany({ where: { organizationId: w.orgId, action: "internal_note.create" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadataJson).not.toContain("telefon");
    expect(JSON.parse(audits[0]!.metadataJson!)).toMatchObject({ noteId: b1.note.id, propertyId: w.propertyId, reservationId: w.reservationId });

    // Kişi adını sonradan değiştirse de eski not eski adla kalır (kopya); yeni not yeni adı alır.
    await prisma.user.update({ where: { id: w.userId }, data: { name: "Ayşe Y." } });
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await post({ conversationId: w.conversationId, body: "İkinci not" });
    expect(r2.status).toBe(201);
    const l = (await (await list(`conversationId=${w.conversationId}`)).json()) as { notes: NoteJson[]; nextCursor: string | null };
    expect(l.notes.map((n) => [n.body, n.authorName])).toEqual([
      ["İkinci not", "Ayşe Y."],
      ["Misafir telefonla aradı, 23:00'te gelecek.", "Ayşe Sahip"],
    ]);
    expect(l.nextCursor).toBeNull();
    // Aynı konaklamaya konaklama kimliğiyle bakınca da aynı notlar.
    const byRes = (await (await list(`reservationId=${w.reservationId}`)).json()) as { notes: NoteJson[] };
    expect(byRes.notes).toHaveLength(2);
  });

  it("🚨 bağ SUNUCUDA çözülür: konuşmayla birlikte gönderilen yanlış daire / konaklama yok sayılır; konaklama → daire konaklamadan; yalnız daire → konaklamasız", async () => {
    const w = await world();
    const otherRes = await prisma.reservation.create({
      data: { propertyId: w.otherPropertyId, guestName: "Başka", arrivalDate: stayDay(5), departureDate: stayDay(7), status: "confirmed", channel: "airbnb" },
    });
    const a = (await (await post({ conversationId: w.conversationId, propertyId: w.otherPropertyId, reservationId: otherRes.id, body: "a" })).json()) as { note: NoteJson };
    expect(await prisma.internalNote.findUniqueOrThrow({ where: { id: a.note.id } })).toMatchObject({ propertyId: w.propertyId, reservationId: w.reservationId, conversationId: w.conversationId });
    const b = (await (await post({ reservationId: otherRes.id, propertyId: w.propertyId, body: "b" })).json()) as { note: NoteJson };
    expect(await prisma.internalNote.findUniqueOrThrow({ where: { id: b.note.id } })).toMatchObject({ propertyId: w.otherPropertyId, reservationId: otherRes.id, conversationId: null });
    const c = (await (await post({ propertyId: w.otherPropertyId, body: "c" })).json()) as { note: NoteJson };
    expect(await prisma.internalNote.findUniqueOrThrow({ where: { id: c.note.id } })).toMatchObject({ propertyId: w.otherPropertyId, reservationId: null, conversationId: null });
    // Daire listesi: yalnız konaklamasız daire notları.
    const p = (await (await list(`propertyId=${w.otherPropertyId}`)).json()) as { notes: NoteJson[] };
    expect(p.notes.map((n) => n.body)).toEqual(["c"]);
    // Hiç hedef yok → 400, yazılmaz.
    expect((await post({ body: "hedefsiz" })).status).toBe(400);
    expect((await list("")).status).toBe(400);
    expect(await prisma.internalNote.count()).toBe(3);
  });

  it("konaklamasız konuşma: yalnız o konuşmadan yazılan notlar; konuşma sonradan konaklamaya bağlanınca eski not kaybolmaz", async () => {
    const w = await world();
    await post({ conversationId: w.bareId, body: "bare-1" });
    await post({ propertyId: w.propertyId, body: "daire notu" });
    await post({ conversationId: w.conversationId, body: "konaklama notu" });
    const l1 = (await (await list(`conversationId=${w.bareId}`)).json()) as { notes: NoteJson[] };
    expect(l1.notes.map((n) => n.body)).toEqual(["bare-1"]);
    // Konuşma şimdi konaklamaya bağlandı: konaklamanın notları + bu konuşmadan önceden yazılan konaklamasız not.
    await prisma.conversation.update({ where: { id: w.bareId }, data: { reservationId: w.reservationId } });
    const l2 = (await (await list(`conversationId=${w.bareId}`)).json()) as { notes: NoteJson[] };
    expect(l2.notes.map((n) => n.body).sort()).toEqual(["bare-1", "konaklama notu"]);
  });

  it("🚨 NOT MESAJ DEĞİLDİR: mesaj yazılmaz; konuşma satırı (lastMessageAt, status, cevap damgaları, sıra) aynen; öğe / söz / görev değişmez", async () => {
    const w = await world();
    const m = await prisma.message.create({
      data: { conversationId: w.conversationId, direction: "inbound", authorType: "guest", senderName: "Ada", body: "Havlu lazım", createdAt: new Date(Date.now() - 3_600_000) },
    });
    await prisma.conversationItem.create({
      data: {
        organizationId: w.orgId,
        conversationId: w.conversationId,
        messageId: m.id,
        kind: "towels",
        sensitivity: "none",
        sources: "lexical",
        status: "pending_host",
      },
    });
    const before = {
      conv: await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } }),
      bare: await prisma.conversation.findUniqueOrThrow({ where: { id: w.bareId } }),
      items: await prisma.conversationItem.findMany({ orderBy: { id: "asc" } }),
      messages: await prisma.message.count(),
      commitments: await prisma.guestCommitment.count(),
      tasks: await prisma.task.count(),
      outbox: await prisma.messageOutbox.count(),
    };
    expect((await post({ conversationId: w.conversationId, body: "Misafire havluyu kapıda verdim." })).status).toBe(201);
    expect((await post({ conversationId: w.bareId, body: "Saat 18:00'de arayacağım, söz verdim." })).status).toBe(201);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } })).toEqual(before.conv);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: w.bareId } })).toEqual(before.bare);
    expect(await prisma.conversationItem.findMany({ orderBy: { id: "asc" } })).toEqual(before.items);
    expect(await prisma.message.count()).toBe(before.messages);
    expect(await prisma.guestCommitment.count()).toBe(before.commitments);
    expect(await prisma.task.count()).toBe(before.tasks);
    expect(await prisma.messageOutbox.count()).toBe(before.outbox);
    // Silmek de hiçbir şeye dokunmaz.
    const id = (await prisma.internalNote.findFirstOrThrow({ where: { conversationId: w.conversationId } })).id;
    expect((await del(id)).status).toBe(200);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: w.conversationId } })).toEqual(before.conv);
    expect(await prisma.conversationItem.findMany({ orderBy: { id: "asc" } })).toEqual(before.items);
  });

  it("🚨 kiracı kapsamı: başka işletmenin konuşması / konaklaması / dairesi / notu 404; hiçbir şey yazılmaz ya da silinmez", async () => {
    const b = await world();
    const bNote = (await (await post({ conversationId: b.conversationId, body: "B'nin notu" })).json()) as { note: NoteJson };
    const a = await world(); // oturum artık A'nın sahibi
    for (const target of [{ conversationId: b.conversationId }, { reservationId: b.reservationId }, { propertyId: b.propertyId }]) {
      expect((await post({ ...target, body: "sızma" })).status).toBe(404);
    }
    expect(await prisma.internalNote.count({ where: { organizationId: a.orgId } })).toBe(0);
    expect((await list(`conversationId=${b.conversationId}`)).status).toBe(404);
    expect((await list(`reservationId=${b.reservationId}`)).status).toBe(404);
    expect((await list(`propertyId=${b.propertyId}`)).status).toBe(404);
    expect((await del(bNote.note.id)).status).toBe(404);
    expect(await prisma.internalNote.count({ where: { id: bNote.note.id } })).toBe(1);
    // Başka işletmenin notunu imleç yapmak da onun sayfasını açmaz.
    const own = (await (await list(`conversationId=${a.conversationId}&cursor=${bNote.note.id}`)).json()) as { notes: NoteJson[] };
    expect(own.notes).toEqual([]);
    // Aynı istek kimliği başka işletmede kendi notunu açar (tekillik işletme kapsamında).
    expect((await post({ conversationId: a.conversationId, body: "x", requestId: RID("a") })).status).toBe(201);
    session = await member(b.orgId, "owner", "B Sahip");
    expect((await post({ conversationId: b.conversationId, body: "y", requestId: RID("a") })).status).toBe(201);
  });

  it("🚨 personel 403 (liste, ekle, sil); bürünme (destek görünümü) yazamaz ama okur", async () => {
    const w = await world();
    const note = (await (await post({ conversationId: w.conversationId, body: "sahibin notu" })).json()) as { note: NoteJson };
    const owner = session!;
    session = await member(w.orgId, "staff", "Temizlikçi");
    expect((await list(`conversationId=${w.conversationId}`)).status).toBe(403);
    expect((await post({ conversationId: w.conversationId, body: "personel" })).status).toBe(403);
    expect((await del(note.note.id)).status).toBe(403);
    session = { ...owner, actorUserId: "operator-1", actorEmail: "op@x.com", actorName: "Operatör" };
    expect((await post({ conversationId: w.conversationId, body: "bürünme" })).status).toBe(403);
    expect((await del(note.note.id)).status).toBe(403);
    expect((await list(`conversationId=${w.conversationId}`)).status).toBe(200);
    expect(await prisma.internalNote.findMany({ select: { body: true } })).toEqual([{ body: "sahibin notu" }]);
  });

  it("🚨 silme yetkisi: yazan siler; yönetici başkasının notunu SİLEMEZ (403, satır kalır); sahip herkesinkini siler; denetim kaydı", async () => {
    const w = await world();
    const owner = session!;
    const ownerNote = (await (await post({ conversationId: w.conversationId, body: "sahip" })).json()) as { note: NoteJson };
    const manager = await member(w.orgId, "manager", "Yönetici Mert");
    session = manager;
    const mgrNote = (await (await post({ conversationId: w.conversationId, body: "yönetici" })).json()) as { note: NoteJson };
    const mgrNote2 = (await (await post({ conversationId: w.conversationId, body: "yönetici 2" })).json()) as { note: NoteJson };
    const seen = (await (await list(`conversationId=${w.conversationId}`)).json()) as { notes: NoteJson[] };
    expect(Object.fromEntries(seen.notes.map((n) => [n.body, n.canDelete]))).toEqual({ sahip: false, yönetici: true, "yönetici 2": true });
    expect((await del(ownerNote.note.id)).status).toBe(403);
    expect(await prisma.internalNote.count({ where: { id: ownerNote.note.id } })).toBe(1);
    expect((await del(mgrNote.note.id)).status).toBe(200);
    expect((await del(mgrNote.note.id)).status).toBe(404);
    session = owner;
    expect((await del(mgrNote2.note.id)).status).toBe(200);
    expect((await del(ownerNote.note.id)).status).toBe(200);
    expect(await prisma.internalNote.count()).toBe(0);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: w.orgId, action: "internal_note.delete" }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(3);
    expect(audits.every((x) => !x.metadataJson!.includes("yönetici"))).toBe(true);
    const meta = audits.map((x) => JSON.parse(x.metadataJson!) as { noteId: string; byOwner?: boolean });
    expect(meta.find((x) => x.noteId === mgrNote2.note.id)).toMatchObject({ byOwner: true });
    expect(meta.find((x) => x.noteId === mgrNote.note.id)?.byOwner).toBeUndefined();
    expect(meta.find((x) => x.noteId === ownerNote.note.id)?.byOwner).toBeUndefined();
  });

  it("🚨 çift tıklama: AYNI istek kimliği eşzamanlı 3 kez → TEK satır, TEK denetim kaydı; yeni kimlik = yeni not", async () => {
    const w = await world();
    const body = { conversationId: w.conversationId, body: "Kapıda söylendi", requestId: RID("b") };
    const rs = await Promise.all([post(body), post(body), post(body)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const ids = await Promise.all(rs.map(async (r) => ((await r.json()) as { note: NoteJson }).note.id));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.internalNote.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "internal_note.create" } })).toBe(1);
    expect((await post({ ...body, requestId: RID("c") })).status).toBe(201);
    expect(await prisma.internalNote.count()).toBe(2);
  });

  it("🚨 yarış TEKİL DİZİNE çarpar (ön okuma ikisinde de boş): ikinci istek P2002'yi yakalar, var olan notu döndürür — tek satır", async () => {
    const w = await world();
    const body = { conversationId: w.conversationId, body: "Yarış", requestId: RID("d") };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    __internalNoteHooks.afterReplayCheck = async () => {
      calls += 1;
      if (calls === 1) await gate; // birinci istek ön okumadan SONRA bekler
    };
    const first = post(body);
    while (calls < 1) await new Promise((r) => setTimeout(r, 5));
    const second = await post(body); // ön okuma boş → yazar
    expect(second.status).toBe(201);
    release();
    const r1 = await first; // yazmaya çalışır → tekil dizin → yeniden okur
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { reused: boolean }).reused).toBe(true);
    expect(await prisma.internalNote.count()).toBe(1);
  });

  it("aynı kimlik FARKLI metin ya da bağ → 409, yeni satır yazılmaz, eski not değişmez", async () => {
    const w = await world();
    expect((await post({ conversationId: w.conversationId, body: "ilk", requestId: RID("e") })).status).toBe(201);
    const r = await post({ conversationId: w.conversationId, body: "başka", requestId: RID("e") });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("idempotency_conflict");
    expect((await post({ conversationId: w.bareId, body: "ilk", requestId: RID("e") })).status).toBe(409);
    expect(await prisma.internalNote.findMany({ select: { body: true } })).toEqual([{ body: "ilk" }]);
    // Aynı metin baş / son boşlukla gelirse aynı istektir (temizlenmiş metin kıyaslanır).
    expect((await post({ conversationId: w.conversationId, body: " ilk ", requestId: RID("e") })).status).toBe(200);
  });

  it("🚨 1.000 karakter: tam sınır kabul; 1.001 RET (kırpma yok); boş / yalnız boşluk RET; tanınmayan alan RET — hiçbiri yazılmaz", async () => {
    const w = await world();
    expect((await post({ conversationId: w.conversationId, body: "a".repeat(1000) })).status).toBe(201);
    const long = await post({ conversationId: w.conversationId, body: "a".repeat(1001) });
    expect(long.status).toBe(400);
    expect(((await long.json()) as { fields: Record<string, string> }).fields.body).toBe("Çok uzun — en fazla 1000 karakter olabilir.");
    const empty = await post({ conversationId: w.conversationId, body: "  \n " });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { fields: Record<string, string> }).fields.body).toBe("Bu alan boş bırakılamaz.");
    const extra = await post({ conversationId: w.conversationId, body: "ok", aiAssisted: true });
    expect(extra.status).toBe(400);
    expect(Object.values(((await extra.json()) as { fields: Record<string, string> }).fields)).toContain(UNRECOGNIZED_FIELD_MESSAGE);
    expect((await post({ conversationId: w.conversationId, body: "ok", requestId: "kısa" })).status).toBe(400);
    expect((await post({ conversationId: w.conversationId, body: 42 })).status).toBe(400);
    expect(await prisma.internalNote.count()).toBe(1);
  });

  it("sayfalama: yeniden eskiye en çok 50; imleçle sonraki sayfa; daha büyük `limit` 50'ye iner", async () => {
    const w = await world();
    const base = Date.now() - 100 * 60_000;
    await prisma.internalNote.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: w.orgId,
        propertyId: w.propertyId,
        reservationId: w.reservationId,
        conversationId: w.conversationId,
        authorUserId: w.userId,
        authorName: "Ayşe Sahip",
        body: `n${i}`,
        createdAt: new Date(base + i * 60_000),
      })),
    });
    const p1 = (await (await list(`conversationId=${w.conversationId}&limit=500`)).json()) as { notes: NoteJson[]; nextCursor: string | null };
    expect(p1.notes).toHaveLength(50);
    expect(p1.notes[0]!.body).toBe("n54");
    expect(p1.notes[49]!.body).toBe("n5");
    expect(p1.nextCursor).toBe(p1.notes[49]!.id);
    const p2 = (await (await list(`conversationId=${w.conversationId}&cursor=${p1.nextCursor}`)).json()) as { notes: NoteJson[]; nextCursor: string | null };
    expect(p2.notes.map((n) => n.body)).toEqual(["n4", "n3", "n2", "n1", "n0"]);
    expect(p2.nextCursor).toBeNull();
    // Başka bağın notu (aynı işletme, konaklamasız öteki konuşma) imleç olarak verilirse boş sayfa — o notun zamanından eski kendi
    // notlar da dönmez (Prisma imleci süzgeçten bağımsız çözer).
    const foreign = await prisma.internalNote.create({
      data: { organizationId: w.orgId, propertyId: w.propertyId, conversationId: w.bareId, authorName: "x", body: "öteki", createdAt: new Date(base + 30 * 60_000 + 1) },
    });
    const p3 = (await (await list(`conversationId=${w.conversationId}&cursor=${foreign.id}`)).json()) as { notes: NoteJson[]; nextCursor: string | null };
    expect(p3).toEqual({ notes: [], nextCursor: null });
  });

  it("hız sınırı: kişi başına dakikada 20 ekleme; 21. → 429 ve yazılmaz", async () => {
    const w = await world();
    for (let i = 0; i < 20; i++) expect((await post({ conversationId: w.conversationId, body: `n${i}` })).status).toBe(201);
    expect((await post({ conversationId: w.conversationId, body: "fazla" })).status).toBe(429);
    expect(await prisma.internalNote.count()).toBe(20);
  });
});
