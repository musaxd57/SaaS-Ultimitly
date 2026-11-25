import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// K27-K14 (Codex 11-25 akşam): imzalı TEK teslimat hem ev sahibi mesajı (ör. "DUR" — bildirimden çık) hem ekip numarası mesajı / teslim
// durumları taşıyorsa ev sahibi işleyicisi ÖNCE koşar; yavaş ya da hata veren ekip / durum işi ev sahibini BEKLETMEZ ve KESMEZ. Yanıt
// sözleşmesi aynı: ev sahibi hatası 500, ev sahibi meşgul 503, yalnız ekip hatası 500, hepsi iyi 200 (Meta 2xx dışını yeniden dener).
// İşleyiciler taklit: burada ölçülen yalnız rotanın SIRASI ve yanıt kodu (işleyicilerin kendi davranışı kendi testlerinde).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  order: [] as string[],
  staffGate: null as Promise<void> | null,
  statusGate: null as Promise<void> | null,
  staffThrows: false,
  hostResult: { processed: 1, duplicates: 0, ignored: 0, busy: 0, organizationIds: ["org1"] } as Record<string, unknown>,
  hostThrows: false,
}));

vi.mock("@/lib/host-channel/inbound", () => ({
  handleHostInbound: vi.fn(async () => {
    h.order.push("host");
    if (h.hostThrows) throw new Error("ev sahibi isleyicisi dustu");
    return h.hostResult;
  }),
}));
vi.mock("@/lib/team-contacts/inbound", () => ({
  handleStaffInbound: vi.fn(async () => {
    h.order.push("staff:start");
    if (h.staffGate) await h.staffGate;
    h.order.push("staff:end");
    if (h.staffThrows) throw new Error("ekip isleyicisi dustu");
    return { bound: 0, organizationIds: [] };
  }),
}));
vi.mock("@/lib/host-channel/delivery-status", async (orig) => {
  const actual = await orig<typeof import("@/lib/host-channel/delivery-status")>();
  return {
    ...actual,
    recordHostDeliveryStatuses: vi.fn(async () => {
      h.order.push("status:start");
      if (h.statusGate) await h.statusGate;
      h.order.push("status:end");
    }),
  };
});
vi.mock("@/lib/host-channel/alert-email", () => ({ expediteForFailedProviderIds: vi.fn(async () => {}) }));
vi.mock("@/lib/host-channel/late-failure-mail", () => ({ scheduleLateFailureMails: vi.fn(async () => {}) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "sent"), clearAlertState: vi.fn(async () => {}) }));
vi.mock("@/lib/event-log", () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => "reported") }));
vi.mock("@/lib/host-channel-runtime", () => ({ hostChannelTransport: () => null }));

import { POST } from "@/app/api/webhooks/host-channel/whatsapp/route";
import { handleHostInbound } from "@/lib/host-channel/inbound";
import { handleStaffInbound } from "@/lib/team-contacts/inbound";

const APP_SECRET = "test-whatsapp-app-secret-0123456789";
const HOST_PNID = "109876543210987";
const TEAM_PNID = "209876543210987";

function delivery(opts: { team?: boolean; status?: boolean }): string {
  const now = String(Math.floor(Date.now() / 1000));
  const changes: unknown[] = [
    {
      field: "messages",
      value: {
        metadata: { phone_number_id: HOST_PNID },
        messages: [{ from: "905321112233", id: "wamid.HOST1", timestamp: now, type: "text", text: { body: "DUR" } }],
        ...(opts.status ? { statuses: [{ id: "wamid.OUT1", status: "read", timestamp: now, recipient_id: "905321112233" }] } : {}),
      },
    },
  ];
  if (opts.team) {
    changes.push({
      field: "messages",
      value: {
        metadata: { phone_number_id: TEAM_PNID },
        messages: [{ from: "905329998877", id: "wamid.TEAM1", timestamp: now, type: "text", text: { body: "123456" } }],
      },
    });
  }
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes }] });
}

const post = (b: string) =>
  POST(
    new NextRequest("https://www.lixusai.com/api/webhooks/host-channel/whatsapp", {
      method: "POST",
      body: b,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(b).digest("hex")}` },
    }),
  );

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe("K14 — WhatsApp web kancası: ev sahibi işleyicisi ekip / durum işinden ÖNCE", () => {
  beforeEach(() => {
    h.order.length = 0;
    h.staffGate = null;
    h.statusGate = null;
    h.staffThrows = false;
    h.hostThrows = false;
    h.hostResult = { processed: 1, duplicates: 0, ignored: 0, busy: 0, organizationIds: ["org1"] };
    vi.mocked(handleHostInbound).mockClear();
    vi.mocked(handleStaffInbound).mockClear();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", HOST_PNID);
    vi.stubEnv("TEAM_CONTACTS_ENABLED", "1");
    vi.stubEnv("TEAM_WHATSAPP_PHONE_NUMBER_ID", TEAM_PNID);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ekip işleyicisi asılıyken ev sahibinin mesajı YİNE işlenir (bekletmez)", async () => {
    const g = gate();
    h.staffGate = g.promise;
    const pending = post(delivery({ team: true }));
    await vi.waitFor(() => expect(handleHostInbound).toHaveBeenCalledTimes(1), { timeout: 2000 });
    g.open();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(h.order.indexOf("host")).toBeLessThan(h.order.indexOf("staff:start"));
    expect(handleStaffInbound).toHaveBeenCalledTimes(1); // ekip işi yine yapılır
  });

  it("teslim durumu kaydı asılıyken ev sahibinin mesajı YİNE işlenir", async () => {
    const g = gate();
    h.statusGate = g.promise;
    const pending = post(delivery({ status: true }));
    await vi.waitFor(() => expect(handleHostInbound).toHaveBeenCalledTimes(1), { timeout: 2000 });
    g.open();
    expect((await pending).status).toBe(200);
    expect(h.order.indexOf("host")).toBeLessThan(h.order.indexOf("status:start"));
    expect(h.order).toContain("status:end");
  });

  it("ekip hatası ev sahibini kesmez; yanıt yine 500 (Meta yeniden dener — sözleşme aynı)", async () => {
    h.staffThrows = true;
    const res = await post(delivery({ team: true }));
    expect(handleHostInbound).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });

  it("ev sahibi hatası ekip / durum işini kesmez; yanıt 500", async () => {
    h.hostThrows = true;
    const res = await post(delivery({ team: true, status: true }));
    expect(res.status).toBe(500);
    expect(handleStaffInbound).toHaveBeenCalledTimes(1);
    expect(h.order).toContain("status:end");
  });

  it("ev sahibi meşgul → 503 (ekip hatası olsa da; eski öncelik aynı) ve ekip işi yine yapılır", async () => {
    h.hostResult = { processed: 0, duplicates: 0, ignored: 0, busy: 1, organizationIds: [] };
    h.staffThrows = true;
    const res = await post(delivery({ team: true }));
    expect(res.status).toBe(503);
    expect(handleStaffInbound).toHaveBeenCalledTimes(1);
  });

  it("yalnız ekip mesajı (ev sahibi mesajı yok): ev sahibi işleyicisi çağrılmaz; ekip hatası 500, başarı 200", async () => {
    const teamOnly = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: TEAM_PNID }, messages: [{ from: "905329998877", id: "wamid.T2", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "1" } }] } }] }],
    });
    expect((await post(teamOnly)).status).toBe(200);
    h.staffThrows = true;
    expect((await post(teamOnly)).status).toBe(500);
    expect(handleHostInbound).not.toHaveBeenCalled();
  });
});
