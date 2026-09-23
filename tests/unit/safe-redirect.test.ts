import { describe, it, expect } from "vitest";
import { safeRedirectTarget } from "@/lib/safe-redirect";

// ---------------------------------------------------------------------------
// GİRİŞ SONRASI YÖNLENDİRME — davranışsal pin (09-23 denetimi).
// 08-07 düzeltmesi origin'i karşılaştırıyordu ama `/.//evil` ORIGIN kontrolünden
// geçip pathname'i `//evil` yapıyordu → Next onu protokol-göreli DIŞ adres sayıyordu
// (kimlik avı; kurban gerçek sitede şifre + 2FA girdikten sonra saldırgana düşer).
// Eski pin yalnız kaynak METNİNE bakıyordu, bu yüzden atlatma görünmedi.
// ---------------------------------------------------------------------------

const O = "https://www.lixusai.com";

describe("safeRedirectTarget — dış adrese çıkış YOK", () => {
  it.each([
    ["/.//evil.example/phish"], // 🚨 ölçülen atlatma
    ["/..//evil.example"],
    [`${O}//evil.example`],
    ["//evil.example"],
    ["/\\evil.example"],
    ["/\t/evil.example"], // 08-07'nin kapattığı sınıf (ayrıştırıcı TAB'ı siler)
    ["/\n/evil.example"],
    ["https://evil.example/"],
    ["http://www.lixusai.com/dashboard"], // şema farklı → origin farklı
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
  ])("%j → null (varsayılana düşer)", (next) => {
    expect(safeRedirectTarget(next, O)).toBeNull();
  });

  it.each([
    ["/dashboard", "/dashboard"],
    ["/inbox/abc123", "/inbox/abc123"],
    ["/inbox?tab=problem#son", "/inbox?tab=problem#son"],
    [`${O}/settings`, "/settings"],
    ["/./inbox", "/inbox"], // normalizasyon zararsız hedefte zaten uygulanır
  ])("%j → %j (meşru hedef korunur)", (next, beklenen) => {
    expect(safeRedirectTarget(next, O)).toBe(beklenen);
  });

  it("boş / eksik → null", () => {
    expect(safeRedirectTarget(null, O)).toBeNull();
    expect(safeRedirectTarget(undefined, O)).toBeNull();
    expect(safeRedirectTarget("", O)).toBeNull();
  });
});
