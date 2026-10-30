import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET, POST, DELETE } from "@/app/api/settings/host-channel/route";
import { confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { HOST_CHANNEL_CONSENT_VERSION } from "@/lib/host-channel/consent";

// ---------------------------------------------------------------------------
// Ayarlar › WhatsApp bildirimleri rotası (tasarım §5.3–5.4) — gerçek veritabanı. Pinlenen: anahtar kapalı / liste dışı / numaramız yok →
// `available:false` ve başlatma reddi; rıza kutusu şart; numara düz saklanmaz, yanıtta yalnız maskeli; kod + wa.me bağlantısı yalnız bu yanıtta;
// başka hesabın numarası için GENEL cümle (yoklama yok); hız sınırı; kullanıcı yalnız KENDİ bağlantısını görür / kaldırır (başka kullanıcı,
// başka işletme dokunamaz); personel ve bürünme yazamaz; denetim kaydında numara / kod yok.
// ---------------------------------------------------------------------------

const SECRET = "test-host-channel-secret-0123456789abcdef";
const URL_ = "https://www.lixusai.com/api/settings/host-channel";

async function seedUser(role = "owner", orgId?: string) {
  const organizationId = orgId ?? (await prisma.organization.create({ data: { name: "Test Org" } })).id;
  const user = await prisma.user.create({
    data: { organizationId, name: "Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role },
  });
  return { organizationId, userId: user.id };
}
const asSession = (o: { organizationId: string; userId: string }, role = "owner", extra: Partial<SessionPayload> = {}): SessionPayload =>
  ({ userId: o.userId, organizationId: o.organizationId, role, email: "o@example.test", name: "O", sessionEpoch: 0, ...extra }) as SessionPayload;

const get = async () => (await GET(new NextRequest(URL_), { params: Promise.resolve({}) } as never)) as Response;
const post = async (body: unknown) =>
  (await POST(
    new NextRequest(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) } as never,
  )) as Response;
const del = async () => (await DELETE(new NextRequest(URL_, { method: "DELETE" }), { params: Promise.resolve({}) } as never)) as Response;

function flagsOn(orgIds = "*") {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", orgIds);
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", SECRET);
  vi.stubEnv("WHATSAPP_BUSINESS_NUMBER", "+90 555 000 00 00");
}

describe("Ayarlar › WhatsApp bildirimleri", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.rateLimitCounter.deleteMany();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtar kapalı / liste dışı işletme / numaramız yapılandırılmamış → available:false ve başlatma reddedilir (satır yazılmaz)", async () => {
    const o = await seedUser();
    session = asSession(o);
    expect(await (await get()).json()).toEqual({ available: false });
    expect((await post({ number: "+90 532 123 45 67", consent: true })).status).toBe(400);

    flagsOn("baska-isletme");
    expect(await (await get()).json()).toEqual({ available: false });
    flagsOn();
    vi.stubEnv("WHATSAPP_BUSINESS_NUMBER", "");
    expect(await (await get()).json()).toEqual({ available: false });
    expect((await post({ number: "+90 532 123 45 67", consent: true })).status).toBe(400);
    expect(await prisma.hostChannelBinding.count()).toBe(0);
  });

  it("başlat: rıza şart; kod + wa.me bağlantısı + maskeli numara; numara / kod düz saklanmaz; rıza sürümü yazılır; denetim kaydında numara yok", async () => {
    flagsOn();
    const o = await seedUser();
    session = asSession(o);
    const noConsent = await post({ number: "+90 532 123 45 67", consent: false });
    expect(noConsent.status).toBe(400);
    expect(await prisma.hostChannelBinding.count()).toBe(0);

    const res = await post({ number: "+90 532 123 45 67", consent: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.code).toMatch(/^LIXUS-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(body.masked).toBe("+•• ••• ••• •• 67");
    expect(body.link).toBe(`https://wa.me/905550000000?text=${encodeURIComponent(body.code)}`);
    expect(JSON.stringify(body)).not.toContain("5321234567");
    const row = await prisma.hostChannelBinding.findFirstOrThrow();
    expect(row).toMatchObject({ organizationId: o.organizationId, userId: o.userId, status: "pending", provider: WHATSAPP_CLOUD_PROVIDER });
    expect(row.optInTextVersion).toBe(HOST_CHANNEL_CONSENT_VERSION);
    expect(JSON.stringify(row)).not.toMatch(/5321234567|LIXUS/);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "host_channel.binding_started" } });
    expect(JSON.stringify(audit)).not.toMatch(/5321234567|LIXUS/);

    // Bekleyen durum ekranda; kod bir daha GÖSTERİLMEZ (yalnız başlatma yanıtında).
    const st = await (await get()).json();
    expect(st).toMatchObject({ available: true, binding: { status: "pending", masked: "+•• ••• ••• •• 67" } });
    expect(JSON.stringify(st)).not.toContain(body.code);

    // Süresi dolmuş kod ekranda "bekleniyor" diye asılı kalmaz: yeniden başlatma formu döner.
    await prisma.hostChannelBinding.updateMany({ data: { verifyExpiresAt: new Date(Date.now() - 1_000) } });
    expect(await (await get()).json()).toMatchObject({ available: true, binding: null });
    await prisma.hostChannelBinding.updateMany({ data: { verifyExpiresAt: new Date(Date.now() + 600_000) } });

    // Ev sahibi kodu kendi numarasından gönderdi (web kancası) → ekranda bağlı.
    const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: "905321234567", code: body.code });
    expect(c.ok).toBe(true);
    expect(await (await get()).json()).toMatchObject({ binding: { status: "active", masked: "+•• ••• ••• •• 67", expiresAt: null } });

    // Şifre değişimi (oturum kuşağı) → askıya alındı, yeniden doğrulama ister.
    await prisma.user.update({ where: { id: o.userId }, data: { sessionEpoch: { increment: 1 } } });
    expect(await (await get()).json()).toMatchObject({ binding: { status: "suspended" } });
  });

  it("ülke kodsuz numara → yol gösteren cümle; başka hesapta bağlı numara → GENEL cümle (yoklama yok)", async () => {
    flagsOn();
    const a = await seedUser();
    session = asSession(a);
    const bad = await post({ number: "0532 123 45 67", consent: true });
    expect(bad.status).toBe(400);
    expect((await bad.json()).fields.number).toMatch(/ülke koduyla/);

    const ra = await (await post({ number: "+90 532 123 45 67", consent: true })).json();
    await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: "905321234567", code: ra.code });

    const b = await seedUser();
    session = asSession(b);
    const taken = await post({ number: "+90 532 123 45 67", consent: true });
    expect(taken.status).toBe(400);
    const msg = (await taken.json()).fields.number as string;
    expect(msg).toBe("Bu numara şu anda bağlanamıyor. Başka bir numara deneyin ya da daha sonra tekrar deneyin.");
    // Bekleyen başka hesap da AYNI cümle (iki durum ayırt edilemez).
    const c = await seedUser();
    session = asSession(c);
    await post({ number: "+49 151 12345678", consent: true });
    session = asSession(b);
    const pendingElsewhere = await post({ number: "+49 151 12345678", consent: true });
    expect((await pendingElsewhere.json()).fields.number).toBe(msg);
  });

  it("hız sınırı: kullanıcı başına 15 dakikada 5 başlatma", async () => {
    flagsOn();
    const o = await seedUser();
    session = asSession(o);
    for (let i = 0; i < 5; i++) expect((await post({ number: `+90 532 123 45 6${i}`, consent: true })).status).toBe(200);
    expect((await post({ number: "+90 532 123 45 69", consent: true })).status).toBe(429);
  });

  it("🚨 kullanıcı yalnız KENDİ bağlantısını görür ve kaldırır — aynı işletmedeki başka yönetici ya da başka işletme dokunamaz", async () => {
    flagsOn();
    const a = await seedUser();
    session = asSession(a);
    const ra = await (await post({ number: "+90 532 123 45 67", consent: true })).json();
    await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: "905321234567", code: ra.code });

    const sameOrgManager = await seedUser("manager", a.organizationId);
    session = asSession(sameOrgManager, "manager");
    expect(await (await get()).json()).toMatchObject({ available: true, binding: null });
    expect(await (await del()).json()).toEqual({ revoked: false });

    const other = await seedUser();
    session = asSession(other);
    expect(await (await get()).json()).toMatchObject({ binding: null });
    expect(await (await del()).json()).toEqual({ revoked: false });

    expect((await prisma.hostChannelBinding.findFirstOrThrow()).status).toBe("active");
    session = asSession(a);
    expect(await (await del()).json()).toEqual({ revoked: true });
    expect(await prisma.hostChannelBinding.findFirstOrThrow()).toMatchObject({ status: "revoked", revokedReason: "user" });
    expect(await prisma.auditLog.count({ where: { action: "host_channel.binding_revoked" } })).toBe(1);
    expect(await (await get()).json()).toMatchObject({ binding: null });
  });

  it("personel erişemez; bürünmede (destek görünümü) başlatma ve kaldırma kapalı", async () => {
    flagsOn();
    const staff = await seedUser("staff");
    session = asSession(staff, "staff");
    expect((await get()).status).toBe(403);
    expect((await post({ number: "+90 532 123 45 67", consent: true })).status).toBe(403);

    const o = await seedUser();
    session = asSession(o, "owner", { actorUserId: "operator-1", impersonatedAt: Math.floor(Date.now() / 1000) } as Partial<SessionPayload>);
    expect((await post({ number: "+90 532 123 45 67", consent: true })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(await prisma.hostChannelBinding.count()).toBe(0);
  });
});
