import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ŞABLON İNDİR + BİLGİ TABANINI DIŞA AKTAR uçları (kurucu 10-28 §7-A: deneme sürümünde YOK). Faturalandırma zorunluyken: süren deneme →
// 403 (sade metin); ücretli / eski hesap → dosya. Dışa aktarma: yalnız kendi işletmesi, yalnız etkin kalem, destek görünümü kapalı, denetim kaydı.
// ---------------------------------------------------------------------------
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
import { GET as TEMPLATE } from "@/app/api/kb/template/route";
import { GET as EXPORT } from "@/app/api/kb/export/route";

const call = (handler: typeof EXPORT, url: string) => handler(new NextRequest(`http://localhost${url}`), { params: Promise.resolve({}) } as never);

describe("şablon / dışa aktarma uçları", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("BILLING_ENFORCED", "true");
    ({ orgId, propertyId } = await makeOrgWithProperty());
    const u = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "O" } as SessionPayload;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 süren DENEME sürümünde ikisi de 403 (sade metin); abonelik kaydı olmayan eski hesapta açık", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "trialing", provider: "trial", trialEndsAt: new Date(Date.now() + 5 * 86_400_000) },
    });
    for (const [h, url] of [[TEMPLATE, "/api/kb/template"], [EXPORT, "/api/kb/export"]] as const) {
      const res = await call(h, url);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain("deneme sürümünde kullanılamaz");
    }
    await prisma.subscription.deleteMany({ where: { organizationId: orgId } });
    expect((await call(TEMPLATE, "/api/kb/template")).status).toBe(200);
  });

  it("şablon: düz metin ek dosyası, Türkçe başlıklar; ?lang=en İngilizce", async () => {
    const res = await call(TEMPLATE, "/api/kb/template");
    expect(res.headers.get("content-disposition")).toContain("bilgi-tabani-sablonu.txt");
    expect(await res.text()).toContain("Wi-Fi şifresi: ____");
    expect(await (await call(TEMPLATE, "/api/kb/template?lang=en")).text()).toContain("Wi-Fi password: ____");
  });

  it("🚨 dışa aktarma: yalnız kendi işletmesi + yalnız etkin ve onaylı kalem; başka işletmenin dairesi 404; denetim kaydı", async () => {
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Şifre: abc12345", isActive: true } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "parking", title: "Otopark", content: "ESKİ BİLGİ", isActive: false } });
    // Onay bekleyen taslak (Haiku 10-28): yapay zekânın okumadığı kalem dosyaya da girmez — yeniden yüklemede ev sahibinin metni gibi dönmesin.
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "rules", title: "Kurallar", content: "ONAYSIZ TASLAK", isActive: true, reviewState: "draft" } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "trash", title: "Çöp", content: "ONAYLI KALEM", isActive: true, reviewState: "approved" } });
    const other = await makeOrgWithProperty();
    await prisma.knowledgeBaseItem.create({ data: { propertyId: other.propertyId, category: "wifi", title: "Wi-Fi", content: "BAŞKA İŞLETME", isActive: true } });

    const text = await (await call(EXPORT, "/api/kb/export")).text();
    expect(text).toContain("Şifre: abc12345");
    expect(text).not.toContain("ESKİ BİLGİ");
    expect(text).not.toContain("ONAYSIZ TASLAK");
    expect(text).toContain("ONAYLI KALEM");
    expect(text).not.toContain("BAŞKA İŞLETME");
    expect((await call(EXPORT, `/api/kb/export?propertyId=${other.propertyId}`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "kb.export" } })).toBe(1);
  });

  it("🚨 destek görünümünde (bürünme) dışa aktarma kapalı; personel rolü kapalı", async () => {
    session = { ...session, actorUserId: "operator-1" } as SessionPayload;
    expect((await call(EXPORT, "/api/kb/export")).status).toBe(403);
    session = { userId: "s", organizationId: orgId, role: "staff", email: "s@x.com", name: "S" } as SessionPayload;
    expect((await call(EXPORT, "/api/kb/export")).status).toBe(403);
    expect((await call(TEMPLATE, "/api/kb/template")).status).toBe(403);
  });
});
