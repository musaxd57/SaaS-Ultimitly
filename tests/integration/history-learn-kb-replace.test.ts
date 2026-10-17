import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// L2 (kurucu 10-17, AYNEN: "host 1 kez mesela cevapladı ya wifiyi, daha güncel olanı doğru olarak seçti — bu artık doğru olsun") — gerçek
// PostgreSQL. Geçmişten öğren taslağı bilgi tabanında AYNI KONUDA etkin kalem bulursa onay seçim ister: eskisinin yerine koy (eski pasif +
// halef bağı, geri alınabilir) / ayrı ekle / vazgeç. Pinlenen: seçimsiz onay 409; yerine koy tek işlemde; ayrı ekle bugünkü davranış;
// kiracı / mülk dışı kalem → 409, hiçbir şey yazılmaz; plan sınırında yerine koy yapılabilir; eskiyi yeniden açınca halef bağı temizlenir.
// ---------------------------------------------------------------------------

let session: SessionPayload;
const limitsOverride = vi.hoisted(() => ({ items: null as number | null }));
vi.mock("@/lib/billing/plan-limits", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/plan-limits")>();
  return {
    ...actual,
    limitsForOrg: vi.fn(async (orgId: string) => {
      const l = await actual.limitsForOrg(orgId);
      return limitsOverride.items === null ? l : { ...l, kbItemsPerProperty: limitsOverride.items };
    }),
  };
});
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as getRuns } from "@/app/api/properties/[id]/history-learn/route";
import { PATCH as reviewDraft } from "@/app/api/history-learn/drafts/[id]/route";
import { PATCH as patchKb } from "@/app/api/kb/[id]/route";
import { __reviewHooks } from "@/lib/history-learn/service";

const owner = (organizationId: string): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role: "owner",
  email: "host@example.com",
  name: "O",
  sessionEpoch: 0,
});
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
const review = (id: string, body: unknown) => reviewDraft(json(`http://localhost/api/history-learn/drafts/${id}`, "PATCH", body), p({ id }));

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  // Denetim kaydı gerçek kullanıcıya bağlanır (FK) — seçim izinin yazıldığı sınanır.
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@example.com`, passwordHash: "x", role: "owner" } });
  session = { ...owner(orgId), userId: user.id };
  const oldKb = await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ: Lale_Ev · Şifre: yeni2025", isActive: true, reviewState: "approved" },
  });
  const run = await prisma.historyLearnRun.create({ data: { organizationId: orgId, propertyId, model: "m", status: "done" } });
  const draft = await prisma.historyLearnDraft.create({
    data: { runId: run.id, propertyId, category: "wifi", title: "Wi-Fi", content: "Şifre: lale2024", supportConversations: 4 },
  });
  return { orgId, propertyId, oldKb, draft };
}

describe("Geçmişten öğren × bilgi tabanı — eskisinin yerine koy (L2)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("HISTORY_LEARN_ENABLED", "1");
    limitsOverride.items = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    limitsOverride.items = null;
    __reviewHooks.beforeWrite = null;
  });

  it("🚨 aynı konuda kalem varken seçimsiz onay 409 needsResolution + eşleşme ('Kayıtlı değer farklı'); liste ekranı da eşleşmeyi taşır", async () => {
    const { propertyId, oldKb, draft } = await seed();
    const list = await (await getRuns(json(`http://localhost/api/properties/${propertyId}/history-learn`, "GET"), p({ id: propertyId }))).json();
    expect(list.drafts[0].kbMatches).toEqual([{ id: oldKb.id, title: "Wi-Fi", preview: "Ağ: Lale_Ev · Şifre: yeni2025", kind: "differs" }]);
    const res = await review(draft.id, { action: "approve" });
    expect(res.status).toBe(409); // ⬅️ ESKİDE 200 + iki etkin Wi-Fi kalemi (yapay zekâ ikisini birden görüyordu)
    const body = await res.json();
    expect(body.needsResolution).toBe(true);
    expect(body.matches.map((m: { id: string; kind: string }) => [m.id, m.kind])).toEqual([[oldKb.id, "differs"]]);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
    expect((await prisma.historyLearnDraft.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("pending");
  });

  it("🚨 yerine koy: yeni kalem etkin, eski PASİF + halef bağı + an (silinmez); denetim kaydı seçimi taşır, metni taşımaz", async () => {
    const { orgId, propertyId, oldKb, draft } = await seed();
    const res = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: oldKb.id });
    const resBody = await res.json();
    expect(res.status, JSON.stringify(resBody)).toBe(200);
    const { kbItemId, replacedKbItemId } = resBody;
    expect(replacedKbItemId).toBe(oldKb.id);
    const [fresh, old] = await Promise.all([
      prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kbItemId } }),
      prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: oldKb.id } }),
    ]);
    expect(fresh).toMatchObject({ isActive: true, content: "Şifre: lale2024", supersededById: null });
    expect(old).toMatchObject({ isActive: false, supersededById: kbItemId, content: "Ağ: Lale_Ev · Şifre: yeni2025" });
    expect(old.supersededAt).toBeInstanceOf(Date);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "history_learn.draft_approved" } });
    expect(JSON.parse(audit.metadataJson ?? "{}")).toMatchObject({ resolution: "replace", replacedKbItemId: oldKb.id });
    expect(audit.metadataJson).not.toMatch(/lale2024|yeni2025/);
  });

  it("ayrı ekle: iki kalem de etkin (bugünkü davranış, ev sahibinin açık seçimi)", async () => {
    const { propertyId, draft } = await seed();
    const res = await review(draft.id, { action: "approve", resolution: "separate" });
    expect(res.status).toBe(200);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId, isActive: true } })).toBe(2);
  });

  it("🚨 kiracı / mülk dışı kalem 'yerine koy' hedefi olamaz → 409 kbChanged, HİÇBİR şey yazılmaz", async () => {
    const { propertyId, oldKb, draft } = await seed();
    const other = await makeOrgWithProperty();
    const foreign = await prisma.knowledgeBaseItem.create({
      data: { propertyId: other.propertyId, category: "wifi", title: "Wi-Fi", content: "Şifre: baska99", isActive: true, reviewState: "approved" },
    });
    const res = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: foreign.id });
    expect(res.status).toBe(409);
    expect((await res.json()).kbChanged).toBe(true);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: foreign.id } })).isActive).toBe(true);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: oldKb.id } })).isActive).toBe(true);
    expect((await prisma.historyLearnDraft.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("pending");
  });

  it("eski kalem arada pasife alındı (artık aday değil): yerine koy 409 kbChanged; yeni kalem açılmaz", async () => {
    const { propertyId, oldKb, draft } = await seed();
    await prisma.knowledgeBaseItem.update({ where: { id: oldKb.id }, data: { isActive: false } });
    const res = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: oldKb.id });
    expect(res.status).toBe(409);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 YARIŞ: eşleşme hesaplandıktan SONRA eski kalem başka sekmede pasife alındı → işlem GERİ ALINIR (409, yeni kalem yok, taslak bekliyor)", async () => {
    const { propertyId, oldKb, draft } = await seed();
    __reviewHooks.beforeWrite = async () => {
      await prisma.knowledgeBaseItem.update({ where: { id: oldKb.id }, data: { isActive: false } });
    };
    const res = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: oldKb.id });
    expect(res.status).toBe(409);
    expect((await res.json()).kbChanged).toBe(true);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1); // yeni kalem geri alındı
    expect(await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: oldKb.id } })).toMatchObject({ supersededById: null });
    expect((await prisma.historyLearnDraft.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("pending");
  });

  it("🚨 aynı mülkte ama BAŞKA KONUDAKİ kalem (eşleşme değil) yerine konamaz → 409; o kalem etkin kalır", async () => {
    const { propertyId, draft } = await seed();
    const parking = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "parking", title: "Otopark", content: "Binanın arkasında.", isActive: true, reviewState: "approved" },
    });
    const res = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: parking.id });
    expect(res.status).toBe(409);
    expect(await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: parking.id } })).toMatchObject({ isActive: true, supersededById: null });
  });

  it("plan sınırında (dolu): yerine koy YAPILABİLİR (sayı artmaz), ayrı ekle plan sınırı der", async () => {
    const { oldKb, draft } = await seed();
    limitsOverride.items = 1;
    const separate = await review(draft.id, { action: "approve", resolution: "separate" });
    expect(separate.status).toBe(400);
    const replace = await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: oldKb.id });
    expect(replace.status).toBe(200);
  });

  it("🚨 GERİ AL: eski kalemi Bilgi Tabanı'ndan yeniden etkinleştirince halef bağı temizlenir (yoksa getirme onu sessizce düşürürdü); yeni kalem etkin kalır", async () => {
    const { propertyId, oldKb, draft } = await seed();
    const { kbItemId } = await (await review(draft.id, { action: "approve", resolution: "replace", replaceKbItemId: oldKb.id })).json();
    const res = await patchKb(json(`http://localhost/api/kb/${oldKb.id}`, "PATCH", { isActive: true }), p({ id: oldKb.id }));
    expect(res.status).toBe(200);
    expect(await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: oldKb.id } })).toMatchObject({
      isActive: true,
      supersededById: null,
      supersededAt: null,
    });
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kbItemId } })).isActive).toBe(true);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId, isActive: true } })).toBe(2);
  });

  it("KONTROL: bilgi tabanında aynı konu yoksa onay seçim istemez (bugünkü tek tık)", async () => {
    const { propertyId, oldKb, draft } = await seed();
    await prisma.knowledgeBaseItem.delete({ where: { id: oldKb.id } });
    expect((await review(draft.id, { action: "approve" })).status).toBe(200);
    expect(await prisma.knowledgeBaseItem.count({ where: { propertyId } })).toBe(1);
  });
});
