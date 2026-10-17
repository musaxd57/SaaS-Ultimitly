import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// K1 (kurucu 10-17: "B — otomatik kesme yok; risk puanı geliştirilsin, IP'lere bakılsın", migration 72) — gerçek PostgreSQL. Kayıt ağı izi:
// HAM IP hiçbir kolonda yok; anahtar KAPALIYKEN satır yok; iz yazımı hata verse de kayıt 201; hesap silinince iz süre dolana kadar kalır;
// süpürge yalnız süresi dolanı siler; operatör sinyalleri yalnız anahtar açıkken.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";
import { checkSignupNetworkInfra, loadSignupNetworkSignals, purgeSignupNetworkTraces, recordSignupNetwork } from "@/lib/billing/signup-network";
import { __resetSignupNetworkKey, INFRA_MIN_SIGNUPS } from "@/lib/billing/signup-network-core";
import { deleteAccountData } from "@/lib/data-retention";

function registerReq(email: string, ip: string) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", "x-forwarded-for": ip },
    body: JSON.stringify({ organizationName: "İşletme", name: "Test Host", email, password: "sifre12345", consent: true }),
  });
}
const orgOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { organizationId: true } })).organizationId;

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  __resetSignupNetworkKey();
  vi.stubEnv("REGISTRATION_OPEN", "1");
  vi.stubEnv("SIGNUP_NETWORK_TRACE_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetSignupNetworkKey();
});

describe("kayıt → iz", () => {
  it("🚨 yeni kayıt BİR iz satırı yazar; ham IP / önek HİÇBİR kolonda yok (satırın bütün değerleri taranır)", async () => {
    expect((await register(registerReq("a@example.com", "203.0.113.7"))).status).toBe(201);
    const rows = await prisma.signupNetworkTrace.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: await orgOf("a@example.com"), networkKind: "v4_24" });
    expect(rows[0].ipHash).toMatch(/^v1:[0-9a-f]{64}$/);
    const all = JSON.stringify(rows[0]);
    for (const raw of ["203.0.113.7", "203.0.113", "203.0.113.0/24"]) expect(all).not.toContain(raw);
    // Süre: kayıttan 90 gün sonra (kurucu sorusu Q3 cevabına kadar tasarım önerisi).
    expect(Math.round((rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()) / 86_400_000)).toBe(90);
  });

  it("KONTROL: anahtar KAPALIYKEN iz yazılmaz (bugünkü davranış); var-olan hesaba tekrar kayıt iz yazmaz", async () => {
    vi.stubEnv("SIGNUP_NETWORK_TRACE_ENABLED", "");
    expect((await register(registerReq("a@example.com", "203.0.113.7"))).status).toBe(201);
    expect(await prisma.signupNetworkTrace.count()).toBe(0);
    vi.stubEnv("SIGNUP_NETWORK_TRACE_ENABLED", "1");
    expect((await register(registerReq("a@example.com", "203.0.113.8"))).status).toBe(201);
    expect(await prisma.signupNetworkTrace.count()).toBe(0);
  });
});

describe("saklama", () => {
  it("🚨 hesap silinince iz KALIR (işletme bağı boşa çekilir — sil-yeniden-aç görünsün); süpürge yalnız süresi dolanı siler", async () => {
    await register(registerReq("c@example.com", "198.51.100.4"));
    const orgId = await orgOf("c@example.com");
    expect(await deleteAccountData(orgId)).toEqual({ deleted: true });
    const [row] = await prisma.signupNetworkTrace.findMany();
    expect(row.organizationId).toBeNull();
    expect(await purgeSignupNetworkTraces(new Date(row.expiresAt.getTime() - 1))).toBe(0);
    expect(await purgeSignupNetworkTraces(new Date(row.expiresAt.getTime() + 1))).toBe(1);
    expect(await prisma.signupNetworkTrace.count()).toBe(0);
  });
});

describe("operatör sinyalleri", () => {
  it("🚨 silip aynı adresten yeniden açılan hesap → ip_shared, bağlamda 'silinmiş hesap'; KONTROL: farklı ağdan kayıt sinyal vermez", async () => {
    await register(registerReq("d1@example.com", "198.51.100.20"));
    await deleteAccountData(await orgOf("d1@example.com"));
    await register(registerReq("d2@example.com", "198.51.100.20"));
    await register(registerReq("e@example.com", "192.0.2.50"));
    const d2 = await orgOf("d2@example.com");
    const e = await orgOf("e@example.com");
    const signals = await loadSignupNetworkSignals([d2, e]);
    expect(signals.get(d2)).toMatchObject({ ipShared: true, networkBurst: false });
    expect(signals.get(d2)!.related).toEqual([expect.objectContaining({ organizationId: null, same: "ip" })]);
    expect(signals.get(e)).toMatchObject({ ipShared: false, networkBurst: false, related: [] });
    // Anahtar kapalıyken sinyal okunmaz (liste bugünkü puanla).
    vi.stubEnv("SIGNUP_NETWORK_TRACE_ENABLED", "");
    expect((await loadSignupNetworkSignals([d2])).size).toBe(0);
  });

  it("🚨 aynı /24 ağdan 7 gün içinde 2 başka kayıt → network_burst (gerçek sorgu, ağ özeti dalı); KONTROL: tek başka kayıt → yok", async () => {
    const me = await prisma.organization.create({ data: { name: "Me" } });
    const a = await prisma.organization.create({ data: { name: "A" } });
    const b = await prisma.organization.create({ data: { name: "B" } });
    await recordSignupNetwork(a.id, "198.51.100.11", new Date(Date.now() - 3 * 86_400_000));
    await recordSignupNetwork(me.id, "198.51.100.10");
    expect((await loadSignupNetworkSignals([me.id])).get(me.id)).toMatchObject({ ipShared: false, networkBurst: false, related: [] });
    await recordSignupNetwork(b.id, "198.51.100.12", new Date(Date.now() - 5 * 86_400_000));
    const s = (await loadSignupNetworkSignals([me.id])).get(me.id)!;
    expect(s).toMatchObject({ ipShared: false, networkBurst: true });
    expect(s.related.map((r) => r.organizationId).sort()).toEqual([a.id, b.id].sort());
  });

  it("anahtar parmak izi farklı satır (AYNI özet) karşılaştırmaya girmez — sessiz yanlış eşleşme yok", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    await recordSignupNetwork(org.id, "203.0.113.70");
    const mine = await prisma.signupNetworkTrace.findFirstOrThrow({ where: { organizationId: org.id } });
    const other = await prisma.organization.create({ data: { name: "Y" } });
    // Aynı ip özeti, BAŞKA anahtar parmak izi (eski anahtarla yazılmış satır gibi) → sayılmaz.
    await prisma.signupNetworkTrace.create({
      data: { organizationId: other.id, ipHash: mine.ipHash, networkHash: mine.networkHash, networkKind: "v4_24", keyFp: "0000000000000000", expiresAt: mine.expiresAt },
    });
    expect((await loadSignupNetworkSignals([org.id])).get(org.id)).toMatchObject({ ipShared: false, related: [] });
    // KONTROL: aynı satır güncel parmak iziyle → sayılır (yukarıdaki sonuç parmak izi süzgecinden).
    await prisma.signupNetworkTrace.updateMany({ where: { organizationId: other.id }, data: { keyFp: mine.keyFp } });
    expect((await loadSignupNetworkSignals([org.id])).get(org.id)).toMatchObject({ ipShared: true });
  });

  it("🚨 altyapı şüphesi (son 24 saatte kayıtların yarısı tek adresten): saatlik iş TEK alarm durumu yazar, sinyaller SUSMAZ; geçince temizlenir", async () => {
    const orgs = [];
    for (let i = 0; i < INFRA_MIN_SIGNUPS; i++) {
      const o = await prisma.organization.create({ data: { name: `O${i}` } });
      orgs.push(o.id);
      await recordSignupNetwork(o.id, i < INFRA_MIN_SIGNUPS / 2 ? "203.0.113.200" : `192.0.2.${i + 10}`);
    }
    expect(await checkSignupNetworkInfra()).toBe(true);
    expect(await prisma.systemLock.count({ where: { name: "alert-state:signup-network-infra" } })).toBe(1);
    expect((await loadSignupNetworkSignals([orgs[0]!])).get(orgs[0]!)).toMatchObject({ ipShared: true });
    await prisma.signupNetworkTrace.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await checkSignupNetworkInfra()).toBe(false);
    expect(await prisma.systemLock.count({ where: { name: "alert-state:signup-network-infra" } })).toBe(0);
  });

  it("eşzamanlı aynı e-postayla iki kayıt → tek işletme, TEK iz (kaybeden iz yazmaz)", async () => {
    const res = await Promise.all([register(registerReq("race@example.com", "198.51.100.30")), register(registerReq("race@example.com", "198.51.100.31"))]);
    expect(res.map((r) => r.status)).toEqual([201, 201]);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.signupNetworkTrace.count()).toBe(1);
  });
});
