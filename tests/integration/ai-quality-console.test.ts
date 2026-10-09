import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KURUCU KALİTE KONSOLU (kurucu talimatı 09-07; migration 60 §E) — talimatın test listesi, gerçek PostgreSQL:
//   · sıradan yönetici / 2FA'sız operatör / bürünmedeki operatör erişemez (ve deneme kayda girer)
//   · sorgu / gövde kimliğiyle kiracı süzgeci aşılamaz
//   · etiket müşteri verisini değiştiremez
//   · gönderim / durum değiştiren hiçbir uca konsoldan ulaşılamaz
//   · her görüntüleme amaçla kaydedilir; kayıtta operatörün kişisel verisi ve misafir metni yok
// `isSuperAdmin` GERÇEK (yalnız oturum enjekte edilir) — test edilen şey o.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as viewGet } from "@/app/api/admin/ai-quality/route";
import { POST as labelPost } from "@/app/api/admin/ai-quality/labels/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const DRAFT = "Merhaba Ayşe Yılmaz, kapı kodunuz 4711.";

async function seedOrg(name: string) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} Daire` } });
  const conv = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Ayşe Yılmaz",
      status: "answered",
      lastMessageAt: new Date(),
      messages: { create: [{ direction: "inbound", senderName: "Ayşe Yılmaz", body: "Kapı kodu?" }] },
    },
  });
  const gen = await prisma.aiGeneration.create({
    data: {
      organizationId: org.id,
      conversationId: conv.id,
      propertyId: property.id,
      surface: "channel_auto",
      model: "m",
      promptVersion: "p",
      decision: "auto_sent",
      draftText: `${name}: ${DRAFT}`,
      sentText: `${name}: ${DRAFT}`,
    },
  });
  return { orgId: org.id, conversationId: conv.id, generationId: gen.id };
}

async function makeSession(email: string, opts: { mfa: boolean; role?: string; impersonating?: boolean }): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: `Org ${email}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "U", email, passwordHash: "x", role: opts.role ?? "owner" },
  });
  return {
    userId: user.id,
    organizationId: org.id,
    role: (opts.role ?? "owner") as SessionPayload["role"],
    email,
    name: "U",
    sessionEpoch: 0,
    mfa: opts.mfa,
    ...(opts.impersonating ? { actorUserId: user.id } : {}),
  } as SessionPayload;
}

const viewReq = (q: Record<string, string>, headers?: Record<string, string>) =>
  new NextRequest(`http://localhost/api/admin/ai-quality?${new URLSearchParams(q)}`, { headers });
const labelReq = (body: unknown, headers?: Record<string, string>) =>
  new NextRequest("http://localhost/api/admin/ai-quality/labels", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("kalite konsolu — erişim kapısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    session = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("oturumsuz → 401, kayıt yok", async () => {
    const a = await seedOrg("Alfa");
    expect((await viewGet(viewReq({ orgId: a.orgId, purpose: "quality_review" }))).status).toBe(401);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it.each([
    ["sıradan sahip (owner)", "musteri@example.com", true, "owner"],
    ["sıradan yönetici (admin)", "yonetici@example.com", true, "admin"],
    ["operatör e-postası ama oturum 2FA'dan geçmemiş", OPERATOR_EMAIL, false, "owner"],
  ])("🚨 %s → 401, iz metni yanıtta yok, deneme KENDİ org'una kaydedilir", async (_n, email, mfa, role) => {
    const a = await seedOrg("Alfa");
    session = await makeSession(email, { mfa, role });
    const res = await viewGet(viewReq({ orgId: a.orgId, purpose: "quality_review" }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(DRAFT);
    const logs = await prisma.auditLog.findMany();
    expect(logs.map((l) => [l.organizationId, l.action])).toEqual([[session!.organizationId, "ai_quality.denied"]]);
    expect(JSON.parse(logs[0].metadataJson!)).toEqual({ reason: "not_operator", op: "view" });
    // Etiket ucu da aynı kapı.
    const lr = await labelPost(labelReq({ orgId: a.orgId, generationId: a.generationId, label: "correct", purpose: "quality_review" }));
    expect(lr.status).toBe(401);
    expect(await prisma.aiReviewLabel.count()).toBe(0);
  });

  it("🚨 bürünmedeki operatör → 403 (kendi hesabından açılır)", async () => {
    const a = await seedOrg("Alfa");
    session = await makeSession(OPERATOR_EMAIL, { mfa: true, impersonating: true });
    const res = await viewGet(viewReq({ orgId: a.orgId, purpose: "quality_review" }));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(DRAFT);
    expect((await prisma.auditLog.findFirstOrThrow()).action).toBe("ai_quality.denied");
  });

  it("🚨 başka siteden başlatılan istek → 403", async () => {
    const a = await seedOrg("Alfa");
    session = await makeSession(OPERATOR_EMAIL, { mfa: true });
    const res = await viewGet(viewReq({ orgId: a.orgId, purpose: "quality_review" }, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    const lr = await labelPost(
      labelReq({ orgId: a.orgId, generationId: a.generationId, label: "correct", purpose: "quality_review" }, { "sec-fetch-site": "cross-site" }),
    );
    expect(lr.status).toBe(403);
    expect(await prisma.aiReviewLabel.count()).toBe(0);
  });

  it.each<Record<string, string>>([{}, { purpose: "merak" }, { purpose: "Ayşe Yılmaz'ın şikâyeti" }])("🚨 amaç yok / kapalı küme dışı → 400 (%j)", async (q) => {
    const a = await seedOrg("Alfa");
    session = await makeSession(OPERATOR_EMAIL, { mfa: true });
    const res = await viewGet(viewReq({ orgId: a.orgId, ...q }));
    expect(res.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: "ai_quality.view" } })).toBe(0);
  });
});

describe("kalite konsolu — görüntüleme (operatör)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    session = await makeSession(OPERATOR_EMAIL, { mfa: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL: operatör yalnız SORDUĞU org'un izlerini görür; görüntüleme amaçla kaydedilir (IP / e-posta / metin yok)", async () => {
    const a = await seedOrg("Alfa");
    await seedOrg("Beta");
    const res = await viewGet(viewReq({ orgId: a.orgId, purpose: "incident_review", ticket: "T-42" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generations.map((g: { id: string }) => g.id)).toEqual([a.generationId]);
    expect(JSON.stringify(body)).not.toContain("Beta:");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "ai_quality.view" } });
    expect(log.organizationId).toBe(a.orgId);
    expect(log.actorUserId).toBe(session!.userId);
    expect(JSON.parse(log.metadataJson!)).toEqual({ purpose: "incident_review", ticket: "T-42", count: 1 });
    expect(log.metadataJson).not.toContain(OPERATOR_EMAIL);
    expect(log.metadataJson).not.toContain("Ayşe");
  });

  it("🚨 sayfa imleci başka kiracının iz kimliği olsa da süzgeç aşılmaz", async () => {
    const a = await seedOrg("Alfa");
    const b = await seedOrg("Beta");
    const res = await viewGet(viewReq({ orgId: a.orgId, purpose: "quality_review", before: b.generationId }));
    const body = await res.json();
    expect(body.generations.every((g: { draftText: string }) => g.draftText.startsWith("Alfa:"))).toBe(true);
  });
});

describe("kalite konsolu — etiket (tek yazma)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    session = await makeSession(OPERATOR_EMAIL, { mfa: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL: etiket yazılır; kayıtta not METNİ yok", async () => {
    const a = await seedOrg("Alfa");
    const res = await labelPost(
      labelReq({ orgId: a.orgId, generationId: a.generationId, label: "missed_context", note: "Ayşe'nin önceki mesajı atlanmış", purpose: "quality_review" }),
    );
    expect(res.status).toBe(201);
    const [l] = await prisma.aiReviewLabel.findMany();
    expect(l).toMatchObject({ generationId: a.generationId, label: "missed_context", note: "Ayşe'nin önceki mesajı atlanmış", reviewerUserId: session!.userId });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "ai_quality.label" } });
    expect(log.organizationId).toBe(a.orgId);
    expect(log.metadataJson).not.toContain("Ayşe");
    expect(JSON.parse(log.metadataJson!)).toMatchObject({ label: "missed_context", hasNote: true, purpose: "quality_review" });
  });

  it("🚨 gövdedeki org id ile iz kimliği farklı kiracılardan → 404, hiçbir şey yazılmaz", async () => {
    const a = await seedOrg("Alfa");
    const b = await seedOrg("Beta");
    const res = await labelPost(labelReq({ orgId: a.orgId, generationId: b.generationId, label: "correct", purpose: "quality_review" }));
    expect(res.status).toBe(404);
    expect(await prisma.aiReviewLabel.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "ai_quality.label" } })).toBe(0);
  });

  it.each([
    [{ label: "harika" }, "label"],
    [{ label: "correct", note: "x".repeat(1_001) }, "note"],
    [{ label: "correct", purpose: "merak" }, "purpose"],
  ])("🚨 geçersiz gövde %j → 400 (%s)", async (over, field) => {
    const a = await seedOrg("Alfa");
    const res = await labelPost(labelReq({ orgId: a.orgId, generationId: a.generationId, purpose: "quality_review", ...over }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toHaveProperty(field);
    expect(await prisma.aiReviewLabel.count()).toBe(0);
  });

  it("🚨 etiket müşteri verisini DEĞİŞTİRMEZ (mesaj, konuşma, iz, karar kaydı, kuyruk aynen)", async () => {
    const a = await seedOrg("Alfa");
    const snapshot = async () => ({
      messages: await prisma.message.findMany({ orderBy: { id: "asc" } }),
      conversations: await prisma.conversation.findMany({ orderBy: { id: "asc" } }),
      generations: await prisma.aiGeneration.findMany({ orderBy: { id: "asc" } }),
      riskEvents: await prisma.riskEvent.count(),
      outbox: await prisma.messageOutbox.count(),
      reservations: await prisma.reservation.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    const res = await labelPost(labelReq({ orgId: a.orgId, generationId: a.generationId, label: "unsafe_auto_send", purpose: "incident_review" }));
    expect(res.status).toBe(201);
    expect(await snapshot()).toEqual(before);
  });
});

describe("kalite konsolu — gönderim / durum değiştiren uca ulaşılamaz (yapısal)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const FILES = [
    "src/app/api/admin/ai-quality/route.ts",
    "src/app/api/admin/ai-quality/labels/route.ts",
    "src/lib/ai-quality/console.ts",
    "src/lib/ai-quality/gate.ts",
  ];

  it("konsol modülleri gönderim / kanal / kuyruk / otomasyon modülü import etmez", () => {
    for (const f of FILES) {
      expect(src(f), f).not.toMatch(/from "@\/lib\/(?:messaging|channels|outbox|automation|hospitable|email)/);
    }
  });

  it("görüntüleme rotası yalnız GET, etiket rotası yalnız POST dışa verir", () => {
    const methods = (f: string) => [...src(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    expect(methods("src/app/api/admin/ai-quality/route.ts")).toEqual(["GET"]);
    expect(methods("src/app/api/admin/ai-quality/labels/route.ts")).toEqual(["POST"]);
  });

  it("konsol kütüphanesi yalnız iz OKUR ve yalnız etiket OLUŞTURUR", () => {
    const s = src("src/lib/ai-quality/console.ts");
    const writes = [...s.matchAll(/\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(writes).toEqual(["aiReviewLabel.create"]);
  });
});
