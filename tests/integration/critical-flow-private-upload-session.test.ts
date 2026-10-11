import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// KRİTİK AKIŞ — özel yükleme · yetkisiz nesne erişimi: ROTA + OTURUM + DB birlikte (kurucu talimatı 09-07 "Merkezi kritik akış
// matrisi"; `docs/TEST-EVIDENCE-CONTRACT.md` §3'teki ⚠️ "rota+oturum+DB ile uçtan uca test yok" boşluğu — Haiku kapsam denetimi 10-11).
//
// `storage-wiring.test.ts` `requireSession`'ı taklit ediyordu (oturum katmanı yoktu). Burada YALNIZ Next'in istek kapsamlı çerez
// deposu (`next/headers` → `cookies()`) sahte: içine GERÇEK imzalı oturum belirteci (`signSession`) konur; doğrulama (`verifySession`),
// DB'ye karşı sürüm / rol / kiracı denetimi (`requireSession`), rota bekçisi (`withAuth`), rota ve PostgreSQL GERÇEK. Ölçülen: sahip →
// imzalı 302; oturumsuz / sahte imzalı / iptal edilmiş oturum → 401; başka kiracının anahtarı → 404 ve İMZA ÜRETİLMEZ; atanmamış
// personel → 404, atanmış personel → 302.
// ---------------------------------------------------------------------------

let cookieValue: string | undefined;
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  cookies: async () => ({ get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { name, value: cookieValue } : undefined) }),
}));

// İmza üreticisi GERÇEK, yalnız casus: "imza üretilmedi" iddiası başlık yokluğuyla değil çağrı sayısıyla ölçülür (Haiku 10-11).
vi.mock("@/lib/storage/s3", async (orig) => {
  const actual = await orig<typeof import("@/lib/storage/s3")>();
  return { ...actual, presignGetUrl: vi.fn(actual.presignGetUrl) };
});

import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { presignGetUrl } from "@/lib/storage/s3";
import type { SessionPayload } from "@/lib/auth";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import { GET as serveGET } from "@/app/api/storage/photo/[...key]/route";

const STORAGE_ENV = {
  STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  STORAGE_BUCKET: "lixus-photos",
  STORAGE_ACCESS_KEY_ID: "AKIDEXAMPLE",
  STORAGE_SECRET_ACCESS_KEY: "provider-secret-must-never-appear",
};

let seq = 0;
async function tenantWithPhoto() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const owner = await prisma.user.create({
    data: { organizationId: orgId, name: "Sahip", email: `owner${++seq}@x.com`, passwordHash: "x", role: "owner" },
  });
  const staff = await prisma.user.create({
    data: { organizationId: orgId, name: "Personel", email: `staff${++seq}@x.com`, passwordHash: "x", role: "staff" },
  });
  const task = await prisma.task.create({
    data: { propertyId, type: "cleaning", title: "Temizlik", status: "todo", priority: "standard" },
  });
  const key = `org/${orgId}/task/${task.id}/123-abc.png`;
  await prisma.taskUpdate.create({ data: { taskId: task.id, userId: owner.id, photoUrl: STORAGE_PHOTO_URL_PREFIX + key } });
  return { orgId, owner, staff, taskId: task.id, key };
}

async function loginAs(user: { id: string; organizationId: string; role: string; email: string; sessionEpoch: number }) {
  cookieValue = await signSession({
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role as SessionPayload["role"],
    email: user.email,
    name: "U",
    sessionEpoch: user.sessionEpoch,
    mfa: false,
  });
}

const get = (key: string) =>
  serveGET(new NextRequest(`http://localhost/api/storage/photo/${key}`), { params: Promise.resolve({ key: key.split("/") }) });

describe("🚨 kritik akış — özel yükleme: rota + gerçek oturum + DB", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(presignGetUrl).mockClear();
    cookieValue = undefined;
    for (const [k, v] of Object.entries(STORAGE_ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kendi kiracısının sahibi (gerçek imzalı oturum) → 302, hedef kısa ömürlü imzalı adres, sır yok", async () => {
    const a = await tenantWithPhoto();
    await loginAs(a.owner);
    const res = await get(a.key);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(new URL(loc).pathname).toBe(`/${a.key}`);
    expect(loc).toContain("X-Amz-Signature=");
    expect(loc).not.toContain(STORAGE_ENV.STORAGE_SECRET_ACCESS_KEY);
  });

  it("oturum yok → 401; sahte imzalı belirteç → 401 (imza üretilmez)", async () => {
    const a = await tenantWithPhoto();
    const none = await get(a.key);
    expect(none.status).toBe(401);
    expect(none.headers.get("location")).toBeNull();

    await loginAs(a.owner);
    cookieValue = `${cookieValue!.slice(0, -4)}AAAA`; // imza bozuldu
    const forged = await get(a.key);
    expect(forged.status).toBe(401);
    expect(forged.headers.get("location")).toBeNull();
  });

  it("🚨 başka kiracının sahibi, kurbanın anahtarıyla → 404 (varlık doğrulanmaz), imzalı adres ÜRETİLMEZ", async () => {
    const victim = await tenantWithPhoto();
    const attacker = await tenantWithPhoto();
    await loginAs(attacker.owner);
    const res = await get(victim.key);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(presignGetUrl).not.toHaveBeenCalled();
    // Kontrol: aynı oturum kendi anahtarını açabiliyor (red, oturumun bozukluğundan değil kiracı sınırından).
    expect((await get(attacker.key)).status).toBe(302);
  });

  it("🚨 kendi kiracısının ama HİÇBİR görev güncellemesinin göstermediği anahtar (silinmiş görev / eski anahtar) → 404, imza YOK (F11)", async () => {
    const a = await tenantWithPhoto();
    await loginAs(a.owner);
    const orphan = `org/${a.orgId}/task/${a.taskId}/999-orphan.png`;
    const res = await get(orphan);
    expect(res.status).toBe(404);
    expect(presignGetUrl).not.toHaveBeenCalled();
    expect((await get(a.key)).status).toBe(302); // kontrol: bağlı anahtar aynı oturumla açılır
    expect(presignGetUrl).toHaveBeenCalledTimes(1);
  });

  it("🚨 iptal edilmiş oturum (parola sıfırlama → sürüm arttı) aynı belirteçle → 401", async () => {
    const a = await tenantWithPhoto();
    await loginAs(a.owner);
    expect((await get(a.key)).status).toBe(302);
    await prisma.user.update({ where: { id: a.owner.id }, data: { sessionEpoch: { increment: 1 } } });
    const res = await get(a.key);
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("personel yalnız KENDİSİNE atanmış görevin fotoğrafını açar: atanmamış → 404, atanınca → 302 (rol DB'den okunur)", async () => {
    const a = await tenantWithPhoto();
    await loginAs(a.staff);
    expect((await get(a.key)).status).toBe(404);
    await prisma.task.update({ where: { id: a.taskId }, data: { assignedToId: a.staff.id } });
    expect((await get(a.key)).status).toBe(302);
    // Belirteç "owner" iddia etse de DB'deki rol personel → yine yalnız atanmış görev (JWT'ye güvenilmez).
    await prisma.task.update({ where: { id: a.taskId }, data: { assignedToId: null } });
    await loginAs({ ...a.staff, role: "owner" });
    expect((await get(a.key)).status).toBe(404);
  });
});
