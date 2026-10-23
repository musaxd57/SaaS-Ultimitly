import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dispatchOutbound,
  resolveOutboundRoute,
  getOutboundAdapter,
  __setOutboundAdapterForTest,
  type OutboundAdapter,
  type OutboundProvider,
} from "@/lib/channels";
import { sendMessage } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// DISPATCH SINIRININ KAPILARI (V0.1) — adaptör yok / yetenek yok / kimlik-bilgisi
// sağlayıcıyla uyuşmuyor → ASLA fırlatmaz, tipli definitive_failure döner (worker
// terminal dalına düşer, misafire hiçbir şey gitmez). Ayrıca gerçek istemcinin
// HTTP durumunu sonuca taşıdığı (adaptörün tipli sınıflandırmasının girdisi) pinli.
// ---------------------------------------------------------------------------
const DEST = { provider: "hospitable" as const, externalReservationId: "res-1" };

describe("resolveOutboundRoute", () => {
  it("boş / null / undefined → local(no_destination); qr-chat → local(internal_thread); aksi → external hospitable", () => {
    expect(resolveOutboundRoute({ externalReservationId: null })).toEqual({ kind: "local", reason: "no_destination" });
    expect(resolveOutboundRoute({})).toEqual({ kind: "local", reason: "no_destination" });
    expect(resolveOutboundRoute({ externalReservationId: "" })).toEqual({ kind: "local", reason: "no_destination" });
    expect(resolveOutboundRoute({ externalReservationId: "qr-chat:prop-1" })).toEqual({ kind: "local", reason: "internal_thread" });
    expect(resolveOutboundRoute({ externalReservationId: "abc-uuid" })).toEqual({
      kind: "external",
      destination: { provider: "hospitable", externalReservationId: "abc-uuid" },
    });
  });
});

describe("dispatchOutbound — kapılar fırlatmaz, tipli başarısızlık döner", () => {
  afterEach(() => __setOutboundAdapterForTest("hospitable", null));

  it("yerleşik Hospitable adaptörü kayıtlı (index bootstrap)", () => {
    expect(getOutboundAdapter("hospitable")?.provider).toBe("hospitable");
  });

  it("🚨 kimlik bilgisi başka sağlayıcıya aitse gönderim YAPILMAZ", async () => {
    const send = vi.fn<OutboundAdapter["send"]>(async () => ({ ok: true, kind: "definitive_success" }));
    __setOutboundAdapterForTest("hospitable", { provider: "hospitable", capabilities: new Set(["messages.send"]), send });
    const r = await dispatchOutbound(DEST, "b", { provider: "other" as unknown as OutboundProvider, token: "t" });
    expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
    expect(send).not.toHaveBeenCalled();
  });

  it("🚨 yeteneği olmayan adaptöre (ör. yalnız-okuma takvim) gönderim YAPILMAZ", async () => {
    const send = vi.fn<OutboundAdapter["send"]>(async () => ({ ok: true, kind: "definitive_success" }));
    __setOutboundAdapterForTest("hospitable", { provider: "hospitable", capabilities: new Set(), send });
    const r = await dispatchOutbound(DEST, "b", { provider: "hospitable", token: "t" });
    expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
    expect(send).not.toHaveBeenCalled();
  });

  it("adaptör yoksa tipli definitive_failure (fırlatmaz)", async () => {
    const r = await dispatchOutbound({ ...DEST, provider: "ghost" as unknown as OutboundProvider }, "b", {
      provider: "ghost" as unknown as OutboundProvider,
      token: "t",
    });
    expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
  });

  it("KONTROL: yetenekli + eşleşen kimlik bilgisi → adaptöre aynen devredilir", async () => {
    const send = vi.fn<OutboundAdapter["send"]>(async () => ({ ok: true, kind: "definitive_success", providerMessageId: "X" }));
    __setOutboundAdapterForTest("hospitable", { provider: "hospitable", capabilities: new Set(["messages.send"]), send });
    const r = await dispatchOutbound(DEST, "gövde", { provider: "hospitable", token: "t" });
    expect(r).toMatchObject({ ok: true, providerMessageId: "X" });
    expect(send).toHaveBeenCalledWith(DEST, "gövde", { provider: "hospitable", token: "t" });
  });
});

describe("hospitable.sendMessage — HTTP durumu sonuca taşınır (adaptörün tipli girdisi)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("402 → { ok:false, status:402 } ve metin eskisi gibi 'HTTP 402' taşır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"Subscription not active"}', { status: 402 })));
    const r = await sendMessage("res-1", "hi", "tok", { retries: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.error).toContain("HTTP 402");
  });

  it("ağ hatası → status YOK (belirsiz), ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const r = await sendMessage("res-1", "hi", "tok", { retries: 0 });
    expect(r.ok).toBe(false);
    expect(r.status).toBeUndefined();
  });
});
