import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  confirmHostBindingFromInbound,
  hostChannelSecret,
  revokeHostBinding,
  startHostBinding,
  usableHostBindingForOrg,
} from "@/lib/host-channel/binding";
import { BINDING_CODE_MAX_ATTEMPTS, BINDING_CODE_TTL_MS } from "@/lib/host-channel/binding-code";

// ---------------------------------------------------------------------------
// WhatsApp numara bağlama — veritabanı katmanı (tasarım §5.3–5.5, migration 88). Gerçek veritabanı. Pinlenen: numara düz saklanmaz; ev sahibinin
// KENDİ numarasından gelen doğru kod bağlantıyı etkinleştirir; başka numaradan / yanlış / süresi dolmuş / deneme hakkı bitmiş kod etkinleştirmez;
// başka hesabın etkin bağlantısı ve süresi dolmamış bekleyen kodu devralınamaz; kullanıcı başına tek etkin numara; oturum kuşağı artınca ve rol
// düşünce bağlantı soru almaz; anahtar yoksa bağlama kapalı.
// ---------------------------------------------------------------------------

const SECRET = "test-host-channel-secret-0123456789abcdef";
const P = "fake";
const NUM = "+90 532 123 45 67";
const DIGITS = "905321234567";

async function seedUser(role = "owner") {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role },
  });
  return { orgId: org.id, userId: user.id };
}
const start = (o: { orgId: string; userId: string }, raw = NUM, now?: Date) =>
  startHostBinding({ organizationId: o.orgId, userId: o.userId, provider: P, rawNumber: raw, optInTextVersion: "v1", now });

describe("WhatsApp numara bağlama", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("anahtar yok ya da kısa → bağlama kapalı (zayıf özet üretilmez)", async () => {
    const o = await seedUser();
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "kisa");
    expect(hostChannelSecret()).toBeNull();
    expect(await start(o)).toEqual({ ok: false, reason: "disabled" });
    expect(await prisma.hostChannelBinding.count()).toBe(0);
  });

  it("başlat: numara düz saklanmaz, kod saklanmaz, maskeli gösterim; ülke kodsuz numara reddedilir", async () => {
    const o = await seedUser();
    expect(await start(o, "0532 123 45 67")).toEqual({ ok: false, reason: "bad_number" });
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    expect(r.code).toMatch(/^LIXUS-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(r.masked).toBe("+•• ••• ••• •• 67");
    const row = await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } });
    expect(row.status).toBe("pending");
    expect(JSON.stringify(row)).not.toContain("5321234567");
    expect(JSON.stringify(row)).not.toContain(r.code.slice(6));
    expect(row.optInTextVersion).toBe("v1");
  });

  it("ev sahibinin KENDİ numarasından doğru kod → etkin; oturum kuşağı yazılır; kod silinir", async () => {
    const o = await seedUser();
    await prisma.user.update({ where: { id: o.userId }, data: { sessionEpoch: 4 } });
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    const c = await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code });
    expect(c).toEqual({ ok: true, bindingId: r.bindingId, organizationId: o.orgId, userId: o.userId });
    const row = await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } });
    expect(row).toMatchObject({ status: "active", userSessionEpoch: 4, verifyCodeHash: null, verifyExpiresAt: null });
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: r.bindingId, userId: o.userId });
    // Aynı kod ikinci kez: artık bekleyen değil.
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code })).toEqual({ ok: false, reason: "not_pending" });
  });

  it("başka numaradan doğru kod etkinleştirmez (kod numaraya değil, numara satırına bağlı)", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: "905321234568", code: r.code })).toEqual({
      ok: false,
      reason: "unknown_address",
    });
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).status).toBe("pending");
  });

  it("yanlış kod sayılır; hak bitince doğru kod da kabul edilmez; süre dolunca da", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    for (let i = 0; i < BINDING_CODE_MAX_ATTEMPTS; i++) {
      expect((await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: "LIXUS-000000" })).ok).toBe(false);
    }
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code })).toEqual({ ok: false, reason: "too_many_attempts" });

    const t0 = new Date("2026-10-30T20:00:00Z");
    const r2 = await start(o, NUM, t0);
    if (!r2.ok) throw new Error(r2.reason);
    const late = new Date(t0.getTime() + BINDING_CODE_TTL_MS + 1);
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r2.code, now: late })).toEqual({ ok: false, reason: "expired" });
  });

  it("eşzamanlı yanlış kodlar deneme sayacını tavanın üstüne taşıyamaz", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    const results = await Promise.all(
      Array.from({ length: BINDING_CODE_MAX_ATTEMPTS * 4 }, () => confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: "LIXUS-000000" })),
    );
    const row = await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } });
    // Tam olarak tavan kadar deneme sonuç doğurur: ne fazlası (kaba kuvvet) ne eksiği (hak erken biter).
    expect(row.verifyAttempts).toBe(BINDING_CODE_MAX_ATTEMPTS);
    expect(results.filter((x) => !x.ok && x.reason === "mismatch")).toHaveLength(BINDING_CODE_MAX_ATTEMPTS);
    expect(results.every((x) => !x.ok && (x.reason === "mismatch" || x.reason === "too_many_attempts"))).toBe(true);
    expect(row.status).toBe("pending");
    // Hak bitince doğru kod da geçmez.
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code })).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("aynı kullanıcının iki bekleyen numarası eşzamanlı doğrulanırsa yalnız biri etkin kalır (kullanıcı başına tek numara)", async () => {
    const o = await seedUser();
    const r1 = await start(o);
    const r2 = await start(o, "+49 151 12345678");
    if (!r1.ok || !r2.ok) throw new Error("start");
    const [c1, c2] = await Promise.all([
      confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r1.code }),
      confirmHostBindingFromInbound({ provider: P, fromDigits: "4915112345678", code: r2.code }),
    ]);
    expect(c1.ok && c2.ok).toBe(true);
    const rows = await prisma.hostChannelBinding.findMany({ where: { userId: o.userId } });
    expect(rows.filter((x) => x.status === "active")).toHaveLength(1);
  });

  it("kodu üreten kullanıcının rolü personele düştüyse / işletmeden çıktıysa doğru kod da etkinleştirmez (rol yeniden okunur)", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    await prisma.user.update({ where: { id: o.userId }, data: { role: "staff" } });
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code })).toEqual({ ok: false, reason: "not_allowed" });
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).status).toBe("pending");
    // Rol geri gelince aynı kod geçer (deneme hakkı yanmadı).
    await prisma.user.update({ where: { id: o.userId }, data: { role: "manager" } });
    expect((await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code })).ok).toBe(true);

    const o2 = await seedUser();
    const r2 = await start(o2, "+49 151 12345678");
    if (!r2.ok) throw new Error(r2.reason);
    const other = await prisma.organization.create({ data: { name: "Baska Org" } });
    await prisma.user.update({ where: { id: o2.userId }, data: { organizationId: other.id } });
    expect(await confirmHostBindingFromInbound({ provider: P, fromDigits: "4915112345678", code: r2.code })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("başka hesabın ETKİN bağlantısı ve süresi dolmamış bekleyen kodu devralınamaz; süresi dolmuşu devralınır", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const t0 = new Date("2026-10-30T20:00:00Z");
    const ra = await start(a, NUM, t0);
    if (!ra.ok) throw new Error(ra.reason);
    expect(await start(b, NUM, new Date(t0.getTime() + 60_000))).toEqual({ ok: false, reason: "number_pending_elsewhere" });
    const rb = await start(b, NUM, new Date(t0.getTime() + BINDING_CODE_TTL_MS + 1));
    if (!rb.ok) throw new Error(rb.reason);
    expect(rb.bindingId).toBe(ra.bindingId);
    // A'nın eski kodu artık geçmez; B'nin kodu geçer ve satır B'nin işletmesine geçer.
    const late = new Date(t0.getTime() + BINDING_CODE_TTL_MS + 2);
    expect((await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: ra.code, now: late })).ok).toBe(false);
    const ok = await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: rb.code, now: late });
    expect(ok).toMatchObject({ ok: true, organizationId: b.orgId, userId: b.userId });
    // Etkin olanı A devralamaz.
    expect(await start(a, NUM, new Date(late.getTime() + BINDING_CODE_TTL_MS * 3))).toEqual({ ok: false, reason: "number_in_use" });
  });

  it("çalışan bağlantı yeniden başlatılınca beklemeye DÜŞMEZ (already_active); kuşak eskiyse yeniden doğrulama açılır (Haiku P3-4)", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code });
    expect(await start(o)).toEqual({ ok: false, reason: "already_active" });
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: r.bindingId, userId: o.userId });
    await prisma.user.update({ where: { id: o.userId }, data: { sessionEpoch: { increment: 1 } } });
    const again = await start(o);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: again.code });
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: r.bindingId, userId: o.userId });
  });

  it("kullanıcı başına tek etkin numara: yeni numara doğrulanınca eskisi kapanır", async () => {
    const o = await seedUser();
    const r1 = await start(o);
    if (!r1.ok) throw new Error(r1.reason);
    await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r1.code });
    const r2 = await start(o, "+49 151 12345678");
    if (!r2.ok) throw new Error(r2.reason);
    await confirmHostBindingFromInbound({ provider: P, fromDigits: "4915112345678", code: r2.code });
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r1.bindingId } })).status).toBe("revoked");
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: r2.bindingId, userId: o.userId });
  });

  it("oturum kuşağı artınca (şifre değişimi) ya da rol personele düşünce bağlantı soru almaz; kaldırma idempotent ve kiracıya bağlı", async () => {
    const o = await seedUser();
    const r = await start(o);
    if (!r.ok) throw new Error(r.reason);
    await confirmHostBindingFromInbound({ provider: P, fromDigits: DIGITS, code: r.code });
    await prisma.user.update({ where: { id: o.userId }, data: { sessionEpoch: { increment: 1 } } });
    expect(await usableHostBindingForOrg(o.orgId)).toBeNull();
    await prisma.user.update({ where: { id: o.userId }, data: { sessionEpoch: 0, role: "staff" } });
    expect(await usableHostBindingForOrg(o.orgId)).toBeNull();
    await prisma.user.update({ where: { id: o.userId }, data: { role: "manager" } });
    expect(await usableHostBindingForOrg(o.orgId)).toEqual({ id: r.bindingId, userId: o.userId });
    // Başka işletme kimliğiyle kaldırılamaz (reddin sebebi: kiracı).
    const other = await seedUser();
    expect(await revokeHostBinding({ bindingId: r.bindingId, organizationId: other.orgId, reason: "user" })).toBe(false);
    expect(await usableHostBindingForOrg(o.orgId)).not.toBeNull();
    expect(await revokeHostBinding({ bindingId: r.bindingId, organizationId: o.orgId, reason: "opt_out" })).toBe(true);
    expect(await revokeHostBinding({ bindingId: r.bindingId, organizationId: o.orgId, reason: "opt_out" })).toBe(false);
    expect(await usableHostBindingForOrg(o.orgId)).toBeNull();
  });
});
