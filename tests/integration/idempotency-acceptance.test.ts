import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as CREATE } from "@/app/api/kb/route";
import { POST as COPY } from "@/app/api/kb/[id]/copy/route";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { createGuestCommitment } from "@/lib/guest-commitments";
import { addPropertyInstruction } from "@/lib/history-learn/service";
import { KB_COPY_CONFLICT_MESSAGE, KB_CREATE_CONFLICT_MESSAGE, KB_IDEMPOTENCY_CONFLICT } from "@/lib/kb/request-id";

// ---------------------------------------------------------------------------
// TEKRAR GÜVENLİĞİ — KABUL TESTLERİ (kurucu 10-15, altı madde). Her `describe` bir maddedir; gerçek PostgreSQL.
//  1. Aynı kimlik, farklı içerik → eski kayıt SESSİZCE dönmez, açık uyuşmazlık (409 + kod).
//  2. Kiracı sınırı → istek kimliği başka hostun kaydına eriştirmez.
//  3. Kasıtlı yeni işlem → yeni kimlikle ikinci kayıt açılabilir.
//  4. Kısmi kopyalama → A / B tamam, C düştü → yeniden deneme yalnız C'yi yazar; kaynak değiştiyse belirli (409 ya da yeni kimlik).
//     (Düşen C'nin gerçekten DÜŞÜRÜLDÜĞÜ hâl `idempotency-acceptance-crash.test.ts`: Prisma casusu sızmasın diye ayrı dosya.)
//  5. Görev tekilleştirme → "klima" ≠ "musluk"; aynı mesajın yeniden işlenmesi (aynı ya da başka gün) tek görev; başka gün gelen YENİ
//     bildirim ayrı görev.
//  6. Çökme ve tekrar → kayıt yazıldı, cevap kayboldu, aynı istek tekrar geldi → aynı kayıt. (İki AYRI uygulama işçisi = iki ayrı Node
//     süreci: `idempotency-two-workers.test.ts`.)
// ---------------------------------------------------------------------------

const RID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RID2 = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

const json = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const create = (body: unknown) => CREATE(json("http://localhost/api/kb", body), { params: Promise.resolve({}) });
const copy = (sourceId: string, body: unknown) =>
  COPY(json(`http://localhost/api/kb/${sourceId}/copy`, body), { params: Promise.resolve({ id: sourceId }) });
const owner = (organizationId: string): SessionPayload => ({ userId: "u", organizationId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 });
const wifi = (propertyId: string, extra: Record<string, unknown> = {}) => ({
  propertyId,
  category: "wifi",
  title: "Wi-Fi",
  content: "Ağ adı: Lale_5G. Şifre kapıdaki kartta.",
  ...extra,
});

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  ({ orgId, propertyId } = await makeOrgWithProperty());
  session = owner(orgId);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const prop = (org: string, name: string) => prisma.property.create({ data: { organizationId: org, name } }).then((p) => p.id);

describe("1 · Aynı kimlik, farklı içerik → açık uyuşmazlık", () => {
  it("🚨 bilgi tabanı: kalem arada değiştiyse aynı kimlikle yeniden deneme eski kalemi DÖNDÜRMEZ — 409 + kod, ikinci kalem de yok", async () => {
    const first = await create(wifi(propertyId, { requestId: RID }));
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    // Başka sekmede düzenlendi.
    await prisma.knowledgeBaseItem.update({ where: { id }, data: { content: "Ağ adı: Lale_YENI." } });
    const again = await create(wifi(propertyId, { requestId: RID }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: KB_CREATE_CONFLICT_MESSAGE, code: KB_IDEMPOTENCY_CONFLICT });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 bilgi tabanı: aynı kimlik FARKLI içerikle gönderildiyse (istemci hatası) yine 409; ilk kalem değişmez", async () => {
    await create(wifi(propertyId, { requestId: RID }));
    const other = await create(wifi(propertyId, { requestId: RID, content: "Bambaşka bir metin." }));
    expect(other.status).toBe(409);
    expect((await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId } })).content).toContain("Lale_5G");
  });

  it("kontrol: içerik AYNIYSA yeniden deneme 200 + aynı kalem (sessiz dönüş YALNIZ birebir aynı istekte)", async () => {
    const a = (await (await create(wifi(propertyId, { requestId: RID }))).json()) as { id: string };
    const b = await create(wifi(propertyId, { requestId: RID }));
    expect(b.status).toBe(200);
    expect(((await b.json()) as { id: string }).id).toBe(a.id);
  });

  it("🚨 kopyalama: kaynak ARADA değiştiyse aynı kimlikle yeniden deneme HİÇBİR şey yazmaz — 409; yeni kimlik güncel metni yazar", async () => {
    const a = await prop(orgId, "Lale 2");
    const b = await prop(orgId, "Lale 3");
    const c = await prop(orgId, "Lale 4");
    const src = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Eski metin.", isActive: true } });
    expect(await (await copy(src.id, { targetPropertyIds: [a, b], requestId: RID })).json()).toMatchObject({ created: 2 });
    await prisma.knowledgeBaseItem.update({ where: { id: src.id }, data: { content: "Yeni metin." } });
    const stale = await copy(src.id, { targetPropertyIds: [a, b, c], requestId: RID });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: KB_COPY_CONFLICT_MESSAGE, code: KB_IDEMPOTENCY_CONFLICT });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: c } })).toBe(0); // C'ye karışık içerik YAZILMADI
    // Bilerek yeniden kopyalama = YENİ işlem (yeni kimlik): her daireye güncel metin.
    expect(await (await copy(src.id, { targetPropertyIds: [a, b, c], requestId: RID2 })).json()).toMatchObject({ created: 3 });
    expect((await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: c } })).content).toBe("Yeni metin.");
  });
});

describe("2 · Kiracı sınırı", () => {
  it("🚨 başka işletme AYNI kimliği kendi mülkünde kullanınca kendi kalemini alır; ilk işletmenin kalemine erişemez", async () => {
    const mine = (await (await create(wifi(propertyId, { requestId: RID }))).json()) as { id: string };
    const other = await makeOrgWithProperty();
    session = owner(other.orgId);
    const theirs = await create(wifi(other.propertyId, { requestId: RID }));
    expect(theirs.status).toBe(201);
    const t = (await theirs.json()) as { id: string; propertyId: string };
    expect(t.id).not.toBe(mine.id);
    expect(t.propertyId).toBe(other.propertyId);
  });

  it("🚨 başka işletmenin MÜLKÜNE aynı kimlikle istek → mülk reddi (400); kalem dönmez, yazılmaz", async () => {
    await create(wifi(propertyId, { requestId: RID }));
    const other = await makeOrgWithProperty();
    session = owner(other.orgId);
    const res = await create(wifi(propertyId, { requestId: RID }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("Lale_5G");
    expect(await prisma.knowledgeBaseItem.count()).toBe(1);
  });

  it("🚨 kopyalama: başka işletmenin kaynağı 404; aynı kimlikle kendi kaynağını kopyalamak ilk işletmeye dokunmaz", async () => {
    const a = await prop(orgId, "Lale 2");
    const src = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Bizim metin.", isActive: true } });
    await copy(src.id, { targetPropertyIds: [a], requestId: RID });
    const other = await makeOrgWithProperty();
    const otherTarget = await prop(other.orgId, "Diğer 2");
    session = owner(other.orgId);
    expect((await copy(src.id, { targetPropertyIds: [otherTarget], requestId: RID })).status).toBe(404);
    const theirSrc = await prisma.knowledgeBaseItem.create({ data: { propertyId: other.propertyId, category: "wifi", title: "Wi-Fi", content: "Onların metni.", isActive: true } });
    expect(await (await copy(theirSrc.id, { targetPropertyIds: [otherTarget], requestId: RID })).json()).toMatchObject({ created: 1 });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: a } })).toBe(1);
    expect((await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: otherTarget } })).content).toBe("Onların metni.");
  });

  it("görev / söz / talimat tekilleştirmesi işletmeler arasında birleşmez", async () => {
    const other = await makeOrgWithProperty();
    const now = new Date("2026-07-10T09:00:00.000Z");
    expect((await createOperationalTaskFromMessage({ propertyId, message: "klima bozuk", now })).status).toBe("created");
    expect((await createOperationalTaskFromMessage({ propertyId: other.propertyId, message: "klima bozuk", now })).status).toBe("created");
    expect(await prisma.task.count()).toBe(2);
    const i1 = await addPropertyInstruction({ organizationId: orgId, propertyId, userId: null, content: "Otopark sorulursa önce binanın arkasındaki yeri anlat." });
    const i2 = await addPropertyInstruction({ organizationId: other.orgId, propertyId: other.propertyId, userId: null, content: "Otopark sorulursa önce binanın arkasındaki yeri anlat." });
    expect(i1.ok && i2.ok && i1.id !== i2.id).toBe(true);
    // Başka işletmenin mülküne talimat: mülk bulunamaz (kimlik / metin eşleşmesi başka işletmeye taşmaz).
    expect(await addPropertyInstruction({ organizationId: other.orgId, propertyId, userId: null, content: "Sessiz saatler 23:00 sonrası." })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("3 · Kasıtlı yeni işlem", () => {
  it("bilgi tabanı: aynı metin YENİ kimlikle → ikinci kalem (201)", async () => {
    await create(wifi(propertyId, { requestId: RID }));
    expect((await create(wifi(propertyId, { requestId: RID2 }))).status).toBe(201);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(2);
  });

  it("kopyalama: başarıdan sonra YENİ kimlikle → ikinci kopya", async () => {
    const a = await prop(orgId, "Lale 2");
    const src = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Metin.", isActive: true } });
    await copy(src.id, { targetPropertyIds: [a], requestId: RID });
    await copy(src.id, { targetPropertyIds: [a], requestId: RID2 });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: a } })).toBe(2);
  });

  it("söz: farklı saat ya da tür = yeni söz; AYNI tür + AYNI saat aynı olgudur (yeni kayıt açmaz — kimlik değil, anlam tekilleştirmesi)", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir" } });
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    const base = { organizationId: orgId, conversationId: conv.id, propertyId, reservationId: null, actorUserId: user.id };
    const at18 = new Date(Date.now() + 26 * 3_600_000);
    const at19 = new Date(at18.getTime() + 3_600_000);
    const c1 = await createGuestCommitment({ ...base, kind: "towels", dueAt: at18 });
    const c2 = await createGuestCommitment({ ...base, kind: "towels", dueAt: at18 });
    const c3 = await createGuestCommitment({ ...base, kind: "towels", dueAt: at19 });
    const c4 = await createGuestCommitment({ ...base, kind: "supplies", dueAt: at18 });
    expect(c2).toMatchObject({ id: c1.id, reused: true });
    expect(new Set([c1.id, c3.id, c4.id]).size).toBe(3);
  });
});

describe("5 · Görev tekilleştirme", () => {
  const day1 = new Date("2026-07-10T09:00:00.000Z");
  const day2 = new Date("2026-07-11T09:00:00.000Z");

  it("🚨 'Klima bozuk' ile 'Musluk bozuk' aynı gün AYRI görev (ikisi de bakım)", async () => {
    await createOperationalTaskFromMessage({ propertyId, message: "Klima bozuk", now: day1 });
    await createOperationalTaskFromMessage({ propertyId, message: "Musluk bozuk", now: day1 });
    expect(await prisma.task.count({ where: { propertyId, type: "maintenance" } })).toBe(2);
  });

  it("🚨 AYNI mesaj yeniden işlenince (aynı gün de, ertesi gün de, görev bitmiş olsa da) ikinci görev AÇILMAZ", async () => {
    const msg = { propertyId, message: "Klima bozuk", sourceMessageId: "msg-klima-1" };
    expect((await createOperationalTaskFromMessage({ ...msg, now: day1 })).status).toBe("created");
    expect((await createOperationalTaskFromMessage({ ...msg, now: day1 })).status).toBe("duplicate");
    expect((await createOperationalTaskFromMessage({ ...msg, now: day2 })).status).toBe("duplicate");
    await prisma.task.updateMany({ where: { propertyId }, data: { status: "done" } });
    expect((await createOperationalTaskFromMessage({ ...msg, now: day2 })).status).toBe("duplicate");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 başka gün gelen YENİ bildirim (başka mesaj) ayrı görev — ilk görev hâlâ açık olsa da", async () => {
    await createOperationalTaskFromMessage({ propertyId, message: "Klima bozuk", sourceMessageId: "msg-1", now: day1 });
    const next = await createOperationalTaskFromMessage({ propertyId, message: "Klima yine bozuldu", sourceMessageId: "msg-2", now: day2 });
    expect(next.status).toBe("created");
    expect(await prisma.task.count({ where: { propertyId, status: { not: "done" } } })).toBe(2);
  });

  it("kontrol: aynı gün aynı konuda İKİNCİ mesaj (başka mesaj kimliği) tek görevde kalır (gün içi tekilleştirme)", async () => {
    await createOperationalTaskFromMessage({ propertyId, message: "Klima bozuk", sourceMessageId: "msg-1", now: day1 });
    expect((await createOperationalTaskFromMessage({ propertyId, message: "Klima hâlâ bozuk", sourceMessageId: "msg-2", now: day1 })).status).toBe("duplicate");
  });
});

describe("6 · Çökme ve tekrar — kayıt yazıldı, cevap kayboldu", () => {
  it("🚨 bilgi tabanı: ilk istek yazdı (cevap istemciye ulaşmadı) → aynı istek tekrar → aynı kalem, tek satır", async () => {
    void (await create(wifi(propertyId, { requestId: RID }))); // cevap "kayboldu"
    const retry = await create(wifi(propertyId, { requestId: RID }));
    expect(retry.status).toBe(200);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 kopyalama: ilk istek iki daireye yazdı (cevap kayboldu) → tekrar → yeni kopya yok, cevap 'created 0'", async () => {
    const a = await prop(orgId, "Lale 2");
    const b = await prop(orgId, "Lale 3");
    const src = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Metin.", isActive: true } });
    void (await copy(src.id, { targetPropertyIds: [a, b], requestId: RID }));
    expect(await (await copy(src.id, { targetPropertyIds: [a, b], requestId: RID })).json()).toMatchObject({ created: 0, skippedAtLimit: 0 });
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId: { in: [a, b] } } })).toBe(2);
  });

  it("🚨 söz ve talimat: ilk istek yazdı → tekrar → aynı kayıt", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir" } });
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u2-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    const input = { organizationId: orgId, conversationId: conv.id, propertyId, reservationId: null, actorUserId: user.id, kind: "towels" as const, dueAt: new Date(Date.now() + 26 * 3_600_000) };
    const first = await createGuestCommitment(input);
    expect(await createGuestCommitment(input)).toMatchObject({ id: first.id, taskId: first.taskId, reused: true });
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    const text = "Otopark sorulursa önce binanın arkasındaki yeri anlat.";
    const i1 = await addPropertyInstruction({ organizationId: orgId, propertyId, userId: null, content: text });
    expect(await addPropertyInstruction({ organizationId: orgId, propertyId, userId: null, content: text })).toEqual({ ok: true, id: i1.ok ? i1.id : "", reused: true });
  });
});
