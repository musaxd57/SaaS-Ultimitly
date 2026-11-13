import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { prisma, resetDb, makeOrgWithProperty, makeUser } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EKİP KİŞİSİ + PERSONEL KANAL BAĞI (T3, migration 97; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md §9 İ3 / İ5,
// §10). Giriş yapamayan personel: giriş / şifre sıfırlama / görev e-postası KESİN reddeder. Numara kişinin KENDİ kodlu mesajıyla bağlanır
// (temizlikçi numarası, ev sahibi akışına girmez). Numara işletme içinde tek kişide, işletmeler arası serbest.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn().mockResolvedValue(undefined), setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
const mail = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailService: {
      ...actual.emailService,
      sendReporting: vi.fn(async (to: string) => {
        mail.sent.push(to);
        return { ok: true };
      }),
    },
  };
});

import { setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { createTeamContact, confirmStaffBindingFromInbound, listTeamContacts, startStaffBinding } from "@/lib/team-contacts/service";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { notifyTaskAssigned } from "@/lib/tasks/notify";
import { emailService as coreEmailService } from "@/lib/email-core";
import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as FORGOT } from "@/app/api/account/forgot-password/route";
import { GET as LIST, POST as CREATE } from "@/app/api/team-contacts/route";
import { POST as START, DELETE as UNLINK } from "@/app/api/team-contacts/[id]/binding/route";
import { POST as WEBHOOK } from "@/app/api/webhooks/host-channel/whatsapp/route";

const HMAC = "test-host-channel-secret-0123456789abcdef";
const APP_SECRET = "test-whatsapp-app-secret-0123456789";
const HOST_PNID = "109876543210987";
const TEAM_PNID = "209876543210987";
const PHONE = "905321112233";

function envOn(opts: { whatsapp?: boolean } = {}) {
  vi.stubEnv("TEAM_CONTACTS_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", HMAC);
  if (opts.whatsapp !== false) {
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", HOST_PNID);
    vi.stubEnv("TEAM_WHATSAPP_PHONE_NUMBER_ID", TEAM_PNID);
    vi.stubEnv("TEAM_WHATSAPP_NUMBER", "+90 555 000 11 22");
  }
}

async function owner(orgId: string) {
  const u = await prisma.user.create({
    data: { organizationId: orgId, name: "Sahip", email: `owner-${orgId}@example.com`, passwordHash: "x", role: "owner" },
  });
  session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: u.name, sessionEpoch: 0 } as SessionPayload;
  return u;
}

async function contact(orgId: string, name = "Ayşe") {
  const r = await createTeamContact({ organizationId: orgId, name });
  if (!r.ok) throw new Error(r.reason);
  return r.userId;
}

async function code(orgId: string, userId: string, now?: Date) {
  const r = await startStaffBinding({ organizationId: orgId, userId, provider: WHATSAPP_CLOUD_PROVIDER, now });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

const jsonReq = (url: string, method: string, body?: unknown, ip = "1.1.1.1") =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function waBody(pnid: string, from: string, text: string, id = `wamid.${Math.random()}`) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "905550001122", phone_number_id: pnid },
              messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}
const signed = (raw: string) =>
  WEBHOOK(
    new NextRequest("https://www.lixusai.com/api/webhooks/host-channel/whatsapp", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` },
    }),
  );

describe("ekip kişisi (T3)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mail.sent.length = 0;
    vi.mocked(setSessionCookie).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("kayıt", () => {
    it("personel kullanıcısı: rol staff, giriş kapalı, .invalid e-posta, doğrulanmış, üyelik kökeni team", async () => {
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId, "  Ayşe  ");
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(u).toMatchObject({ role: "staff", loginDisabled: true, name: "Ayşe", organizationId: orgId });
      expect(u.email).toMatch(/@team\.invalid$/);
      expect(u.emailVerifiedAt).not.toBeNull();
      const m = await prisma.membership.findFirstOrThrow({ where: { userId: id } });
      expect(m).toMatchObject({ organizationId: orgId, role: "staff", origin: "team", status: "active" });
      expect(await createTeamContact({ organizationId: orgId, name: " ​ " })).toEqual({ ok: false, reason: "bad_name" });
    });
  });

  describe("giriş ve e-posta KESİN ret", () => {
    it("parolası bilinse bile giriş 401, oturum basılmaz; aynı parolayla normal kullanıcı girer (aşırı uygulama yok)", async () => {
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const u = await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword("correct-horse") } });
      const res = await LOGIN(jsonReq("http://localhost/api/auth/login", "POST", { email: u.email, password: "correct-horse" }));
      expect(res.status).toBe(401);
      expect(setSessionCookie).not.toHaveBeenCalled();

      await prisma.user.create({
        data: { organizationId: orgId, name: "Gerçek", email: "real@example.com", passwordHash: await hashPassword("correct-horse"), role: "staff", emailVerifiedAt: new Date() },
      });
      const ok = await LOGIN(jsonReq("http://localhost/api/auth/login", "POST", { email: "real@example.com", password: "correct-horse" }, "1.1.1.2"));
      expect(ok.status).toBe(200);
    });

    it("şifre sıfırlama isteği ekip kişisinde kod ÜRETMEZ (aynı 200); normal kullanıcıda üretir", async () => {
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      const res = await FORGOT(jsonReq("http://localhost/api/account/forgot-password", "POST", { action: "request", email: u.email }, "9.9.9.1"));
      expect(res.status).toBe(200);
      expect(await prisma.passwordResetChallenge.count({ where: { userId: id } })).toBe(0);

      const real = await prisma.user.create({ data: { organizationId: orgId, name: "R", email: "r@example.com", passwordHash: "x", role: "owner" } });
      await FORGOT(jsonReq("http://localhost/api/account/forgot-password", "POST", { action: "request", email: real.email }, "9.9.9.2"));
      expect(await prisma.passwordResetChallenge.count({ where: { userId: real.id } })).toBe(1);
    });

    it("otomatik atama e-postası ekip kişisine GİTMEZ (anahtar açıkken); normal personele gider", async () => {
      vi.stubEnv("STAFF_NOTIFY_ENABLED", "1");
      const { orgId, propertyId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const t1 = await prisma.task.create({ data: { propertyId, title: "Temizlik", type: "cleaning", assignedToId: id, dueAt: new Date() } });
      expect(await notifyTaskAssigned(orgId, t1.id)).toBe("skipped");
      const real = await prisma.user.create({ data: { organizationId: orgId, name: "R", email: "r2@example.com", passwordHash: "x", role: "staff" } });
      const t2 = await prisma.task.create({ data: { propertyId, title: "Temizlik", type: "cleaning", assignedToId: real.id, dueAt: new Date() } });
      expect(await notifyTaskAssigned(orgId, t2.id)).toBe("sent");
      expect(mail.sent).toEqual(["r2@example.com"]);
    });

    it("e-posta çekirdeği .invalid adrese sağlayıcıyı HİÇ çağırmaz (tek boğaz)", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test_dummy");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const r = await coreEmailService.sendReporting("team-abc@team.invalid", "Konu", "<p>x</p>");
      expect(r).toMatchObject({ ok: false, undeliverable: true });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("Ayarlar rotaları", () => {
    it("anahtar kapalı → 404 (yüzey yok)", async () => {
      const { orgId } = await makeOrgWithProperty();
      await owner(orgId);
      expect((await LIST(jsonReq("http://localhost/api/team-contacts", "GET"), { params: Promise.resolve({}) } as never)).status).toBe(404);
      expect((await CREATE(jsonReq("http://localhost/api/team-contacts", "POST", { name: "A" }), { params: Promise.resolve({}) } as never)).status).toBe(404);
      expect(await prisma.user.count({ where: { loginDisabled: true } })).toBe(0);
    });

    it("ekle + listele; WhatsApp ayarı yoksa kod üretilmez (400), kişi yine eklenir", async () => {
      envOn({ whatsapp: false });
      const { orgId } = await makeOrgWithProperty();
      await owner(orgId);
      const created = await CREATE(jsonReq("http://localhost/api/team-contacts", "POST", { name: "Ayşe" }), { params: Promise.resolve({}) } as never);
      expect(created.status).toBe(200);
      const { userId } = (await created.json()) as { userId: string };
      const list = await LIST(jsonReq("http://localhost/api/team-contacts", "GET"), { params: Promise.resolve({}) } as never);
      expect(await list.json()).toEqual({ whatsapp: false, contacts: [{ userId, name: "Ayşe", binding: { status: "none" } }] });
      const start = await START(jsonReq(`http://localhost/api/team-contacts/${userId}/binding`, "POST"), { params: Promise.resolve({ id: userId }) });
      expect(start.status).toBe(400);
      expect(await prisma.staffChannelBinding.count()).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "team_contact.created" } });
      expect(String(audit.metadataJson)).not.toContain("Ayşe");
    });

    it("kod: başka işletmenin kişisi ve giriş yapabilen personel 404; kendi kişisi kod + wa.me bağlantısı alır", async () => {
      envOn();
      const a = await makeOrgWithProperty();
      const b = await makeOrgWithProperty();
      await owner(a.orgId);
      const other = await contact(b.orgId);
      const realStaff = await prisma.user.create({ data: { organizationId: a.orgId, name: "R", email: "rs@example.com", passwordHash: "x", role: "staff" } });
      for (const id of [other, realStaff.id]) {
        const r = await START(jsonReq(`http://localhost/api/team-contacts/${id}/binding`, "POST"), { params: Promise.resolve({ id }) });
        expect(r.status).toBe(404);
      }
      const mine = await contact(a.orgId);
      const r = await START(jsonReq(`http://localhost/api/team-contacts/${mine}/binding`, "POST"), { params: Promise.resolve({ id: mine }) });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { code: string; link: string };
      expect(body.code).toMatch(/^EKIP-/);
      expect(body.link).toBe(`https://wa.me/905550001122?text=${body.code}`);
      const row = await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: mine } });
      expect(row).toMatchObject({ status: "pending", addressHash: null, addressEnc: null });
      expect(row.codeHash).not.toContain(body.code.slice(5));
    });
  });

  describe("kişinin kendi mesajıyla bağlanma (web kancası)", () => {
    it("temizlikçi numarasına gelen kod → bağ etkin, numara şifreli, izin anı yazılı; ev sahibi akışına girmez", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const c = await code(orgId, id);
      const res = await signed(waBody(TEAM_PNID, PHONE, `Merhaba ${c.code}`));
      expect(res.status).toBe(200);
      const row = await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: id } });
      expect(row).toMatchObject({ status: "active", codeHash: null, codeExpiresAt: null });
      expect(row.addressHash).toBeTruthy();
      expect(row.addressEnc).not.toContain(PHONE);
      expect(row.optInAt).not.toBeNull();
      expect(await prisma.hostChannelBinding.count()).toBe(0);
      const list = await listTeamContacts(orgId);
      expect(list[0]!.binding).toMatchObject({ status: "active", masked: "+•• ••• ••• •• 33" });
      // Yinelenen teslimat zararsız.
      expect((await signed(waBody(TEAM_PNID, PHONE, c.code))).status).toBe(200);
      expect(await prisma.staffChannelBinding.count({ where: { status: "active" } })).toBe(1);
    });

    it("anahtar kapalıyken temizlikçi numarasının mesajı İŞLENMEZ", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const c = await code(orgId, id);
      vi.stubEnv("TEAM_CONTACTS_ENABLED", "0");
      await signed(waBody(TEAM_PNID, PHONE, c.code));
      expect((await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: id } })).status).toBe("pending");
    });

    it("kod ev sahibi numarasına gönderilirse personel bağı KURULMAZ (iki akış ayrı)", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const c = await code(orgId, id);
      await signed(waBody(HOST_PNID, PHONE, c.code));
      expect((await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: id } })).status).toBe("pending");
    });

    it("süresi dolmuş kod bağlamaz; yeni kod eskisini geçersiz kılar", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const old = await code(orgId, id, new Date(Date.now() - 73 * 3_600_000));
      expect(await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: old.code })).toEqual({ ok: false, reason: "expired" });
      const first = await code(orgId, id);
      const second = await code(orgId, id);
      expect(await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: first.code })).toEqual({ ok: false, reason: "unknown_code" });
      expect((await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: second.code })).ok).toBe(true);
    });

    it("aynı işletmede numara başka kişiye geçerse eski bağ number_moved ile kapanır; başka işletmede aynı numara serbest", async () => {
      envOn();
      const a = await makeOrgWithProperty();
      const b = await makeOrgWithProperty();
      const ayse = await contact(a.orgId, "Ayşe");
      const fatma = await contact(a.orgId, "Fatma");
      const elsewhere = await contact(b.orgId, "Ayşe");
      expect((await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(a.orgId, ayse)).code })).ok).toBe(true);
      expect((await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(b.orgId, elsewhere)).code })).ok).toBe(true);
      expect((await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(a.orgId, fatma)).code })).ok).toBe(true);
      const rows = await prisma.staffChannelBinding.findMany({ select: { userId: true, status: true, revokedReason: true } });
      expect(rows.find((r) => r.userId === ayse)).toMatchObject({ status: "revoked", revokedReason: "number_moved" });
      // Kapanan bağ numarayı tutmaz (Haiku T3 #1).
      expect(await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: ayse } })).toMatchObject({ addressHash: null, addressEnc: null });
      expect(rows.find((r) => r.userId === fatma)).toMatchObject({ status: "active" });
      expect(rows.find((r) => r.userId === elsewhere)).toMatchObject({ status: "active" });
    });

    it("yeni numara doğrulanınca kişinin eski numarası replaced ile kapanır (kişi başına tek etkin)", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(orgId, id)).code });
      await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: "4915112345678", code: (await code(orgId, id)).code });
      const rows = await prisma.staffChannelBinding.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => [r.status, r.revokedReason])).toEqual([
        ["revoked", "replaced"],
        ["active", null],
      ]);
    });

    it("kişi artık ekip kişisi değilse (giriş açıldı) kod bağlamaz", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const id = await contact(orgId);
      const c = await code(orgId, id);
      await prisma.user.update({ where: { id }, data: { loginDisabled: false } });
      expect(await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: c.code })).toEqual({ ok: false, reason: "not_allowed" });
    });

    it("bağı kaldır: etkin ve bekleyen kapanır, denetim kaydı numara / kod taşımaz", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      await owner(orgId);
      const id = await contact(orgId);
      await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(orgId, id)).code });
      const r = await UNLINK(jsonReq(`http://localhost/api/team-contacts/${id}/binding`, "DELETE"), { params: Promise.resolve({ id }) });
      expect(await r.json()).toEqual({ revoked: true });
      expect(await prisma.staffChannelBinding.count({ where: { status: { in: ["active", "pending"] } } })).toBe(0);
      expect(await prisma.staffChannelBinding.count({ where: { OR: [{ addressHash: { not: null } }, { addressEnc: { not: null } }] } })).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "team_contact.binding_revoked" } });
      expect(String(audit.metadataJson)).not.toContain(PHONE);
    });

    it("kiracılar arası: başka işletmenin kişisinin bağı DELETE ile KAPANMAZ (revoked:false, satır etkin kalır)", async () => {
      envOn();
      const a = await makeOrgWithProperty();
      const b = await makeOrgWithProperty();
      await owner(a.orgId);
      const other = await contact(b.orgId);
      await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: (await code(b.orgId, other)).code });
      const r = await UNLINK(jsonReq(`http://localhost/api/team-contacts/${other}/binding`, "DELETE"), { params: Promise.resolve({ id: other }) });
      expect(await r.json()).toEqual({ revoked: false });
      expect((await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: other } })).status).toBe("active");
    });

    it("aynı kod eşzamanlı iki numaradan gelirse TEK bağ kurulur; kaybedenin numara süpürmesi geri alınır (Haiku T3 #2)", async () => {
      envOn();
      const { orgId } = await makeOrgWithProperty();
      const fatma = await contact(orgId, "Fatma");
      const OTHER = "4915112345678";
      // Fatma'nın etkin numarası OTHER; Ayşe'nin kodu iki numaradan aynı anda gelir — biri OTHER.
      await confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: OTHER, code: (await code(orgId, fatma)).code });
      const otherHash = (await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: fatma, status: "active" } })).addressHash;
      const ayse = await contact(orgId, "Ayşe");
      const c = await code(orgId, ayse);
      const results = await Promise.all([
        confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: PHONE, code: c.code }),
        confirmStaffBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromRaw: OTHER, code: c.code }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const ayseRow = await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: ayse, status: "active" } });
      const fatmaRow = await prisma.staffChannelBinding.findFirstOrThrow({ where: { userId: fatma }, orderBy: { createdAt: "desc" } });
      // Değişmez: Fatma'nın bağı YALNIZ kazanan OTHER numarasıysa kapanır. Kaybeden OTHER ise süpürmesi geri alınmış olmalı.
      if (ayseRow.addressHash === otherHash) expect(fatmaRow).toMatchObject({ status: "revoked", revokedReason: "number_moved" });
      else expect(fatmaRow).toMatchObject({ status: "active", addressHash: otherHash });
    });
  });

  describe("bürünme", () => {
    it("sahibi / yöneticisi olmayan işletmede operatör ekip kişisine BÜRÜNEMEZ; giriş yapabilen personel seçilir", async () => {
      const { enterOrganization } = await import("@/lib/admin");
      const { orgId } = await makeOrgWithProperty();
      await contact(orgId);
      const opOrg = await prisma.organization.create({ data: { name: "Operatör" } });
      const opUser = await makeUser({ data: { organizationId: opOrg.id, name: "Op", email: "op@example.com", passwordHash: "x", role: "owner" } });
      const op = { userId: opUser.id, organizationId: opOrg.id, role: "owner", email: opUser.email, name: "Op", sessionEpoch: 0, mfa: true } as unknown as SessionPayload;
      expect(await enterOrganization(op, orgId)).toBe(false);
      vi.mocked(setSessionCookie).mockClear();
      await makeUser({ data: { organizationId: orgId, name: "R", email: "imp-r@example.com", passwordHash: "x", role: "staff" } });
      expect(await enterOrganization(op, orgId)).toBe(true);
      expect(vi.mocked(setSessionCookie).mock.calls.at(-1)?.[0]).toMatchObject({ email: "imp-r@example.com" });
    });
  });
});
