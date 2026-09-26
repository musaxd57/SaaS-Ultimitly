import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EV KURALLARI — DEPO + KAYIT ROTASI + MÜLK SİLME (#188 dilim 2, migration'sız; DB gerçek). Pinlenen:
//  · depo: yaz → oku → güncelle (TEK satır) → boş liste kaldırır; bozuk satır = kural yok ("bana sor"); başka kiracı okuyamaz;
//    mülk silinmişse yazılmaz; eşzamanlı kayıtlar tek satır; erken giriş kuralıyla AYNI tabloda ama birbirine dokunmaz;
//  · rota: kart bayrağı kapalıyken YOK (404); yönetici yazar, personel 403, başka kiracının mülkü 404, geçersiz girdi 400 +
//    sade mesaj; ev sahibinin seçimi ONAY (`confirmed`); denetim kaydı konu adıyla, SEÇİM değeri olmadan;
//  · mülk silme: kural aynı işlemde silinir (sahipsiz kural kalmaz), sürmekte olan kaydı bekler.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PUT as putRules } from "@/app/api/properties/[id]/house-rules/route";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";
import { HOUSE_RULES_TRIGGER, houseRulesWhere, loadHouseRules, saveHouseRules } from "@/lib/house-rules/store";
import { earlyCheckinRuleWhere, loadEarlyCheckinRule, saveEarlyCheckinRule } from "@/lib/early-checkin/rules";
import type { HouseRule } from "@/lib/house-rules/core";

const RULES: HouseRule[] = [
  { topic: "smoking", policy: "forbidden", status: "confirmed" },
  { topic: "pets", policy: "allowed", status: "confirmed" },
];

let seq = 0;
async function org() {
  const o = await prisma.organization.create({ data: { name: "Test Org", timezone: "Europe/Istanbul" } });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale" } });
  const user = await prisma.user.create({
    data: { organizationId: o.id, name: "O", email: `hr-owner-${++seq}@example.com`, passwordHash: "x", role: "owner" },
  });
  return { orgId: o.id, propertyId: p.id, userId: user.id };
}

const sessionFor = (organizationId: string, userId: string, role: SessionPayload["role"] = "owner"): SessionPayload => ({
  userId,
  organizationId,
  role,
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
});

const put = (id: string, body: unknown) =>
  putRules(
    new NextRequest(`http://localhost/api/properties/${id}/house-rules`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
const delProperty = (id: string) =>
  deleteProperty(new NextRequest(`http://localhost/api/properties/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("HOUSE_RULES_CARD_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("depo (migration'sız, `AutomationRule`)", () => {
  it("yaz → oku → güncelle (tek satır) → boş liste kaldırır; başka kiracı okuyamaz", async () => {
    const a = await org();
    const b = await org();
    expect(await saveHouseRules(a.orgId, a.propertyId, RULES)).toBe(true);
    expect(await saveHouseRules(a.orgId, a.propertyId, [{ topic: "smoking", policy: "allowed", status: "confirmed" }])).toBe(true);
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual([{ topic: "smoking", policy: "allowed", status: "confirmed" }]);
    expect(await prisma.automationRule.count({ where: { organizationId: a.orgId, triggerType: HOUSE_RULES_TRIGGER } })).toBe(1);
    expect(await loadHouseRules(b.orgId, a.propertyId)).toEqual([]);
    expect(await saveHouseRules(a.orgId, a.propertyId, [])).toBe(true);
    expect(await prisma.automationRule.count()).toBe(0);
  });

  it("bozuk / geçersiz satır = kural YOK (her konu 'bana sor')", async () => {
    const a = await org();
    await saveHouseRules(a.orgId, a.propertyId, RULES);
    await prisma.automationRule.updateMany({ where: { organizationId: a.orgId }, data: { actionJson: "{bozuk" } });
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual([]);
    await prisma.automationRule.updateMany({
      where: { organizationId: a.orgId },
      data: { actionJson: JSON.stringify({ rules: [{ topic: "drugs", policy: "allowed", status: "confirmed" }] }) },
    });
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual([]);
    // KONTROL: geçerli satır aynen okunur.
    await prisma.automationRule.updateMany({ where: { organizationId: a.orgId }, data: { actionJson: JSON.stringify({ rules: RULES }) } });
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual(RULES);
  });

  it("erken giriş kuralıyla aynı tabloda, ama birbirine DOKUNMAZ (ayrı koşul)", async () => {
    const a = await org();
    await saveEarlyCheckinRule(a.orgId, a.propertyId, { mode: "draft", earliest: "12:00", fee: null, note: null });
    await saveHouseRules(a.orgId, a.propertyId, RULES);
    await saveHouseRules(a.orgId, a.propertyId, []);
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toMatchObject({ mode: "draft" });
    await saveHouseRules(a.orgId, a.propertyId, RULES);
    await saveEarlyCheckinRule(a.orgId, a.propertyId, null);
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual(RULES);
  });

  it("🚨 mülk silinmişse kural YAZILMAZ (sahipsiz kural yok)", async () => {
    const a = await org();
    await prisma.property.delete({ where: { id: a.propertyId } });
    expect(await saveHouseRules(a.orgId, a.propertyId, RULES)).toBe(false);
    expect(await prisma.automationRule.count({ where: houseRulesWhere(a.orgId, a.propertyId) })).toBe(0);
  });

  it("🚨 kilit DETERMİNİSTİK: başka bir yazıcı mülk satırını tutarken kayıt BEKLER, onun satırını görüp günceller", async () => {
    // Promise.all yarışı şansa bağlıdır; burada eşzamanlı yazıcı kilidi ELİNDE tutup satırını eklemiş ama bitirmemiş. Kilit
    // varsa kayıt bekler ve o satırı günceller (tek satır); kilit yoksa bitmemiş satırı göremez ve ikinci satırı yaratır.
    const a = await org();
    const where = houseRulesWhere(a.orgId, a.propertyId);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let holding!: () => void;
    const held = new Promise<void>((r) => (holding = r));
    const writer = prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT 1 FROM "Property" WHERE "id" = ${a.propertyId} FOR UPDATE`;
        await tx.automationRule.create({ data: { ...where, actionJson: JSON.stringify({ rules: RULES }), isEnabled: true, name: "Ev kuralları" } });
        holding();
        await hold;
      },
      { timeout: 15_000 },
    );
    await held;
    let settled = false;
    const save = saveHouseRules(a.orgId, a.propertyId, [{ topic: "visitors", policy: "forbidden", status: "confirmed" }]).finally(() => {
      settled = true;
    });
    for (let i = 0; i < 300 && !settled; i++) {
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE NOT granted`;
      if (n > 0n) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await writer;
    await save;
    expect(await prisma.automationRule.findMany({ where })).toHaveLength(1);
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual([{ topic: "visitors", policy: "forbidden", status: "confirmed" }]);
  });

  it("🚨 eşzamanlı kayıtlar (iki sekme / çift tık) TEK satır bırakır", async () => {
    const a = await org();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        saveHouseRules(a.orgId, a.propertyId, [{ topic: "pets", policy: i % 2 ? "allowed" : "forbidden", status: "confirmed" }]),
      ),
    );
    expect(await prisma.automationRule.count({ where: houseRulesWhere(a.orgId, a.propertyId) })).toBe(1);
  });
});

describe("PUT /api/properties/[id]/house-rules", () => {
  it("kart bayrağı KAPALIYKEN rota yok (404), hiçbir şey yazılmaz", async () => {
    const a = await org();
    session = sessionFor(a.orgId, a.userId);
    vi.stubEnv("HOUSE_RULES_CARD_ENABLED", "");
    expect((await put(a.propertyId, { rules: [{ topic: "pets", policy: "allowed" }] })).status).toBe(404);
    expect(await prisma.automationRule.count()).toBe(0);
    vi.stubEnv("HOUSE_RULES_CARD_ENABLED", "1");
    expect((await put(a.propertyId, { rules: [{ topic: "pets", policy: "allowed" }] })).status).toBe(200);
  });

  it("yönetici yazar; ev sahibinin seçimi ONAY; denetim kaydı konu adıyla, seçim DEĞERİ olmadan", async () => {
    const a = await org();
    session = sessionFor(a.orgId, a.userId);
    const res = await put(a.propertyId, {
      rules: [
        { topic: "smoking", policy: "forbidden" },
        { topic: "pets", policy: "ask_host", status: "suggested" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await loadHouseRules(a.orgId, a.propertyId)).toEqual([
      { topic: "smoking", policy: "forbidden", status: "confirmed" },
      { topic: "pets", policy: "ask_host", status: "confirmed" },
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: a.orgId, action: "property.house_rules_set" } });
    const meta = JSON.parse(audit.metadataJson ?? "{}") as { propertyId?: string; fields?: string[] };
    expect(meta).toEqual({ propertyId: a.propertyId, fields: ["smoking", "pets"] });
    expect(audit.metadataJson).not.toMatch(/forbidden|ask_host|allowed/);
  });

  it("🚨 personel 403; başka kiracının mülkü 404; geçersiz girdi 400 + sade mesaj", async () => {
    const a = await org();
    const b = await org();
    session = sessionFor(a.orgId, a.userId, "staff");
    expect((await put(a.propertyId, { rules: [{ topic: "pets", policy: "allowed" }] })).status).toBe(403);
    session = sessionFor(b.orgId, b.userId);
    expect((await put(a.propertyId, { rules: [{ topic: "pets", policy: "allowed" }] })).status).toBe(404);
    expect(await prisma.automationRule.count()).toBe(0);
    session = sessionFor(a.orgId, a.userId);
    for (const bad of [
      { rules: [{ topic: "pets", policy: "maybe" }] },
      { rules: [{ topic: "drugs", policy: "forbidden" }] },
      { rules: [{ topic: "pets", policy: "allowed" }, { topic: "pets", policy: "forbidden" }] },
      { rules: "pets" },
      [],
    ]) {
      const res = await put(a.propertyId, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { fields?: { _?: string } }).fields?._).toMatch(/^Kuralları kontrol edin/);
    }
    expect(await prisma.automationRule.count()).toBe(0);
    // Anti-vakum: geçerli istek çalışır.
    expect((await put(a.propertyId, { rules: [{ topic: "pets", policy: "allowed" }] })).status).toBe(200);
  });
});

describe("mülk silme", () => {
  it("🚨 mülk silinince ev kuralları da AYNI işlemde silinir; başka mülkün kuralı kalır", async () => {
    const a = await org();
    const other = await prisma.property.create({ data: { organizationId: a.orgId, name: "Diğer" } });
    session = sessionFor(a.orgId, a.userId);
    await saveHouseRules(a.orgId, a.propertyId, RULES);
    await saveHouseRules(a.orgId, other.id, RULES);
    expect((await delProperty(a.propertyId)).status).toBe(200);
    expect(await prisma.automationRule.count({ where: houseRulesWhere(a.orgId, a.propertyId) })).toBe(0);
    expect(await loadHouseRules(a.orgId, other.id)).toEqual(RULES);
  });

  it("🚨 mülk silme, sürmekte olan kural kaydını BEKLER ve onun satırını da siler (kilit sırası kayıtla aynı)", async () => {
    const a = await org();
    session = sessionFor(a.orgId, a.userId);
    const where = houseRulesWhere(a.orgId, a.propertyId);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let holding!: () => void;
    const held = new Promise<void>((r) => (holding = r));
    const saving = prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT 1 FROM "Property" WHERE "id" = ${a.propertyId} FOR UPDATE`;
        holding();
        await hold;
        await tx.automationRule.create({ data: { ...where, actionJson: JSON.stringify({ rules: RULES }), isEnabled: true, name: "Ev kuralları" } });
      },
      { timeout: 15_000 },
    );
    await held;
    const res = delProperty(a.propertyId);
    let settled = false;
    void res.finally(() => (settled = true)).catch(() => undefined);
    for (let i = 0; i < 300 && !settled; i++) {
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE NOT granted`;
      if (n > 0n) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await saving;
    expect((await res).status).toBe(200);
    expect(await prisma.property.count({ where: { id: a.propertyId } })).toBe(0);
    expect(await prisma.automationRule.count({ where })).toBe(0);
    expect(await prisma.automationRule.count({ where: earlyCheckinRuleWhere(a.orgId, a.propertyId) })).toBe(0);
  });
});
