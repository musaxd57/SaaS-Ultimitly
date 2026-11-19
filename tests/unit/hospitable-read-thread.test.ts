import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// GERÇEK Hospitable giden adaptörünün KANAL OKUMASI (kurucu 11-19 AK-1; `channels/hospitable-outbound.ts readThread`). Entegrasyon testleri
// sahte sağlayıcıyla koşar; bu dosya gerçek adaptörün okuma yolunu `fetch` taklidiyle sınar (okuma ingest adaptöründen geçer, sağlayıcının
// alanları sağlayıcıdan bağımsız biçime çevrilir, hata fırlatılmaz, belirteçsiz okuma yapılmaz).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

import { hospitableOutboundAdapter } from "@/lib/channels/hospitable-outbound";
import { readOutboundThread } from "@/lib/channels"; // dizin modülü gerçek adaptörleri kaydeder

const DEST = { provider: "hospitable" as const, externalReservationId: "res-1" };

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HOSPITABLE_API_BASE_URL;
  delete process.env.HOSPITABLE_API_TOKEN;
});

describe("Hospitable giden adaptörü — kanal okuması", () => {
  it("konuşmanın mesajlarını sağlayıcıdan bağımsız biçime çevirir (giden / gelen, kimlik, metin, zaman); istek belirteçle gider", async () => {
    process.env.HOSPITABLE_API_BASE_URL = "https://public.api.hospitable.test/v2";
    const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/reservations/res-1/messages");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-1");
      return new Response(
        JSON.stringify({
          data: [
            { id: 11, body: "Merhaba", created_at: "2026-11-19T10:00:00Z", sender_type: "guest" },
            { id: "12", body: "Havluları getiriyoruz.", created_at: "2026-11-19T10:05:00Z", sender_type: "host" },
          ],
          meta: { current_page: 1, last_page: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchStub);
    const read = await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: "tok-1" });
    expect(read).toEqual({
      ok: true,
      messages: [
        { externalId: "11", direction: "inbound", body: "Merhaba", createdAt: new Date("2026-11-19T10:00:00Z") },
        { externalId: "12", direction: "outbound", body: "Havluları getiriyoruz.", createdAt: new Date("2026-11-19T10:05:00Z") },
      ],
    });
  });

  it("sağlayıcı hata verirse { ok: false } (fırlatmaz); belirteç yoksa ağa ÇIKILMAZ", async () => {
    process.env.HOSPITABLE_API_BASE_URL = "https://public.api.hospitable.test/v2";
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ message: "not found" }), { status: 404, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchStub);
    expect(await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: "tok-1" })).toEqual({ ok: false });
    fetchStub.mockClear();
    expect(await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: undefined })).toEqual({ ok: false });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("🚨 belirteç yokken ORTAMDAKİ genel belirteç tanımlı olsa da ağa ÇIKILMAZ (başka işletmenin konuşması genel belirteçle okunmaz; mutasyon 11-19)", async () => {
    process.env.HOSPITABLE_API_BASE_URL = "https://public.api.hospitable.test/v2";
    process.env.HOSPITABLE_API_TOKEN = "env-global-token";
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], meta: { current_page: 1, last_page: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    expect(await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: undefined })).toEqual({ ok: false });
    expect(await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: "" })).toEqual({ ok: false });
    expect(fetchStub).not.toHaveBeenCalled();
    // KONTROL: aynı ortamda işletmenin kendi belirteciyle okuma yapılır (testin kendisi ağı kesmiyor).
    expect(await hospitableOutboundAdapter.readThread!(DEST, { provider: "hospitable", token: "tok-1" })).toEqual({ ok: true, messages: [] });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("🚨 kanal katmanı: kimlik bilgisinin sağlayıcısı hedefle uyuşmuyorsa okuma YOK (null), adaptöre gidilmez (mutasyon 11-19)", async () => {
    process.env.HOSPITABLE_API_BASE_URL = "https://public.api.hospitable.test/v2";
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], meta: { current_page: 1, last_page: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const foreign = { provider: "airbnb_direct", token: "tok-1" } as unknown as Parameters<typeof readOutboundThread>[1];
    expect(await readOutboundThread(DEST, foreign)).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
    // KONTROL: uyuşan sağlayıcıyla aynı çağrı okur.
    expect(await readOutboundThread(DEST, { provider: "hospitable", token: "tok-1" })).toEqual({ ok: true, messages: [] });
  });
});
