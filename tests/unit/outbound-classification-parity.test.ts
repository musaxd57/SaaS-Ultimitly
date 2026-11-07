import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// TİPLİ SINIFLANDIRMA ↔ METİN REGEX'İ PARİTESİ (V0.1)
//
// Adaptör `kind`i sağlayıcının KENDİ şeklinden (HTTP durumu) üretir; eski
// çekirdek aynı kararı `error` metnindeki "HTTP (\d{3})" ile veriyordu
// (`outbox/state.ts classifySendResult`). İkisi ayrışırsa worker'ın durum
// makinesi (pending/blocked/failed/ambiguous) sessizce değişir. Her durum için
// eşitlik burada pinli; ayrıca tipli yolun METİNSİZ de çalıştığı (gelecek
// adaptör argümanı) ve tanımsız durumda metin regex'ine düştüğü pinli.
// ---------------------------------------------------------------------------
vi.mock("@/lib/hospitable", () => ({ sendMessage: vi.fn() }));

import { sendMessage, type SendResult } from "@/lib/hospitable";
import { classifySendResult } from "@/lib/outbox/state";
import { hospitableOutboundAdapter, classifyHospitableOutcome } from "@/lib/channels/hospitable-outbound";

const mockClient = vi.mocked(sendMessage);
const DEST = { provider: "hospitable" as const, externalReservationId: "res-1" };
const CRED = { provider: "hospitable" as const, token: "tok" };

const textFor = (status: number) => `Hospitable API hatası (HTTP ${status}): {"message":"x"}`;

describe("classifyHospitableOutcome — durum kodu ↔ metin regex'i", () => {
  it("her HTTP durumu için tipli sınıf == regex sınıfı", () => {
    for (const status of [400, 401, 402, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504]) {
      const r: SendResult = { ok: false, error: textFor(status), status };
      expect(classifyHospitableOutcome(r), String(status)).toBe(classifySendResult({ ok: false, error: r.error }));
    }
  });

  it("başarı → definitive_success; ağ/abort (durum yok) → ambiguous (regex ile aynı)", () => {
    expect(classifyHospitableOutcome({ ok: true, id: "1" })).toBe("definitive_success");
    for (const error of ["fetch failed", "The operation was aborted", "ETIMEDOUT", ""]) {
      expect(classifyHospitableOutcome({ ok: false, error }), error).toBe("ambiguous");
      expect(classifySendResult({ ok: false, error })).toBe("ambiguous");
    }
  });

  it("🚨 tipli yol METİNSİZ de doğru sınıflar — gelecek adaptörün hata metni Hospitable biçiminde olmayacak", () => {
    expect(classifyHospitableOutcome({ ok: false, status: 429, error: "" })).toBe("rate_limited");
    expect(classifyHospitableOutcome({ ok: false, status: 402, error: "" })).toBe("blocked");
    expect(classifyHospitableOutcome({ ok: false, status: 404, error: "" })).toBe("definitive_failure");
    expect(classifyHospitableOutcome({ ok: false, status: 401, error: "" })).toBe("auth_revoked");
    expect(classifyHospitableOutcome({ ok: false, status: 403, error: "" })).toBe("auth_revoked");
    expect(classifyHospitableOutcome({ ok: false, status: 408, error: "" })).toBe("ambiguous");
    expect(classifyHospitableOutcome({ ok: false, status: 503, error: "" })).toBe("ambiguous");
    // Aynı girdide regex hiçbir şey göremez → bu ayrımın tipli yolla geldiği kanıt.
    expect(classifySendResult({ ok: false, error: "" })).toBe("ambiguous");
  });

  it("durum YOKSA metin regex'ine düşer (eski çağıran / legacy)", () => {
    expect(classifyHospitableOutcome({ ok: false, error: "HTTP 402 Payment Required" })).toBe("blocked");
    expect(classifyHospitableOutcome({ ok: false, error: "HTTP 429 Too Many Requests" })).toBe("rate_limited");
  });
});

describe("hospitableOutboundAdapter.send — argüman sözleşmesi ve sonuç şekli", () => {
  beforeEach(() => vi.clearAllMocks());

  it("istemciyi (id, body, token, { retries: 0 }) ile çağırır ve tipli sonuç döndürür", async () => {
    mockClient.mockResolvedValue({ ok: true, id: "PROV-1" });
    const r = await hospitableOutboundAdapter.send(DEST, "Merhaba", CRED);
    expect(mockClient).toHaveBeenCalledWith("res-1", "Merhaba", "tok", { retries: 0 });
    expect(r).toEqual({ ok: true, kind: "definitive_success", error: null, providerMessageId: "PROV-1", retryAfterSec: null });
  });

  it("429: retryAfterSec taşınır, kind rate_limited; hata metni teşhis için korunur", async () => {
    mockClient.mockResolvedValue({ ok: false, error: textFor(429), status: 429, retryAfterSec: 12 });
    const r = await hospitableOutboundAdapter.send(DEST, "M", CRED);
    expect(r).toEqual({ ok: false, kind: "rate_limited", error: textFor(429), providerMessageId: null, retryAfterSec: 12 });
  });

  it("yetenek beyanı: messages.send", () => {
    expect(hospitableOutboundAdapter.provider).toBe("hospitable");
    expect(hospitableOutboundAdapter.capabilities.has("messages.send")).toBe(true);
  });
});
