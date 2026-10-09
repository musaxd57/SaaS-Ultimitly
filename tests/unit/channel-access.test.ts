import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// V0.8 — KANAL ERİŞİMİ kayıt defteri (`src/lib/channels/access.ts`) + Hospitable çözücüsü.
//
// Sözleşme: çekirdeğin eskiden doğrudan çağırdığı üç kimlik fonksiyonuna AYNI argümanlarla devredilir (davranış
// birebir); org düzeyindeki soru tek kayıtlı sağlayıcıya sorulur; ikinci sağlayıcı kaydedildiği anda org düzeyindeki
// soru KAPALI BAŞARISIZ olur (yanlış sağlayıcının kimlik bilgisini taşımak yerine "bağlı değil").
// Gerçek çekirdek yollarının bu sınırdan geçtiği: tests/integration/channel-access-boundary.test.ts.
// ---------------------------------------------------------------------------

const creds = vi.hoisted(() => ({
  getOrgHospitableToken: vi.fn<(orgId: string) => Promise<string | null>>(),
  handleProviderAuthFailure: vi.fn<(orgId: string, status: 401 | 403, token: string) => Promise<"refresh_forced" | "revoked" | "noop">>(),
  getConnectionInfo: vi.fn<(orgId: string) => Promise<{ connected: boolean }>>(),
}));
vi.mock("@/lib/hospitable-credentials", () => creds);

import {
  resolveOrgChannelCredential,
  activeMessagingConnectionId,
  handleOutboundCredentialRejected,
  hasMessagingConnection,
  __setMessagingAccessForTest,
  type MessagingAccess,
} from "@/lib/channels";

beforeEach(() => {
  creds.getOrgHospitableToken.mockReset();
  creds.handleProviderAuthFailure.mockReset();
  creds.getConnectionInfo.mockReset();
});

describe("Hospitable çözücüsü — eski çağrılarla birebir", () => {
  it("kimlik bilgisi: getOrgHospitableToken(orgId) → { provider: hospitable, token }", async () => {
    creds.getOrgHospitableToken.mockResolvedValue("tok-1");
    expect(await resolveOrgChannelCredential("org-A")).toEqual({ provider: "hospitable", token: "tok-1" });
    expect(creds.getOrgHospitableToken).toHaveBeenCalledWith("org-A");
  });

  it("🚨 bağlı değil (null) → null; çözücü yalnız İSTENEN org için tek kez sorulur (sınırda başka kaynağa geri düşüş yok)", async () => {
    creds.getOrgHospitableToken.mockResolvedValue(null);
    expect(await resolveOrgChannelCredential("org-B")).toBeNull();
    expect(creds.getOrgHospitableToken).toHaveBeenCalledTimes(1);
    expect(creds.getOrgHospitableToken).toHaveBeenCalledWith("org-B");
  });

  it("🚨 hedefin sağlayıcısı verilirse ve tek kayıtlı sağlayıcı o DEĞİLSE kimlik bilgisi yok (inceleme 10-09 #5)", async () => {
    creds.getOrgHospitableToken.mockResolvedValue("tok-1");
    expect(await resolveOrgChannelCredential("org-A", "airbnb_direct" as never)).toBeNull();
    expect(creds.getOrgHospitableToken).not.toHaveBeenCalled();
    // KONTROL: doğru sağlayıcı verilince aynen çözülür.
    expect(await resolveOrgChannelCredential("org-A", "hospitable")).toEqual({ provider: "hospitable", token: "tok-1" });
  });

  it("ret: handleProviderAuthFailure(orgId, status, reddedilen token) — aynı argümanlar, sonuç aynen döner", async () => {
    creds.handleProviderAuthFailure.mockResolvedValue("revoked");
    const out = await handleOutboundCredentialRejected("org-A", 403, { provider: "hospitable", token: "tok-old" });
    expect(out).toBe("revoked");
    expect(creds.handleProviderAuthFailure).toHaveBeenCalledWith("org-A", 403, "tok-old");
  });

  it("ret: token yoksa hüküm verilmez (noop), sağlayıcının yaşam döngüsü çağrılmaz", async () => {
    expect(await handleOutboundCredentialRejected("org-A", 401, { provider: "hospitable", token: undefined })).toBe("noop");
    expect(creds.handleProviderAuthFailure).not.toHaveBeenCalled();
  });

  it("gönderim niyeti provenance'ı: aktif bağlantı kimliği çözücüden (sağlayıcı dizesi çekirdekte değil)", async () => {
    const own = vi.fn(async () => "conn-1");
    __setMessagingAccessForTest("hospitable", {
      provider: "hospitable",
      credentialFor: vi.fn(async () => null),
      onCredentialRejected: vi.fn(async () => "noop" as const),
      isConnected: vi.fn(async () => true),
      activeConnectionId: own,
    });
    try {
      expect(await activeMessagingConnectionId("org-A")).toBe("conn-1");
      expect(own).toHaveBeenCalledWith("org-A");
    } finally {
      __setMessagingAccessForTest("hospitable", null);
    }
  });

  it("panel durumu: getConnectionInfo(orgId).connected aynen", async () => {
    creds.getConnectionInfo.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({ connected: false });
    expect(await hasMessagingConnection("org-A")).toBe(true);
    expect(await hasMessagingConnection("org-A")).toBe(false);
    expect(creds.getConnectionInfo).toHaveBeenCalledWith("org-A");
  });
});

describe("🚨 İKİNCİ SAĞLAYICI KAPISI — org düzeyindeki soru belirsizse kapalı başarısız", () => {
  const second: MessagingAccess = {
    provider: "airbnb_direct" as never, // bugün OutboundProvider'a giremez (derleme kapısı); yalnız kapıyı sınamak için
    credentialFor: vi.fn(async () => "tok-second"),
    onCredentialRejected: vi.fn(async () => "noop" as const),
    isConnected: vi.fn(async () => true),
    activeConnectionId: vi.fn(async () => "conn-second"),
  };
  afterEach(() => __setMessagingAccessForTest("airbnb_direct" as never, null));

  it("iki sağlayıcı kayıtlıyken kimlik bilgisi YOK ve bağlı DEĞİL; hiçbir çözücü sorulmaz", async () => {
    creds.getOrgHospitableToken.mockResolvedValue("tok-1");
    creds.getConnectionInfo.mockResolvedValue({ connected: true });
    __setMessagingAccessForTest("airbnb_direct" as never, second);
    expect(await resolveOrgChannelCredential("org-A")).toBeNull();
    expect(await hasMessagingConnection("org-A")).toBe(false);
    expect(creds.getOrgHospitableToken).not.toHaveBeenCalled();
    expect(second.credentialFor).not.toHaveBeenCalled();
  });

  it("KONTROL: ikinci kayıt kalkınca tek sağlayıcıya geri döner (kapı her zaman kapalı değil)", async () => {
    creds.getOrgHospitableToken.mockResolvedValue("tok-1");
    __setMessagingAccessForTest("airbnb_direct" as never, second);
    __setMessagingAccessForTest("airbnb_direct" as never, null);
    expect(await resolveOrgChannelCredential("org-A")).toEqual({ provider: "hospitable", token: "tok-1" });
  });

  it("ret hükmü SAĞLAYICISINA gider: ikinci sağlayıcının reddi Hospitable'ın yaşam döngüsünü çalıştırmaz", async () => {
    __setMessagingAccessForTest("airbnb_direct" as never, second);
    await handleOutboundCredentialRejected("org-A", 401, { provider: "airbnb_direct" as never, token: "tok-second" });
    expect(second.onCredentialRejected).toHaveBeenCalledWith("org-A", 401, "tok-second");
    expect(creds.handleProviderAuthFailure).not.toHaveBeenCalled();
  });
});
