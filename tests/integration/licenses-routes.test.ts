import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// İŞLETME BELGESİ Faz 1a — rotalar (davranışsal pin): anahtar kapalıysa uç yok; ev sahibi uçları YALNIZ sahip + yazmada iki aşamalı
// doğrulama + Pro / Business; başvuru sonucu dışarıya TEK genel cümle (başka hesap hakkında hiçbir şey sızmaz); operatör uçları
// süper-admin (allowlist + 2FA), bürünmede ve site dışı yazmada kapalı. `isSuperAdmin` GERÇEK (mock'lanmaz); yalnız oturum enjekte edilir.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as listGet, POST as applyPost } from "@/app/api/licenses/route";
import { POST as withdrawPost } from "@/app/api/licenses/[id]/withdraw/route";
import { GET as queueGet } from "@/app/api/admin/licenses/route";
import { POST as readingPost } from "@/app/api/admin/licenses/[id]/reading/route";
import { POST as proofPost } from "@/app/api/admin/licenses/[id]/proof/route";
import { POST as decisionPost } from "@/app/api/admin/licenses/[id]/decision/route";
import { LICENSE_TEXT } from "@/lib/licenses/messages";

const SECRET = "test-license-secret-0123456789abcdef";
const OPERATOR_EMAIL = "operator@lixusai.com";
const NOCTX = { params: Promise.resolve({}) } as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const getReq = (url: string) => new NextRequest(`http://localhost${url}`);

async function seed(name: string) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} 1` } });
  return { orgId: org.id, propertyId: property.id };
}

const asHost = (orgId: string, over: Partial<SessionPayload> = {}): SessionPayload => ({
  userId: `u-${orgId}`,
  organizationId: orgId,
  role: "owner",
  email: `sahip-${orgId}@example.test`,
  name: "Ev Sahibi",
  sessionEpoch: 0,
  mfa: true,
  ...over,
});
const asOperator = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  userId: "op-1",
  organizationId: "op-org",
  role: "owner",
  email: OPERATOR_EMAIL,
  name: "Operatör",
  sessionEpoch: 0,
  mfa: true,
  ...over,
});

const application = (number = "12345") => ({
  type: "agency",
  number,
  attributes: { group: "A" },
  holder: { kind: "company", legalName: "Lale Turizm Ltd. Şti.", taxId: "1234567890" },
  propertyIds: [],
});

describe("işletme belgesi rotaları", () => {
  beforeEach(async () => {
    await resetDb();
    session = null;
    vi.stubEnv("LICENSE_HMAC_SECRET", SECRET);
    vi.stubEnv("BUSINESS_LICENSES_ENABLED", "1");
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtar kapalı ya da sır yoksa uçlar YOK (404) — operatör kuyruğu dahil", async () => {
    const o = await seed("Lale");
    for (const env of [{ BUSINESS_LICENSES_ENABLED: "" }, { LICENSE_HMAC_SECRET: "" }]) {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      session = asHost(o.orgId);
      expect((await listGet(getReq("/api/licenses"), NOCTX)).status).toBe(404);
      expect((await applyPost(jsonReq("/api/licenses", application()), NOCTX)).status).toBe(404);
      session = asOperator();
      expect((await queueGet()).status).toBe(404);
      vi.stubEnv("BUSINESS_LICENSES_ENABLED", "1");
      vi.stubEnv("LICENSE_HMAC_SECRET", SECRET);
    }
    expect(await prisma.businessLicense.count()).toBe(0);
  });

  it("yalnız sahip; yazma iki aşamalı doğrulama ister (sade metin)", async () => {
    const o = await seed("Lale");
    for (const role of ["manager", "staff"] as const) {
      session = asHost(o.orgId, { role });
      expect((await listGet(getReq("/api/licenses"), NOCTX)).status).toBe(403);
      expect((await applyPost(jsonReq("/api/licenses", application()), NOCTX)).status).toBe(403);
    }
    session = asHost(o.orgId, { mfa: false });
    const noMfa = await applyPost(jsonReq("/api/licenses", application()), NOCTX);
    expect(noMfa.status).toBe(403);
    expect((await noMfa.json()).error).toBe(LICENSE_TEXT.twoFactorRequired);
    const list = await listGet(getReq("/api/licenses"), NOCTX);
    expect(await list.json()).toMatchObject({ twoFactor: false, licenses: [] });
    expect(await prisma.businessLicense.count()).toBe(0);
  });

  it("Pro / Business kapısı: faturalandırma zorunluyken ücretsiz pakette ve denemede başvuru yok; Pro'da var", async () => {
    vi.stubEnv("BILLING_ENFORCED", "1");
    const o = await seed("Lale");
    session = asHost(o.orgId);
    await prisma.subscription.create({ data: { organizationId: o.orgId, planCode: "free", status: "active", provider: "manual" } });
    const free = await applyPost(jsonReq("/api/licenses", application()), NOCTX);
    expect(free.status).toBe(403);
    expect((await free.json()).error).toBe(LICENSE_TEXT.planRequired);
    await prisma.subscription.update({ where: { organizationId: o.orgId }, data: { planCode: "pro", status: "trialing", provider: "trial", trialEndsAt: new Date(Date.now() + 86_400_000) } });
    expect((await applyPost(jsonReq("/api/licenses", application()), NOCTX)).status).toBe(403);
    await prisma.subscription.update({ where: { organizationId: o.orgId }, data: { planCode: "pro", status: "active", provider: "manual", trialEndsAt: null } });
    expect((await applyPost(jsonReq("/api/licenses", application()), NOCTX)).status).toBe(200);
  });

  it("🚨 başvuru cevabı TEK genel cümle: aynı belge başka hesapta doğrulanmış olsa bile ikinci hesap farkı göremez", async () => {
    const a = await seed("Lale");
    const b = await seed("Rakip");
    session = asHost(a.orgId);
    const ra = await applyPost(jsonReq("/api/licenses", application()), NOCTX);
    expect(ra.status).toBe(200);
    const licA = await prisma.businessLicense.findFirstOrThrow({ where: { organizationId: a.orgId } });
    // A'nın belgesi doğrulanır (operatör akışı).
    session = asOperator();
    await readingPost(jsonReq(`/api/admin/licenses/${licA.id}/reading`, { source: "ktb_agency_search", query: "12345", outcome: "valid", fields: { legalName: "Lale Turizm Ltd. Şti.", group: "A" } }), idCtx(licA.id));
    await proofPost(jsonReq(`/api/admin/licenses/${licA.id}/proof`, { method: "esign_declaration", evidenceRef: "TSG ilanı + e-imza", taxIdConfirmed: true }), idCtx(licA.id));
    expect((await decisionPost(jsonReq(`/api/admin/licenses/${licA.id}/decision`, { action: "approve" }), idCtx(licA.id))).status).toBe(200);
    // B aynı numarayla başvurur: cevap A'nınkiyle BİREBİR aynı.
    session = asHost(b.orgId);
    const rb = await applyPost(jsonReq("/api/licenses", { ...application(), holder: { kind: "company", legalName: "Rakip Tur A.Ş.", taxId: "9999999999" } }), NOCTX);
    expect(rb.status).toBe(200);
    expect(await rb.json()).toEqual({ ok: true, message: LICENSE_TEXT.applicationReceived });
    const listB = await (await listGet(getReq("/api/licenses"), NOCTX)).json();
    const body = JSON.stringify(listB);
    expect(body).not.toMatch(/taxIdHash|taxIdEnc|lockKey|verifiedGuard|1234567890|9999999999/);
    expect(listB.licenses[0]).toMatchObject({ statusLabel: "İnceleniyor", holder: { taxIdMasked: "••••••••99" } });
  });

  it("geri çekme: başka işletmenin belgesi bulunamadı (404); kendi belgesi 200", async () => {
    const a = await seed("Lale");
    const b = await seed("Başka");
    session = asHost(a.orgId);
    await applyPost(jsonReq("/api/licenses", application()), NOCTX);
    const lic = await prisma.businessLicense.findFirstOrThrow({ where: { organizationId: a.orgId } });
    session = asHost(b.orgId);
    expect((await withdrawPost(jsonReq(`/api/licenses/${lic.id}/withdraw`, {}), idCtx(lic.id))).status).toBe(404);
    session = asHost(a.orgId, { mfa: false });
    expect((await withdrawPost(jsonReq(`/api/licenses/${lic.id}/withdraw`, {}), idCtx(lic.id))).status).toBe(403);
    session = asHost(a.orgId);
    expect((await withdrawPost(jsonReq(`/api/licenses/${lic.id}/withdraw`, {}), idCtx(lic.id))).status).toBe(200);
  });

  it("🚨 operatör uçları: müşteri sahibi 401, 2FA'sız operatör 401, bürünmede 403, site dışı yazma 403, geçersiz eylem 400", async () => {
    const a = await seed("Lale");
    session = asHost(a.orgId);
    await applyPost(jsonReq("/api/licenses", application()), NOCTX);
    const lic = await prisma.businessLicense.findFirstOrThrow({ where: { organizationId: a.orgId } });
    const reading = { source: "ktb_agency_search", query: "12345", outcome: "valid", fields: { legalName: "Lale Turizm Ltd. Şti.", group: "A" } };

    session = asHost(a.orgId);
    expect((await queueGet()).status).toBe(401);
    expect((await readingPost(jsonReq(`/x`, reading), idCtx(lic.id))).status).toBe(401);
    session = asOperator({ mfa: false });
    expect((await queueGet()).status).toBe(401);
    expect((await decisionPost(jsonReq(`/x`, { action: "approve" }), idCtx(lic.id))).status).toBe(401);
    session = asOperator({ actorUserId: "op-1", actorEmail: OPERATOR_EMAIL, organizationId: a.orgId, userId: `u-${a.orgId}`, email: "musteri@example.test" } as Partial<SessionPayload>);
    expect((await readingPost(jsonReq(`/x`, reading), idCtx(lic.id))).status).toBe(403);
    session = asOperator();
    expect((await readingPost(jsonReq(`/x`, reading, { "sec-fetch-site": "cross-site" }), idCtx(lic.id))).status).toBe(403);
    expect((await decisionPost(jsonReq(`/x`, { action: "delete" }), idCtx(lic.id))).status).toBe(400);
    expect(await prisma.licenseEvent.count({ where: { licenseId: lic.id, actorKind: "operator" } })).toBe(0);

    // Yetkili operatör: kuyruk + okuma + kanıt + onay; ev sahibi işareti görür.
    const q = await (await queueGet()).json();
    expect(q.open.map((r: { id: string }) => r.id)).toEqual([lic.id]);
    expect(JSON.stringify(q)).not.toMatch(/1234567890|taxIdEnc/);
    expect((await readingPost(jsonReq(`/x`, reading), idCtx(lic.id))).status).toBe(200);
    expect((await decisionPost(jsonReq(`/x`, { action: "approve" }), idCtx(lic.id))).status).toBe(409);
    expect((await proofPost(jsonReq(`/x`, { method: "document_set", evidenceRef: "İmza sirküleri + vergi levhası doğrulandı", taxIdConfirmed: true }), idCtx(lic.id))).status).toBe(200);
    const ok = await decisionPost(jsonReq(`/x`, { action: "approve" }), idCtx(lic.id));
    expect(await ok.json()).toEqual({ ok: true, status: "verified" });
    session = asHost(a.orgId);
    const list = await (await listGet(getReq("/api/licenses"), NOCTX)).json();
    expect(list.licenses[0].mark.text).toMatch(/^Seyahat acentası işletme belgesi \(A grubu\) Bakanlık kaydıyla eşleşti · son kontrol /);
  });
});
