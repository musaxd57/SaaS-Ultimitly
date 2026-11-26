import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖZEL MESAJ ŞABLONU SINIRI (kurucu 11-19 akşam madde 1; bulgu T2-B8 — sınır yokken ~10 dk yazımla 3.000 şablon birikiyordu). Başlangıç
// değeri plan tablosundan (500), `MESSAGE_TEMPLATE_CAP` acil fren. Pasif şablon sayılır, işletme geneli şablon bir kez sayılır, hazır
// Lixus şablonları sayılmaz. Sınırı aşmış işletmede yalnız YENİ ekleme durur; hiçbir şey silinmez / gizlenmez, düzenleme sürer.
// Eşzamanlılık: `template-cap-race.test.ts`.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/templates/route";
import { PATCH, DELETE } from "@/app/api/templates/[id]/route";
import { planLimitsFor } from "@/lib/billing/plan-limits";
import { messageTemplateCapForOrg } from "@/lib/template-cap";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

const ctx = { params: Promise.resolve({}) };
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (body: Record<string, unknown>) => POST(json("/api/templates", "POST", { category: "general", language: "tr", propertyId: null, ...body }), ctx);
const patch = (id: string, body: unknown) => PATCH(json(`/api/templates/${id}`, "PATCH", body), idCtx(id));
const del = (id: string) => DELETE(json(`/api/templates/${id}`, "DELETE"), idCtx(id));
const count = (orgId: string) => prisma.messageTemplate.count({ where: { organizationId: orgId } });

async function seedTemplates(orgId: string, n: number, extra: { propertyId?: string | null; isActive?: boolean } = {}) {
  for (let i = 0; i < n; i += 250) {
    await prisma.messageTemplate.createMany({
      data: Array.from({ length: Math.min(250, n - i) }, (_, k) => ({
        organizationId: orgId,
        propertyId: extra.propertyId ?? null,
        category: "general",
        title: `Hazır metin ${i + k}`,
        body: `Merhaba, metin ${i + k}.`,
        language: "tr",
        isActive: extra.isActive ?? true,
      })),
    });
  }
}

let orgId = "";
let propertyId = "";
beforeEach(async () => {
  await resetDb();
  ({ orgId, propertyId } = await makeOrgWithProperty());
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterEach(() => vi.unstubAllEnvs());

describe("şablon sınırı — değer ve sayım", () => {
  it("🚨 başlangıç değeri plan tablosundan (500): sınır kadar şablon varken yeni ekleme 400 + sınır iletisi, satır yazılmaz", async () => {
    const cap = planLimitsFor("business").messageTemplatesPerOrg;
    expect(cap).toBe(500);
    expect(await messageTemplateCapForOrg(orgId)).toBe(cap);
    await seedTemplates(orgId, cap);
    const res = await post({ title: "Bir fazla", body: "Sınırı aşan metin." });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Özel şablon sınırına ulaştınız (500 şablon).");
    expect(await count(orgId)).toBe(cap);
  });

  it("KONTROL: sınırın bir altında ekleme yazılır (sınır dahil değil, tam sınıra kadar)", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "3");
    await seedTemplates(orgId, 2);
    expect((await post({ title: "Üçüncü", body: "Üçüncü metin." })).status).toBe(201);
    expect((await post({ title: "Dördüncü", body: "Dördüncü metin." })).status).toBe(400);
    expect(await count(orgId)).toBe(3);
  });

  it("🚨 PASİF şablon da sayılır (pasife alma sınırsız biriktirme yolu olmasın)", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "3");
    await seedTemplates(orgId, 2);
    const passive = await prisma.messageTemplate.create({
      data: { organizationId: orgId, category: "general", title: "Pasif", body: "Pasif metin.", isActive: false },
    });
    expect((await post({ title: "Yeni", body: "Yeni metin." })).status).toBe(400);
    // Pasif şablon silinince yer açılır.
    await prisma.messageTemplate.delete({ where: { id: passive.id } });
    expect((await post({ title: "Yeni", body: "Yeni metin." })).status).toBe(201);
  });

  it("işletme geneli şablon BİR kez sayılır (daire sayısıyla çarpılmaz)", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "3");
    await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
    await seedTemplates(orgId, 2, { propertyId: null }); // iki daireli işletmede iki işletme geneli şablon = 2
    expect((await post({ title: "Daireye özel", body: "Daire metni.", propertyId })).status).toBe(201);
    expect((await post({ title: "Fazla", body: "Fazla metin." })).status).toBe(400);
    expect(await count(orgId)).toBe(3);
  });

  it("hazır Lixus şablonları sayılmaz; 'Kendime uyarla' ile kaydedilen kopya ev sahibinin kendi şablonudur ve sayılır", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "2");
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThan(2); // hazırlar sayılsaydı hiç ekleme yapılamazdı
    const d = DEFAULT_TEMPLATES[0]!;
    expect((await post({ title: d.title, body: d.body, category: d.category, language: d.language })).status).toBe(201);
    expect((await post({ title: "Kendi şablonum", body: "Kendi metnim." })).status).toBe(201);
    expect((await post({ title: d.title, body: d.body, category: d.category, language: d.language })).status).toBe(400);
    expect(await count(orgId)).toBe(2);
  });

  it("başka işletmenin şablonları sayılmaz", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "2");
    const other = await makeOrgWithProperty();
    await seedTemplates(other.orgId, 5);
    await seedTemplates(orgId, 1);
    expect((await post({ title: "Benim", body: "Benim metnim." })).status).toBe(201);
    expect(await count(other.orgId)).toBe(5);
  });

  it("MESSAGE_TEMPLATE_CAP yalnız geçerli bir sayıysa uygulanır; geçersiz değer sessizce plana döner", async () => {
    for (const bad of ["", "abc", "0", "-5", "1e3", "12.5", "1234567"]) {
      vi.stubEnv("MESSAGE_TEMPLATE_CAP", bad);
      expect(await messageTemplateCapForOrg(orgId), JSON.stringify(bad)).toBe(planLimitsFor("business").messageTemplatesPerOrg);
    }
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", " 750 ");
    expect(await messageTemplateCapForOrg(orgId)).toBe(750);
  });
});

describe("sınırı AŞMIŞ işletme — yalnız büyüme reddedilir", () => {
  it("🚨 hiçbir şablon silinmez; düzenleme, pasife alma, yeniden etkinleştirme ve silme çalışır, YALNIZ ekleme 400", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "3");
    await seedTemplates(orgId, 4);
    await seedTemplates(orgId, 1, { isActive: false });
    const rows = await prisma.messageTemplate.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(rows).toHaveLength(5);
    const passive = rows.find((r) => !r.isActive)!;
    const active = rows.find((r) => r.isActive)!;

    expect((await post({ title: "Yeni", body: "Yeni metin." })).status).toBe(400);
    expect((await patch(active.id, { title: "Düzenlendi", body: "Düzenlenen metin." })).status).toBe(200);
    expect((await patch(active.id, { isActive: false })).status).toBe(200);
    expect((await patch(passive.id, { isActive: true })).status).toBe(200); // yeniden etkinleştirme satır eklemez → sınırdan geçmez
    expect(await count(orgId)).toBe(5);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: active.id } })).title).toBe("Düzenlendi");

    // Silerek sınırın ALTINA inene kadar ekleme durur (4 → 3 hâlâ sınırda).
    expect((await del(rows[0]!.id)).status).toBe(200);
    expect((await del(rows[1]!.id)).status).toBe(200);
    expect((await post({ title: "Yeni", body: "Yeni metin." })).status).toBe(400);
    expect((await del(rows[2]!.id)).status).toBe(200);
    expect((await post({ title: "Yeni", body: "Yeni metin." })).status).toBe(201);
    expect(await count(orgId)).toBe(3);
  });
});
