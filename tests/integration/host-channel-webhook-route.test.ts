import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn<(context: string, err: unknown) => Promise<string>>(async () => "reported") }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { GET, POST } from "@/app/api/webhooks/host-channel/whatsapp/route";
import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { OPT_OUT_REPLY } from "@/lib/host-channel/inbound";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";
import { clearBadSignatureThrottle, skipBadSignatureAlert } from "@/lib/billing/bad-signature-throttle";
import { handleHostInbound, inboundDedupeName, INBOUND_LEASE_MS } from "@/lib/host-channel/inbound";
import { hostChannelFlagsFromEnv } from "@/lib/host-channel/routing";
import type { HostChannelTransport } from "@/lib/host-channel/types";

// ---------------------------------------------------------------------------
// WhatsApp web kancası rotası — gerçek veritabanı, sahte aktarım (tasarım §5.1, §5.2, §5.4, §5.6; kurucu 10-30 "WP'yi hemen bağlamak
// istiyorum"). Pinlenen: anahtar kapalıyken uç uyur; imzasız / bozuk / yabancı numaralı teslimat hiçbir şey yazmaz; bilinmeyen gönderen sessiz
// ve iz bırakmaz; bağlama kodu ev sahibinin KENDİ numarasından etkinleştirir; "DUR" kapatır; aynı teslimat bir kez işlenir; KİRACI YALNIZ
// GÖNDEREN NUMARADAN — gövdeye yazılmış başka işletmenin kimlikleri hiçbir şeyi değiştirmez (reddin SEBEBİ sınanır).
// ---------------------------------------------------------------------------

const APP_SECRET = "test-whatsapp-app-secret-0123456789";
const PNID = "109876543210987";
const HMAC = "test-host-channel-secret-0123456789abcdef";
const VERIFY = "test-verify-token-abc";
const ENDPOINT = "https://www.lixusai.com/api/webhooks/host-channel/whatsapp";

const NUM_A = "+90 532 111 22 33";
const DIG_A = "905321112233";
const NUM_B = "+49 151 12345678";
const DIG_B = "4915112345678";
const STRANGER = "905559998877";

function fakeTransport() {
  const texts: { to: string; text: string }[] = [];
  const t: HostChannelTransport = {
    provider: WHATSAPP_CLOUD_PROVIDER,
    async sendQuestion() {
      return { ok: true, providerMessageId: "wamid.q" };
    },
    async sendText(to, text) {
      texts.push({ to, text });
      return { ok: true, providerMessageId: "wamid.t" };
    },
  };
  return { t, texts };
}

type Msg = {
  from: string;
  id: string;
  text?: string;
  button?: string;
  context?: string;
  extra?: Record<string, unknown>;
  /** Meta mesaj zamanı (saniye); verilmezse ŞİMDİ. */
  ts?: number;
  system?: string;
};
function body(msgs: Msg[], pnid: string | string[] = PNID): string {
  const ids = Array.isArray(pnid) ? pnid : [pnid];
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: ids.map((id, i) => ({
      id: "WABA1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "905550000000", phone_number_id: id },
            contacts: [{ profile: { name: "Ev Sahibi" }, wa_id: msgs[0]?.from }],
            messages: (i === 0 ? msgs : []).map((m) => ({
              from: m.from,
              id: m.id,
              timestamp: String(m.ts ?? Math.floor(Date.now() / 1000)),
              ...(m.context ? { context: { from: "905550000000", id: m.context } } : {}),
              ...(m.system
                ? { type: "system", system: { body: "x", type: m.system } }
                : m.button
                  ? { type: "interactive", interactive: { type: "button_reply", button_reply: { id: m.button, title: "Ben yazarım" } } }
                  : { type: "text", text: { body: m.text ?? "" } }),
              ...(m.extra ?? {}),
            })),
          },
        },
      ],
    })),
  });
}
const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
function post(raw: string, headers: Record<string, string | null> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-hub-signature-256": sign(raw) };
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  return POST(new NextRequest(ENDPOINT, { method: "POST", body: raw, headers: h }));
}
const get = (params: Record<string, string>) => GET(new NextRequest(`${ENDPOINT}?${new URLSearchParams(params).toString()}`));

async function seedOrg(role = "owner") {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role },
  });
  return { orgId: org.id, userId: user.id };
}
async function pending(o: { orgId: string; userId: string }, raw: string) {
  const r = await startHostBinding({ organizationId: o.orgId, userId: o.userId, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: raw, optInTextVersion: "v1" });
  if (!r.ok) throw new Error(r.reason);
  return r;
}
async function active(o: { orgId: string; userId: string }, raw: string, digits: string) {
  const r = await pending(o, raw);
  const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: digits, code: r.code });
  if (!c.ok) throw new Error(c.reason);
  return r.bindingId;
}
const binding = (id: string) => prisma.hostChannelBinding.findUniqueOrThrow({ where: { id } });
const dedupeLocks = () => prisma.systemLock.count({ where: { name: { startsWith: "host-in:" } } });

function flagsOn(orgIds = "*") {
  vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
  vi.stubEnv("HOST_CHANNEL_ORG_IDS", orgIds);
  vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", HMAC);
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", VERIFY);
}

describe("WhatsApp web kancası rotası", () => {
  let tr: ReturnType<typeof fakeTransport>;
  beforeEach(async () => {
    await resetDb();
    reportErrorMock.mockClear();
    clearBadSignatureThrottle();
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", HMAC);
    tr = fakeTransport();
    __setHostChannelTransportForTest(tr.t);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setHostChannelTransportForTest(undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("GET el sıkışma", () => {
    it("anahtar açık + doğru belirteç → challenge düz metin; yanlış belirteç 403 ve challenge yansıtılmaz", async () => {
      flagsOn();
      const ok = await get({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("1158201444");
      expect(ok.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      const bad = await get({ "hub.mode": "subscribe", "hub.verify_token": "yanlis", "hub.challenge": "1158201444" });
      expect(bad.status).toBe(403);
      expect(await bad.text()).not.toContain("1158201444");
    });

    it("anahtar KAPALI → doğru belirteçle de 403 (uç uyur); belirteç yapılandırılmamışsa boş belirteç 403", async () => {
      vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
      vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
      vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", VERIFY);
      expect((await get({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1" })).status).toBe(403);
      flagsOn();
      vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "");
      expect((await get({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" })).status).toBe(403);
    });
  });

  describe("POST — kapılar (imzadan önce hiçbir şey yazılmaz)", () => {
    it("anahtar KAPALI → 200 {disabled:true}; geçerli bağlama kodu bile işlenmez", async () => {
      const o = await seedOrg();
      vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", HMAC);
      const r = await pending(o, NUM_A);
      vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
      vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
      const res = await post(body([{ from: DIG_A, id: "wamid.1", text: r.code }]));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ disabled: true });
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await prisma.systemLock.count()).toBe(0);
      expect(reportErrorMock).not.toHaveBeenCalled();
    });

    it("anahtar açık ama uygulama gizli anahtarı yok → 503 (Meta yeniden dener, kod / DUR kaybolmaz) + alarm", async () => {
      flagsOn();
      vi.stubEnv("WHATSAPP_APP_SECRET", "");
      const res = await post(body([{ from: DIG_A, id: "wamid.1", text: "merhaba" }]));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ disabled: true });
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(String(reportErrorMock.mock.calls[0]![0])).toBe("host-channel-webhook-dormant");
    });

    it("anahtar açık ama numara arama anahtarı (HOST_CHANNEL_HMAC_SECRET) yok → aynı: 503 + alarm; kimliksiz sel freni devrede", async () => {
      flagsOn();
      vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "kisa");
      for (let i = 0; i < 3; i++) {
        const res = await post(body([{ from: DIG_A, id: `wamid.${i}`, text: "DUR" }]));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ disabled: true });
      }
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(String(reportErrorMock.mock.calls[0]![0])).toBe("host-channel-webhook-dormant");
      // Bastırılan alarm aynı süreçte bir dakika yeniden yazılmaz (her kimliksiz istek iki veritabanı yazımı açmasın).
      expect(skipBadSignatureAlert("host-channel-webhook:dormant")).toBe(true);
    });

    it("imza yok / yanlış anahtar / gövde bir bayt değişmiş → 401, hiçbir satır yazılmaz; Meta biçimli yanlış imza alarm verir, biçimsiz vermez", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const raw = body([{ from: DIG_A, id: "wamid.1", text: r.code }]);
      expect((await post(raw, { "x-hub-signature-256": null })).status).toBe(401);
      expect((await post(raw, { "x-hub-signature-256": "deneme" })).status).toBe(401);
      expect(reportErrorMock).not.toHaveBeenCalled();
      expect((await post(raw, { "x-hub-signature-256": sign(raw, "baska-anahtar") })).status).toBe(401);
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      const tampered = raw.replace("wamid.1", "wamid.2");
      expect((await post(tampered, { "x-hub-signature-256": sign(raw) })).status).toBe(401);
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await dedupeLocks()).toBe(0);
      expect(await prisma.operationalEvent.count()).toBe(0);
      // Kimliksiz sel freni: bastırılan alarm aynı süreçte yeniden yazılmaz.
      expect(skipBadSignatureAlert("host-channel-webhook:signature-mismatch")).toBe(true);
    });

    it("doğrulanmış teslimat imza alarmını ve frenini sıfırlar: sonraki gerçek bozulma yeniden HEMEN bildirilir", async () => {
      flagsOn();
      const bad = body([{ from: STRANGER, id: "wamid.x", text: "x" }]);
      await post(bad, { "x-hub-signature-256": sign(bad, "baska-anahtar") });
      await post(bad, { "x-hub-signature-256": sign(bad, "baska-anahtar") });
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(await prisma.systemLock.count({ where: { name: { contains: "signature-mismatch" } } })).toBe(1);
      expect((await post(body([{ from: STRANGER, id: "wamid.ok", text: "x" }]))).status).toBe(200);
      expect(await prisma.systemLock.count({ where: { name: { contains: "signature-mismatch" } } })).toBe(0);
      expect(skipBadSignatureAlert("host-channel-webhook:signature-mismatch")).toBe(false);
      await post(bad, { "x-hub-signature-256": sign(bad, "baska-anahtar") });
      expect(reportErrorMock).toHaveBeenCalledTimes(2);
    });

    it("256 KB üstü gövde → 413", async () => {
      flagsOn();
      const raw = JSON.stringify({ object: "whatsapp_business_account", pad: "x".repeat(260 * 1024) });
      expect((await post(raw)).status).toBe(413);
    });

    it("geçerli imza + bozuk JSON → 200, hiçbir şey; Content-Type imzadan önce kapı değil (text/plain imzalı gövde işlenir)", async () => {
      flagsOn();
      expect((await post("{bozuk")).status).toBe(200);
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const res = await post(body([{ from: DIG_A, id: "wamid.1", text: r.code }]), { "content-type": "text/plain" });
      expect(res.status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("active");
    });

    it("yabancı numara kimliği: o mesaj işlenmez + yapılandırma alarmı; karışık teslimatta BİZİM numaramızın mesajı yine işlenir", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      expect((await post(body([{ from: DIG_A, id: "wamid.1", text: r.code }], "111111111111"))).status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await dedupeLocks()).toBe(0);
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(String(reportErrorMock.mock.calls[0]![0])).toBe("host-channel-webhook-foreign-number");
      // Karışık: mesaj bizim numaramızın altında → işlenir.
      expect((await post(body([{ from: DIG_A, id: "wamid.2", text: r.code }], [PNID, "111111111111"]))).status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("active");
      // Yalnız bizim numaramızın teslimatı yabancı numara alarmını temizler.
      await post(body([{ from: DIG_A, id: "wamid.3", text: "x" }]));
      expect(await prisma.systemLock.count({ where: { name: { contains: "foreign-number" } } })).toBe(0);
    });

    it("numara kimliği hiç olmayan imzalı teslimat işlenmez", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const raw = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: { messages: [{ from: DIG_A, id: "wamid.np", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: r.code } }] } }] }],
      });
      expect((await post(raw)).status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await dedupeLocks()).toBe(0);
    });
  });

  describe("POST — numara bağlama ve DUR", () => {
    it("ev sahibinin KENDİ numarasından doğru kod → etkin; WhatsApp'tan cevap gitmez; günlükte yalnız işletme ve sayılar", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const res = await post(body([{ from: DIG_A, id: "wamid.1", text: `Merhaba ${r.code.toLowerCase()}` }]));
      expect(res.status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("active");
      expect(tr.texts).toHaveLength(0);
      const events = await prisma.operationalEvent.findMany({ orderBy: { id: "asc" } });
      expect(events.map((e) => e.event).sort()).toEqual(["host_channel.binding.verified", "host_channel.webhook.received"]);
      for (const e of events) {
        expect(e.organizationId).toBe(o.orgId);
        expect(JSON.stringify(e)).not.toMatch(/5321112233|wamid|LIXUS/i);
      }
    });

    it("🚨 bilinmeyen numara: başka hesabın kodunu gönderse de hiçbir şey olmaz — satır yazılmaz, cevap gitmez", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      expect((await post(body([{ from: STRANGER, id: "wamid.1", text: r.code }]))).status).toBe(200);
      expect((await post(body([{ from: STRANGER, id: "wamid.2", text: "DUR" }]))).status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect((await binding(r.bindingId)).verifyAttempts).toBe(0);
      expect(await dedupeLocks()).toBe(0);
      expect(await prisma.operationalEvent.count()).toBe(0);
      expect(tr.texts).toHaveLength(0);
    });

    it("işletme listede değilse kodu işlenmez (iz bırakmadan); listeye girince aynı kod geçer", async () => {
      const o = await seedOrg();
      flagsOn("baska-isletme");
      const r = await pending(o, NUM_A);
      await post(body([{ from: DIG_A, id: "wamid.1", text: r.code }]));
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await dedupeLocks()).toBe(0);
      vi.stubEnv("HOST_CHANNEL_ORG_IDS", o.orgId);
      await post(body([{ from: DIG_A, id: "wamid.2", text: r.code }]));
      expect((await binding(r.bindingId)).status).toBe("active");
    });

    it("aynı teslimat iki kez → bir kez işlenir (yanlış kod sayacı bir kez artar)", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const raw = body([{ from: DIG_A, id: "wamid.dup", text: "LIXUS-000000" }]);
      await post(raw);
      await post(raw);
      expect((await binding(r.bindingId)).verifyAttempts).toBe(1);
      const rec = await prisma.operationalEvent.findMany({ where: { event: "host_channel.webhook.received" }, orderBy: { id: "asc" } });
      expect(rec.map((e) => JSON.parse(e.dataJson ?? "{}"))).toEqual([
        { count: 1, processed: 1, duplicates: 0, ignored: 0 },
        { count: 1, processed: 0, duplicates: 1, ignored: 0 },
      ]);
    });

    it("rolü personele düşmüş kullanıcının kodu etkinleştirmez", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      await prisma.user.update({ where: { id: o.userId }, data: { role: "staff" } });
      await post(body([{ from: DIG_A, id: "wamid.1", text: r.code }]));
      expect((await binding(r.bindingId)).status).toBe("pending");
    });

    it("🚨 geç gelen eski DUR (bağlantı yeniden kurulduktan çok önce yazılmış) yeni bağlantıyı KAPATMAZ; güncel DUR kapatır", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600;
      await post(body([{ from: DIG_A, id: "wamid.old", text: "DUR", ts: dayAgo }]));
      expect((await binding(id)).status).toBe("active");
      expect(tr.texts).toHaveLength(0);
      await post(body([{ from: DIG_A, id: "wamid.new", text: "DUR" }]));
      expect((await binding(id)).status).toBe("revoked");
    });

    it("eskilik etkin bağlantıda DOĞRULAMA anına göre ölçülür: kod beklerken yazılmış DUR, sonradan doğrulanan bağlantıyı kapatmaz", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      // Bağlama 2 saat önce başlatıldı, az önce doğrulandı; DUR 1 saat önce yazılmış (bekleme sırasında).
      await prisma.hostChannelBinding.update({ where: { id }, data: { optInAt: new Date(Date.now() - 2 * 3600_000) } });
      await post(body([{ from: DIG_A, id: "wamid.mid", text: "DUR", ts: Math.floor(Date.now() / 1000) - 3600 }]));
      expect((await binding(id)).status).toBe("active");
    });

    it("zamanı bilinmeyen DUR (sağlayıcı zaman damgası yok) eski SAYILMAZ — numaranın sahibi her zaman durdurabilir", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      await post(body([{ from: DIG_A, id: "wamid.nots", text: "DUR", ts: 0 }]));
      expect((await binding(id)).status).toBe("revoked");
    });

    it("WhatsApp 'numara değişti' olayı bağlantıyı kapatır; öteki sistem olayları etkinlik sayılmaz", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      await prisma.hostChannelBinding.update({ where: { id }, data: { lastInboundAt: null } });
      await post(body([{ from: DIG_A, id: "wamid.s1", system: "customer_identity_changed" }]));
      expect(await binding(id)).toMatchObject({ status: "active", lastInboundAt: null });
      // Bağlantıdan çok önce yazılmış (geç gelen) "numara değişti" olayı yeni bağlantıyı kapatmaz.
      await post(body([{ from: DIG_A, id: "wamid.s0", system: "user_changed_number", ts: Math.floor(Date.now() / 1000) - 24 * 3600 }]));
      expect((await binding(id)).status).toBe("active");
      await post(body([{ from: DIG_A, id: "wamid.s2", system: "user_changed_number" }]));
      expect(await binding(id)).toMatchObject({ status: "revoked", revokedReason: "number_changed" });
      expect(tr.texts).toHaveLength(0);
    });

    it("etkin numaradan DUR → bağlantı kapanır (opt_out), tek onay mesajı o numaraya; tekrar DUR bir şey yapmaz", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      await post(body([{ from: DIG_A, id: "wamid.1", text: "Dur." }]));
      expect(await binding(id)).toMatchObject({ status: "revoked", revokedReason: "opt_out" });
      expect(tr.texts).toEqual([{ to: DIG_A, text: OPT_OUT_REPLY }]);
      await post(body([{ from: DIG_A, id: "wamid.2", text: "DUR" }]));
      await post(body([{ from: DIG_A, id: "wamid.3", text: "otopark var" }]));
      expect(tr.texts).toHaveLength(1);
      // Kapatılmış numaradan gelen mesaj bilinmeyen gönderen gibi: iz bırakmaz (yalnız ilk DUR'un tekrar kilidi var).
      expect(await dedupeLocks()).toBe(1);
    });

    it("🚨 işletmesi liste dışına alınmış ev sahibi de DUR ile durdurabilir (liste geri açılınca soru gitmesin); başka mesajı yine iz bırakmaz", async () => {
      const o = await seedOrg();
      flagsOn();
      const id = await active(o, NUM_A, DIG_A);
      vi.stubEnv("HOST_CHANNEL_ORG_IDS", "baska-isletme");
      await post(body([{ from: DIG_A, id: "wamid.u1", text: "otopark var" }]));
      expect(await dedupeLocks()).toBe(0);
      await post(body([{ from: DIG_A, id: "wamid.u2", text: "STOP" }]));
      expect(await binding(id)).toMatchObject({ status: "revoked", revokedReason: "opt_out" });
    });

    it("etkin numaradan sıradan metin → yalnız son gelen an güncellenir (cevap eşleme sonraki dilim); 'İptal' bağlantıyı KOPARMAZ", async () => {
      flagsOn();
      const o = await seedOrg();
      const id = await active(o, NUM_A, DIG_A);
      await prisma.hostChannelBinding.update({ where: { id }, data: { lastInboundAt: null } });
      await post(body([{ from: DIG_A, id: "wamid.1", text: "İptal" }]));
      const row = await binding(id);
      expect(row.status).toBe("active");
      expect(row.lastInboundAt).not.toBeNull();
      expect(tr.texts).toHaveLength(0);
    });
  });

  describe("çekirdek işleyicinin kendi sözleşmesi (rota dışındaki çağıranlar için)", () => {
    it("kanal anahtarı kapalı bayrakla çağrılırsa hiçbir şey işlenmez / yazılmaz (rota kapısına güvenmez)", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const flags = { ...hostChannelFlagsFromEnv(), channel: false };
      const out = await handleHostInbound({
        provider: WHATSAPP_CLOUD_PROVIDER,
        flags,
        transport: tr.t,
        events: [{ kind: "text", from: DIG_A, providerMessageId: "wamid.core", contextId: null, text: r.code, at: new Date() }],
      });
      expect(out).toEqual({ processed: 0, duplicates: 0, ignored: 1, busy: 0, organizationIds: [] });
      expect((await binding(r.bindingId)).status).toBe("pending");
      expect(await dedupeLocks()).toBe(0);
    });
  });

  describe("tekrar önleme — işleniyor kirası", () => {
    it("aynı mesaj başka teslimatta hâlâ işleniyorsa 503 (Meta sonra yeniden dener), iş yapılmaz; kira dolunca yeniden deneme devralır ve işler", async () => {
      flagsOn();
      const o = await seedOrg();
      const r = await pending(o, NUM_A);
      const name = inboundDedupeName(WHATSAPP_CLOUD_PROVIDER, "wamid.lease");
      await prisma.systemLock.create({ data: { name, holder: "processing", lockedUntil: new Date(Date.now() + INBOUND_LEASE_MS) } });
      const raw = body([{ from: DIG_A, id: "wamid.lease", text: r.code }]);
      expect((await post(raw)).status).toBe(503);
      expect((await binding(r.bindingId)).status).toBe("pending");
      // Yarıda kalmış iş (süreç öldü / kilit silinemedi): kira dolmuş → devralınır.
      await prisma.systemLock.update({ where: { name }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
      expect((await post(raw)).status).toBe(200);
      expect((await binding(r.bindingId)).status).toBe("active");
      expect(await prisma.systemLock.findUniqueOrThrow({ where: { name } })).toMatchObject({ holder: "done" });
      // Bitmiş mesaj artık tekrar: 200, iş yok.
      expect((await post(raw)).status).toBe(200);
    });

    it("bitmiş mesajın kilidi 8 gün tutulur (Meta bir haftaya kadar yeniden dener)", async () => {
      flagsOn();
      const o = await seedOrg();
      await pending(o, NUM_A);
      const t0 = Date.now();
      await post(body([{ from: DIG_A, id: "wamid.ttl", text: "LIXUS-000000" }]));
      const lock = await prisma.systemLock.findUniqueOrThrow({ where: { name: inboundDedupeName(WHATSAPP_CLOUD_PROVIDER, "wamid.ttl") } });
      expect(lock.holder).toBe("done");
      expect(lock.lockedUntil.getTime() - t0).toBeGreaterThan(7 * 24 * 3600_000);
    });
  });

  describe("🚨 çapraz kiracı — işletme YALNIZ gönderen numaradan", () => {
    // Not: bu dilimde gövdedeki kimlikler (`context.id`, düğme kimliği) HİÇ okunmuyor — cevap eşleme dilimi geldiğinde bu test aynı kalır ve
    // reddin sebebini (gönderenin işletmesi ≠ sorunun işletmesi) sınar; bugün yalnız "gövde kimliği bir şey değiştirmez"i pinler.
    it("A'nın numarasından gelen, gövdesine B'nin kimlikleri yazılmış teslimat B'nin hiçbir satırına dokunmaz", async () => {
      flagsOn();
      const a = await seedOrg();
      const b = await seedOrg();
      const aId = await active(a, NUM_A, DIG_A);
      const bId = await active(b, NUM_B, DIG_B);
      await prisma.hostChannelBinding.updateMany({ data: { lastInboundAt: null } });
      const bBefore = await binding(bId);
      await post(
        body([
          { from: DIG_A, id: "wamid.x1", text: "otopark var", context: `wamid.${bId}`, extra: { organizationId: b.orgId, bindingId: bId } },
          { from: DIG_A, id: "wamid.x2", button: `hq.${bId}.1.self`, extra: { organizationId: b.orgId } },
        ]),
      );
      expect(await binding(bId)).toEqual(bBefore);
      expect((await binding(aId)).lastInboundAt).not.toBeNull();
      const rec = await prisma.operationalEvent.findFirstOrThrow({ where: { event: "host_channel.webhook.received" } });
      expect(rec.organizationId).toBe(a.orgId);
    });

    it("iki işletmenin numarasından gelen tek teslimat: ikisi de işlenir, günlük satırı tek işletmeye yazılmaz", async () => {
      flagsOn();
      const a = await seedOrg();
      const b = await seedOrg();
      const aId = await active(a, NUM_A, DIG_A);
      const bId = await active(b, NUM_B, DIG_B);
      await prisma.hostChannelBinding.updateMany({ data: { lastInboundAt: null } });
      await post(body([
        { from: DIG_A, id: "wamid.m1", text: "x" },
        { from: DIG_B, id: "wamid.m2", text: "y" },
      ]));
      expect((await binding(aId)).lastInboundAt).not.toBeNull();
      expect((await binding(bId)).lastInboundAt).not.toBeNull();
      const rec = await prisma.operationalEvent.findFirstOrThrow({ where: { event: "host_channel.webhook.received" } });
      expect(rec.organizationId).toBeNull();
    });

    it("A'nın numarasından DUR — gövdede B'nin kimlikleri olsa da yalnız A kapanır", async () => {
      flagsOn();
      const a = await seedOrg();
      const b = await seedOrg();
      const aId = await active(a, NUM_A, DIG_A);
      const bId = await active(b, NUM_B, DIG_B);
      await post(body([{ from: DIG_A, id: "wamid.d1", text: "DUR", context: `wamid.${bId}`, extra: { organizationId: b.orgId, bindingId: bId } }]));
      expect((await binding(aId)).status).toBe("revoked");
      expect((await binding(bId)).status).toBe("active");
      expect(tr.texts.map((t) => t.to)).toEqual([DIG_A]);
    });

    it("B için üretilen kod A'nın etkin numarasından gönderilirse A, B'ye geçmez; B'nin bekleyen kodu da harcanmaz", async () => {
      flagsOn();
      const a = await seedOrg();
      const b = await seedOrg();
      const aId = await active(a, NUM_A, DIG_A);
      const rb = await pending(b, NUM_B);
      await post(body([{ from: DIG_A, id: "wamid.c1", text: rb.code, extra: { organizationId: b.orgId } }]));
      expect(await binding(aId)).toMatchObject({ status: "active", organizationId: a.orgId, userId: a.userId });
      expect(await binding(rb.bindingId)).toMatchObject({ status: "pending", verifyAttempts: 0, organizationId: b.orgId });
      // B kendi numarasından gönderince geçer (kod B'nin hesabına bağlı).
      await post(body([{ from: DIG_B, id: "wamid.c2", text: rb.code }]));
      expect(await binding(rb.bindingId)).toMatchObject({ status: "active", organizationId: b.orgId });
    });
  });
});
