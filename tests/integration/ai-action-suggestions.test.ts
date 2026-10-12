import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ⑤ YAPAY ZEKÂ EYLEM ÖNERİLERİ — gerçek PostgreSQL + gerçek rota (kurucu 10-12: "A + B + C", "öner + tek tıkla onay", onay "sahip +
// yönetici"). A görev · B Wi-Fi bilgi tabanı düzeltmesi · C söz kaydı. Öneri sunucuda veriden yeniden üretilir; karar AuditLog'ta;
// kiracılar arası / personel / destek görünümü / eşzamanlı onay / anahtar kapalı sınırları.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/ai-suggestions/route";
import { getConversationSuggestions, getPropertyWifiSuggestions, suggestionDecisions } from "@/lib/ai-suggestions/load";
import { promotionReadiness } from "@/lib/ai-suggestions/core";

const decide = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  } as never);

let seq = 0;
async function asUser(orgId: string, role: SessionPayload["role"] = "owner", extra: Partial<SessionPayload> = {}) {
  const u = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u${++seq}-${orgId}@x.com`, passwordHash: "x", role } });
  session = { userId: u.id, organizationId: orgId, role, email: u.email, name: "U", sessionEpoch: 0, ...extra } as SessionPayload;
  return u;
}

async function conversationWith(orgId: string, propertyId: string, msgs: { direction: "inbound" | "outbound"; authorType: string; body: string; minutesAgo?: number }[]) {
  const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
  const ids: string[] = [];
  for (const m of msgs) {
    const row = await prisma.message.create({
      data: {
        conversationId: c.id,
        direction: m.direction,
        authorType: m.authorType,
        senderName: m.authorType === "host" ? "Ev Sahibi" : "Misafir",
        body: m.body,
        createdAt: new Date(Date.now() - (m.minutesAgo ?? 5) * 60_000),
      },
    });
    ids.push(row.id);
  }
  return { conversationId: c.id, messageIds: ids };
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("A · görev önerisi", () => {
  it("misafir arızası → öneri; onay → kaynağa bağlı görev + karar kaydı; öneri kalkar; ikinci onay 409", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const { conversationId, messageIds } = await conversationWith(orgId, propertyId, [
      { direction: "inbound", authorType: "guest", body: "Klima çalışmıyor, oda çok sıcak." },
    ]);
    const [s] = await getConversationSuggestions(orgId, conversationId);
    expect(s).toMatchObject({ kind: "task", key: `task:${messageIds[0]}` });

    const res = await decide({ key: s.key, decision: "approve" });
    expect(res.status).toBe(200);
    const task = await prisma.task.findFirstOrThrow({ where: { sourceMessageId: messageIds[0] } });
    expect(task).toMatchObject({ propertyId, type: "maintenance", status: "todo" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "ai_suggestion.approved" } });
    expect(JSON.parse(audit.metadataJson!)).toMatchObject({ key: s.key, kind: "task", taskId: task.id });
    expect(audit.metadataJson).not.toContain("Klima"); // metin taşımaz

    expect(await getConversationSuggestions(orgId, conversationId)).toEqual([]);
    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(409);
    expect(await prisma.task.count({ where: { sourceMessageId: messageIds[0] } })).toBe(1);
  });

  it("aynı konuda açık görev zaten varsa (başka mesajdan) öneri çıkmaz (Haiku 10-12)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const first = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Klima çalışmıyor." }]);
    const [s] = await getConversationSuggestions(orgId, first.conversationId);
    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(200);
    const second = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Klima hâlâ çalışmıyor." }]);
    expect(await getConversationSuggestions(orgId, second.conversationId)).toEqual([]);
  });

  it("yok say → görev AÇILMAZ, karar kaydı dismissed, öneri kalkar; otomatik görev anahtarı AÇIK işletmede öneri yok (görev zaten kendiliğinden)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const { conversationId } = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Havlu yok, getirebilir misiniz?" }]);
    const [s] = await getConversationSuggestions(orgId, conversationId);
    expect(s?.kind).toBe("task");
    expect((await decide({ key: s.key, decision: "dismiss" })).status).toBe(200);
    expect(await prisma.task.count()).toBe(0);
    expect(await getConversationSuggestions(orgId, conversationId)).toEqual([]);

    await prisma.organization.update({ where: { id: orgId }, data: { autoTaskFromMessageEnabled: true } });
    const again = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Klima çalışmıyor." }]);
    expect(await getConversationSuggestions(orgId, again.conversationId)).toEqual([]);
  });

  it("🚨 eşzamanlı iki onay → TEK görev, TEK karar kaydı (kilit)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const { conversationId } = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Musluk bozuk, su akıtıyor." }]);
    const [s] = await getConversationSuggestions(orgId, conversationId);
    const statuses = (await Promise.all([decide({ key: s.key, decision: "approve" }), decide({ key: s.key, decision: "approve" })])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "ai_suggestion.approved" } })).toBe(1);
  });
});

describe("C · söz kaydı önerisi", () => {
  it("ev sahibinin sözü → öneri; saat düzenlenerek onay → açık söz + görev, karar 'düzenlendi'", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const { conversationId } = await conversationWith(orgId, propertyId, [
      { direction: "inbound", authorType: "guest", body: "Kombi çalışmıyor." },
      { direction: "outbound", authorType: "host", body: "Yarın teknisyen gelecek, kusura bakmayın." },
    ]);
    await prisma.organization.update({ where: { id: orgId }, data: { autoTaskFromMessageEnabled: true } }); // A önerisi karışmasın
    const [s] = await getConversationSuggestions(orgId, conversationId);
    expect(s).toMatchObject({ kind: "commitment", proposal: { commitmentKind: "maintenance", day: "tomorrow", time: "12:00" } });

    expect((await decide({ key: s.key, decision: "approve", day: "tomorrow", time: "25:00" })).status).toBe(400);
    const ok = await decide({ key: s.key, decision: "approve", day: "tomorrow", time: "10:00" });
    expect(ok.status).toBe(200);
    const c = await prisma.guestCommitment.findFirstOrThrow({ where: { conversationId } });
    expect(c).toMatchObject({ kind: "maintenance", status: "open" });
    expect(c.taskId).toBeTruthy();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ai_suggestion.approved" } });
    expect(JSON.parse(audit.metadataJson!)).toMatchObject({ kind: "commitment", edited: true, commitmentId: c.id });
    expect(await getConversationSuggestions(orgId, conversationId)).toEqual([]);
  });

  it("teklif / soru söz değildir → öneri yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const { conversationId } = await conversationWith(orgId, propertyId, [
      { direction: "outbound", authorType: "host", body: "İsterseniz havlu getirebilirim." },
      { direction: "outbound", authorType: "host", body: "Teknisyen yarın gelecek mi sizce?" },
    ]);
    expect(await getConversationSuggestions(orgId, conversationId)).toEqual([]);
  });
});

describe("B · Wi-Fi bilgi tabanı düzeltmesi", () => {
  it("misafire yazılan yeni şifre bilgi tabanında yok → öneri (maskeli); onay → kalem güncellenir; aynı şifre zaten varsa öneri yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    const kb = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ LaleNet, şifre: eskiSifre1", isActive: true, source: "host", reviewState: "approved" },
    });
    await conversationWith(orgId, propertyId, [{ direction: "outbound", authorType: "host", body: "Kusura bakmayın, yeni Wi-Fi şifresi: YeniSifre22" }]);
    const [s] = await getPropertyWifiSuggestions(orgId, propertyId);
    expect(s).toMatchObject({ kind: "kb_wifi", proposal: { kbItemId: kb.id, field: "password", masked: "••••22" } });
    expect(JSON.stringify(s)).not.toContain("YeniSifre22"); // kart şifreyi açık taşımaz

    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(200);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } })).content).toBe("Ağ LaleNet, şifre: YeniSifre22");
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toEqual([]);
  });

  it("hedef belirsizse öneri YOK: iki Wi-Fi kalemi (ana + misafir ağı) ya da kalemde iki şifre (Haiku 10-12)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Ana", content: "şifre: Abc12345 / misafir şifresi: Gst98765", isActive: true } });
    await conversationWith(orgId, propertyId, [{ direction: "outbound", authorType: "host", body: "Yeni Wi-Fi şifresi: YeniSifre22" }]);
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toEqual([]);
    await prisma.knowledgeBaseItem.deleteMany({});
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Ana", content: "şifre: Abc12345", isActive: true } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Misafir", content: "şifre: Gst98765", isActive: true } });
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toEqual([]);
  });
});

describe("sınırlar", () => {
  it("🚨 başka kiracının öneri anahtarı → 409, hiçbir şey değişmez", async () => {
    const a = await makeOrgWithProperty();
    const { conversationId } = await conversationWith(a.orgId, a.propertyId, [{ direction: "inbound", authorType: "guest", body: "Klima çalışmıyor." }]);
    const [s] = await getConversationSuggestions(a.orgId, conversationId);
    const b = await makeOrgWithProperty();
    await asUser(b.orgId);
    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(409);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("personel → 403; destek görünümü (bürünme) → yazma reddedilir; anahtar kapalı → 404; bozuk gövde → 400", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { conversationId } = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: "Klima çalışmıyor." }]);
    const [s] = await getConversationSuggestions(orgId, conversationId);
    await asUser(orgId, "staff");
    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(403);
    const operator = await prisma.user.create({ data: { organizationId: orgId, name: "Op", email: `op${++seq}@x.com`, passwordHash: "x", role: "owner" } });
    await asUser(orgId, "owner", { actorUserId: operator.id, impersonatedAt: Date.now() } as Partial<SessionPayload>);
    expect((await decide({ key: s.key, decision: "approve" })).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.task.count()).toBe(0);
    await asUser(orgId);
    expect((await decide({ key: s.key, decision: "maybe" })).status).toBe(400);
    expect((await decide({ decision: "approve" })).status).toBe(400);
    vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "");
    expect((await decide({ key: s.key, decision: "approve" })).status).toBe(404);
  });

  it("otomatiğe geçiş ölçütü karar kayıtlarından okunur (metin yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asUser(orgId);
    // Farklı konular (aynı konuda açık görev varken öneri çıkmaz — ↑).
    const bodies = ["Klima çalışmıyor.", "Havlu yok.", "Musluk bozuk."];
    for (let i = 0; i < 3; i++) {
      const { conversationId } = await conversationWith(orgId, propertyId, [{ direction: "inbound", authorType: "guest", body: bodies[i] }]);
      const [s] = await getConversationSuggestions(orgId, conversationId);
      await decide({ key: s.key, decision: i === 2 ? "dismiss" : "approve" });
    }
    const r = promotionReadiness(await suggestionDecisions(orgId, new Date(Date.now() - 14 * 86_400_000)), new Date());
    expect(r.task).toMatchObject({ decided: 3, cleanApproved: 2, ready: false });
  });
});
