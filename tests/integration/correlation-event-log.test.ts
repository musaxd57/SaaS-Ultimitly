import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// TAKİP NUMARASI + YALNIZ-EKLE OLAY GÜNLÜĞÜ — gerçek PostgreSQL + gerçek rotalar (kurucu kararı 10-10 §5, migration 63).
//  · Kimlikli istek: yanıt başlığı numarayı taşır; beklenmeyen hata → kurucunun metni + numara, olay günlüğünde AYNI numarayla satır.
//  · Ödeme zinciri: onay kaydı → (taze) webhook → abonelik AYNI numarayla; eski onaya bağlanan olay kendi numarasında.
//  · Bütünlük: UPDATE veritabanında reddedilir; işletme silinince satırları gider; dakikalık tavan; 90 gün süpürgesi.
//  · Operatör araması: süper-admin + 2FA, bürünmede yasak, site dışı istek reddi, zorunlu denetim kaydı, biçim denetimi.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { withAuth, CORRELATION_HEADER } from "@/lib/route-guard";
import { reportError } from "@/lib/report-error";
import { logEvent, pruneOperationalEvents, __resetEventLogLimits, EVENT_LOG_RETENTION_DAYS } from "@/lib/event-log";
import { POST as consentPost } from "@/app/api/billing/consent/route";
import { POST as pendingPost } from "@/app/api/billing/checkout-pending/route";
import { POST as webhookPost } from "@/app/api/webhooks/paddle/route";
import { GET as eventsGet } from "@/app/api/admin/events/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const OPERATOR_EMAIL = "operator@lixusai.com";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
}
const webhook = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return webhookPost(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
};
const events = (where: Record<string, unknown> = {}) => prisma.operationalEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function ownerOf(name = "Org") {
  const org = await prisma.organization.create({ data: { name } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "O", email: `o-${org.id}@x.com`, passwordHash: "x", role: "owner" },
  });
  return { orgId: org.id, userId: user.id, session: { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: "O", sessionEpoch: 0 } as SessionPayload };
}

/**
 * Test kümesi şemayı `db push` ile kurar → migration'daki ELLE yazılmış tetikleyiciler orada yok. Tetikleyiciler migration 63 / 64
 * dosyalarının KENDİ SQL'inden kurulur (sınanan şey migration metninin kendisi; dosyadan tetikleyici silinirse bu test kırmızı).
 */
beforeAll(async () => {
  // Fonksiyon gövdeleri ";" içerir → deyimler yalnız "CREATE" ile başlayan satırdan bölünür. 63: güncelleme reddi; 64: silme koruması.
  const statementsOf = (file: string, first: string) => {
    const sql = readFileSync(file, "utf8");
    const start = sql.indexOf(first);
    expect(start).toBeGreaterThanOrEqual(0);
    // Yorum satırları atılır (deyimler arasında açıklama olabilir), sonra bölünür.
    return sql
      .slice(start)
      .replace(/^--.*$/gm, "")
      .split(/;\s*\n(?=CREATE )/)
      .map((st) => st.trim().replace(/;\s*$/, ""));
  };
  const statements = [
    ...statementsOf("prisma/migrations/63_operational_event/migration.sql", 'CREATE FUNCTION "operational_event_append_only"'),
    ...statementsOf("prisma/migrations/64_operational_event_delete_guard/migration.sql", 'CREATE FUNCTION "operational_event_delete_guard"'),
  ];
  expect(statements.filter((st) => st.startsWith("CREATE TRIGGER"))).toHaveLength(3); // güncelleme + silme + TRUNCATE
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "OperationalEvent_append_only" ON "OperationalEvent"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "OperationalEvent_delete_guard" ON "OperationalEvent"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "operational_event_append_only"()');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "operational_event_delete_guard"()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "OperationalEvent_truncate_guard" ON "OperationalEvent"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "operational_event_truncate_guard"()');
  for (const st of statements) await prisma.$executeRawUnsafe(st);
});

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  __resetEventLogLimits();
  session = null;
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
  vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
});
afterEach(() => vi.unstubAllEnvs());

describe("kimlikli istek — numara başlıkta, hata günlükte aynı numarayla", () => {
  it("başarılı istek: her yanıtta FARKLI numara başlığı (sunucuda üretilir; istemcinin başlığı yok sayılır)", async () => {
    const o = await ownerOf();
    session = o.session;
    const route = withAuth(async () => Response.json({ ok: true }));
    const forged = "11111111-1111-4111-8111-111111111111";
    const req = () => new NextRequest("http://localhost/api/x", { headers: { [CORRELATION_HEADER]: forged } });
    const a = (await route(req(), ctx)).headers.get(CORRELATION_HEADER);
    const b = (await route(req(), ctx)).headers.get(CORRELATION_HEADER);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe(forged);
  });

  it("ödeme dışı uçta beklenmeyen hata: ekranda ESKİ metin (numara yok) ama başlıkta ve günlükte numara var (kurucu kararı 10-12 sabah)", async () => {
    const o = await ownerOf();
    session = o.session;
    const route = withAuth(async () => {
      throw new Error("beklenmeyen");
    });
    const res = await route(new NextRequest("http://localhost/api/tasks"), ctx);
    expect(res.status).toBe(500);
    const id = res.headers.get(CORRELATION_HEADER)!;
    const body = await res.json();
    expect(body.error).toBe("Beklenmeyen bir sorun oluştu. Sayfayı yenileyip durumu kontrol edin; sorun sürerse tekrar deneyin.");
    expect(body).not.toHaveProperty("correlationId");
    const rows = await waitFor(() => events({ correlationId: id }), (r) => r.length > 0);
    expect(rows).toMatchObject([{ event: "error.reported", organizationId: o.orgId }]);
  });

  it("🚨 ödeme ekranı ucunda beklenmeyen hata: 500 kurucu metni + kısa numara; olay günlüğünde AYNI numara + işletme ile 'error.reported'", async () => {
    const o = await ownerOf();
    session = o.session;
    const route = withAuth(async () => {
      throw new Error("beklenmeyen");
    });
    const res = await route(new NextRequest("http://localhost/api/billing/portal"), ctx);
    expect(res.status).toBe(500);
    const id = res.headers.get(CORRELATION_HEADER)!;
    const body = await res.json();
    expect(body.correlationId).toBe(id);
    expect(body.error).toBe(`Bir sorun oluştu. Destek ekibimize bu takip numarasıyla yazarak destek alabilirsiniz: ${id.slice(0, 8)}`);
    const rows = await waitFor(() => events({ correlationId: id }), (r) => r.length > 0);
    expect(rows).toMatchObject([{ event: "error.reported", level: "error", organizationId: o.orgId }]);
    expect(JSON.parse(rows[0].dataJson!)).toEqual({ context: "api" });
  });

  it("arka plan hatası (işlem yok): kendi numarası açılır, işletmesiz satır; bağlam adındaki boşluk koda indirgenir", async () => {
    await reportError("scheduled-sync retention", new Error("x"));
    expect(await events()).toMatchObject([{ event: "error.reported", organizationId: null }]);
    // Yalnız İLK kod belirteci (ad / kimlik gibi değişken parça günlüğe giremez).
    expect(JSON.parse((await events())[0].dataJson!)).toEqual({ context: "scheduled-sync" });
    await reportError("hospitable-sync org=cm123 Ayse Yilmaz", new Error("y"));
    expect(JSON.parse((await events({ correlationId: { not: (await events())[0].correlationId } }))[0].dataJson!)).toEqual({ context: "hospitable-sync" });
    // ":" sonrası kimlik atılır (kaynak başına sayaç anahtarı / günlük alanı açılmaz).
    await reportError("ical.reconcile:cmsourceid123", new Error("z"));
    expect((await events()).map((e) => JSON.parse(e.dataJson!).context)).toContain("ical.reconcile");
  });
});

describe("ödeme zinciri — onay → webhook → abonelik aynı numara", () => {
  const sub = (eventId: string, consentId: string) => ({
    event_id: eventId,
    event_type: "subscription.activated",
    occurred_at: new Date(Date.now() - 60_000).toISOString(),
    data: { id: `sub_${eventId}`, status: "active", customer_id: "ctm_1", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
  });

  it("🚨 taze onay: webhook olayları onay kaydının numarasıyla ve işletmesiyle yazılır", async () => {
    const o = await ownerOf();
    session = o.session;
    const res = await consentPost(
      new NextRequest("http://localhost/api/billing/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: "pro", priceId: "pri_pro" }),
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const chain = res.headers.get(CORRELATION_HEADER)!;
    const { consentId } = await res.json();
    expect((await prisma.checkoutConsent.findUniqueOrThrow({ where: { id: consentId } })).correlationId).toBe(chain);
    // "Ödemeniz işleniyor" (ayrı istek, kendi numarası) KENDİ işletmesinin onay satırından zincire katılır.
    const pending = await pendingPost(
      new NextRequest("http://localhost/api/billing/checkout-pending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consentId }),
      }),
      ctx,
    );
    expect(pending.status).toBe(200);
    expect(pending.headers.get(CORRELATION_HEADER)).toBe(chain); // zincire katılan istek başlıkta da zincirin numarasını taşır
    session = null;

    expect((await webhook(sub("evt_1", consentId))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { organizationId: o.orgId, status: "active" } })).toBe(1);
    const chainEvents = (await events({ correlationId: chain })).map((e) => [e.event, e.organizationId]);
    // Webhook zincire yalnız NUMARAYLA katılır; işletme yalnız bağlama kuralının kendisinden (abonelik satırı) gelir.
    expect(chainEvents).toEqual([
      ["billing.consent.created", o.orgId],
      ["billing.checkout.pending", o.orgId],
      ["billing.webhook.received", null],
      ["billing.subscription.applied", o.orgId],
      ["billing.webhook.processed", null],
    ]);
    // Aynı olay yeniden teslim edilirse: yinelenen kaydı da aynı zincirde.
    expect((await webhook(sub("evt_1", consentId))).status).toBe(200);
    expect((await events({ correlationId: chain })).map((e) => e.event)).toContain("billing.webhook.duplicate");
  });

  it("eski onay (bağlama tazeliğini geçmeyen): olay KENDİ numarasında kalır, onay zincirine karışmaz", async () => {
    const o = await ownerOf();
    const chain = "22222222-2222-4222-8222-222222222222";
    const consent = await prisma.checkoutConsent.create({
      data: { organizationId: o.orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "x", correlationId: chain, createdAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    expect((await webhook(sub("evt_old", consent.id))).status).toBe(200);
    expect(await events({ correlationId: chain })).toEqual([]);
    const received = await events({ event: "billing.webhook.received" });
    expect(received).toHaveLength(1);
    expect(received[0].correlationId).not.toBe(chain);
    // İşletmesiz "bağlanamadı" satırı Paddle abonelik kimliği TAŞIMAZ (işletme silinince kademeyle gitmez).
    const unlinked = await events({ event: "billing.webhook.unlinked" });
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].organizationId).toBeNull();
    expect(unlinked[0].dataJson).not.toMatch(/sub_/);
  });

  it("istemcinin custom_data'ya koyduğu numara zincir SEÇTİREMEZ (numara yalnız onay satırından okunur)", async () => {
    const o = await ownerOf();
    const consent = await prisma.checkoutConsent.create({
      data: { organizationId: o.orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "x", correlationId: null },
    });
    const victimChain = "33333333-3333-4333-8333-333333333333";
    const ev = sub("evt_cd", consent.id);
    (ev.data.custom_data as Record<string, unknown>).correlationId = victimChain;
    expect((await webhook(ev)).status).toBe(200);
    expect(await events({ correlationId: victimChain })).toEqual([]);
  });
});

describe("bütünlük — yalnız ekle, kademeli silme, tavan, saklama", () => {
  it("🚨 UPDATE veritabanında reddedilir (tetikleyici); satır değişmez", async () => {
    const o = await ownerOf();
    await logEvent("billing.consent.created", { plan: "pro" }, { organizationId: o.orgId });
    const [row] = await events();
    await expect(prisma.operationalEvent.update({ where: { id: row.id }, data: { level: "info", event: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.operationalEvent.updateMany({ data: { dataJson: null } })).rejects.toThrow(/append-only/);
    expect((await events())[0]).toEqual(row);
  });

  it("🚨 taze satır SİLİNEMEZ (yalnız saklama süresi aşılınca ya da işletmesi silinince)", async () => {
    const o = await ownerOf();
    await logEvent("billing.consent.created", {}, { organizationId: o.orgId });
    await logEvent("error.reported", { context: "x" }, { organizationId: null });
    await expect(prisma.operationalEvent.deleteMany({})).rejects.toThrow(/deleted only by retention/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "OperationalEvent"')).rejects.toThrow(/cannot be truncated/);
    expect(await prisma.operationalEvent.count()).toBe(2);
  });

  it("bellek tavanı: anahtar tablosu dolunca tavanlar SIFIRLANMAZ (dolu işletme dolu kalır), yeni anahtar reddedilir", async () => {
    const a = await ownerOf("A");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 125; i++) await logEvent("error.reported", { context: `c${i % 40}` }, { organizationId: a.orgId });
    expect(await prisma.operationalEvent.count({ where: { organizationId: a.orgId } })).toBe(120);
    // 5.000 farklı bağlam anahtarı (sistem) → tablo dolar; A'nın penceresi hâlâ geçerli → A yine 120'de kalır.
    for (let i = 0; i < 5_000; i++) await logEvent("error.reported", { context: `k${i}` }, { organizationId: null }).catch(() => {});
    await logEvent("error.reported", { context: "c1" }, { organizationId: a.orgId });
    expect(await prisma.operationalEvent.count({ where: { organizationId: a.orgId } })).toBe(120);
  });

  it("işletme silinince satırları gider; işletmesiz (sistem) satır kalır", async () => {
    const o = await ownerOf();
    await logEvent("billing.consent.created", {}, { organizationId: o.orgId });
    await logEvent("error.reported", { context: "x" }, { organizationId: null });
    await prisma.organization.delete({ where: { id: o.orgId } });
    expect((await events()).map((e) => e.organizationId)).toEqual([null]);
  });

  it("dakikalık tavan: ödeme olayları AYRI bütçede (hata seli ödeme izini boğamaz); aynı bağlamdan hata en fazla 5; başka işletme etkilenmez", async () => {
    const a = await ownerOf("A");
    const b = await ownerOf("B");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 130; i++) await logEvent("error.reported", { context: `ctx${i % 30}` }, { organizationId: a.orgId });
    for (let i = 0; i < 7; i++) await logEvent("error.reported", { context: "tek" }, { organizationId: b.orgId });
    for (let i = 0; i < 305; i++) await logEvent("billing.paddle.request", { httpStatus: 200 }, { organizationId: a.orgId });
    expect(await prisma.operationalEvent.count({ where: { organizationId: a.orgId, event: "error.reported" } })).toBe(120);
    expect(await prisma.operationalEvent.count({ where: { organizationId: a.orgId, event: "billing.paddle.request" } })).toBe(300);
    expect(await prisma.operationalEvent.count({ where: { organizationId: b.orgId } })).toBe(5);
  });

  it("arka plan iş olayları KENDİ bütçesinde: kuyruk satırı seli aynı işletmenin hata kaydını boğmaz", async () => {
    const a = await ownerOf("A");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 130; i++) await logEvent("job.outbox.row", { status: "sent" }, { organizationId: a.orgId });
    await logEvent("error.reported", { context: "outbox-row" }, { organizationId: a.orgId });
    expect(await prisma.operationalEvent.count({ where: { organizationId: a.orgId, event: "error.reported" } })).toBe(1);
  });

  it(`saklama: ${EVENT_LOG_RETENTION_DAYS} günden eski satırlar silinir, yenisi kalır`, async () => {
    const now = new Date();
    const day = 86_400_000;
    for (const [id, ageDays] of [["old", EVENT_LOG_RETENTION_DAYS + 1], ["edge", EVENT_LOG_RETENTION_DAYS - 1], ["new", 1]] as const) {
      await prisma.operationalEvent.create({
        data: { id, correlationId: "44444444-4444-4444-8444-444444444444", event: "error.reported", level: "error", createdAt: new Date(now.getTime() - ageDays * day) },
      });
    }
    expect(await pruneOperationalEvents(now)).toBe(1);
    expect((await events()).map((e) => e.id).sort()).toEqual(["edge", "new"]);
  });

  it("yazılamayan satır (silinmiş işletme) isteği bozmaz", async () => {
    await expect(logEvent("billing.consent.created", {}, { organizationId: "yok-boyle-isletme" })).resolves.toMatch(/^[0-9a-f-]{36}$/);
    expect(await events()).toEqual([]);
  });
});

describe("operatör araması — api/admin/events", () => {
  async function operator(mfa: boolean, extra: Partial<SessionPayload> = {}) {
    const org = await prisma.organization.create({ data: { name: "Op" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa, ...extra } as SessionPayload;
    return { orgId: org.id, userId: user.id };
  }
  const search = (q: string, headers?: Record<string, string>) => eventsGet(new NextRequest(`http://localhost/api/admin/events?id=${encodeURIComponent(q)}`, { headers }));

  it("süper-admin + 2FA: kısa ve tam numarayla bulur; arama denetim kaydına yazılır (numaranın yalnız ilk 8'i)", async () => {
    const customer = await ownerOf("Müşteri");
    const id = await logEvent("billing.consent.created", { plan: "pro" }, { organizationId: customer.orgId, correlationId: "55555555-5555-4555-8555-555555555555" });
    const op = await operator(true);
    const short = await search(id.slice(0, 8));
    expect(short.status).toBe(200);
    expect((await short.json()).events).toMatchObject([{ event: "billing.consent.created", organizationId: customer.orgId, data: { plan: "pro" } }]);
    expect(((await (await search(id)).json()).events as unknown[]).length).toBe(1);
    const audits = await prisma.auditLog.findMany({ where: { action: "operator.event_search" } });
    // Operatörün kendi kaydı + sonucu dönen işletmenin KENDİ kaydı (iki arama × iki işletme).
    expect(audits.filter((a) => a.organizationId === op.orgId)).toHaveLength(2);
    expect(audits.filter((a) => a.organizationId === customer.orgId)).toHaveLength(2);
    expect(audits.every((a) => a.actorUserId === op.userId && JSON.parse(a.metadataJson!).prefix === "55555555")).toBe(true);
  });

  it("🚨 2FA'sız operatör / sıradan müşteri → 401; bürünme → 403; başka sitenin yönlendirmesi → 403; bozuk numara → 400 (kayıt yazılır)", async () => {
    const op = await operator(false);
    const opSession = session!;
    expect((await search("55555555")).status).toBe(401);
    const customer = await ownerOf("Müşteri");
    session = { ...customer.session, mfa: true } as SessionPayload;
    expect((await search("55555555")).status).toBe(401);
    session = { ...opSession, mfa: true, actorUserId: op.userId, impersonatedAt: Date.now() } as SessionPayload;
    expect((await search("55555555")).status).toBe(403);
    session = { ...opSession, mfa: true } as SessionPayload;
    expect((await search("55555555", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await search("ab' OR 1=1 --")).status).toBe(400);
    expect((await search("7F3A91B2")).status).toBe(200); // büyük harf küçültülür
    expect(await prisma.auditLog.count({ where: { action: "operator.event_search", organizationId: op.orgId } })).toBe(2);
  });
});
