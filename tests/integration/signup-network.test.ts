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
import { loadSignupNetworkSignals, purgeSignupNetworkTraces, recordSignupNetwork } from "@/lib/billing/signup-network";
import { __resetSignupNetworkKey } from "@/lib/billing/signup-network-core";
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
  vi.restoreAllMocks();
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

  it("🚨 iz yazımı hata verirse kayıt YİNE 201 (fail-open) ve hesap açılır", async () => {
    vi.spyOn(prisma.signupNetworkTrace, "create").mockRejectedValueOnce(new Error("db down"));
    expect((await register(registerReq("b@example.com", "203.0.113.9"))).status).toBe(201);
    expect(await prisma.user.count({ where: { email: "b@example.com" } })).toBe(1);
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

  it("anahtar parmak izi değişirse eski izler karşılaştırmaya girmez (sessiz yanlış eşleşme yok)", async () => {
    const org = await prisma.organization.create({ data: { name: "X" } });
    const other = await prisma.organization.create({ data: { name: "Y" } });
    await recordSignupNetwork(other.id, "203.0.113.70");
    vi.stubEnv("ENCRYPTION_KEY", "rotated-key-for-test-0123456789-abcdefghij");
    __resetSignupNetworkKey();
    await recordSignupNetwork(org.id, "203.0.113.70");
    expect((await loadSignupNetworkSignals([org.id])).get(org.id)).toMatchObject({ ipShared: false, related: [] });
  });
});
