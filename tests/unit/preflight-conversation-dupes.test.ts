import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMEOUTS,
  MAX_STATEMENT_TIMEOUT_MS,
  QR_PREFIX,
  decide,
  resolveTimeouts,
} from "../../scripts/preflight-conversation-dupes.mjs";

// ---------------------------------------------------------------------------
// Preflight — SAF katman (DB'siz).
//
// Bu dosya iki şeyi pinler:
//   1. Zaman aşımı çözümü FAIL-CLOSED. "0 = sınırsız" tam da kaçınmak istediğimiz
//      şey: sınırsız statement_timeout, salt-okuma bir SELECT'in ACCESS SHARE'i
//      dakikalarca tutmasına ve boot'taki ALTER TABLE'ın arkasında kuyruk
//      oluşmasına izin verir. Kabul EDİLMEMELİ.
//   2. Karar fonksiyonu sınıflandırmayı doğru okur — özellikle "çelişkili
//      conversation id" her şeyin ÜSTÜNDE ve kararı 2'ye çevirir.
// ---------------------------------------------------------------------------

function stats(over: { groups?: Record<string, number>; qr?: Record<string, number> } = {}) {
  return {
    groups: {
      hosp_groups: 0,
      hosp_conflicting: 0,
      hosp_mixed: 0,
      hosp_same: 0,
      hosp_all_null: 0,
      qr_groups: 0,
      ...over.groups,
    },
    qr: { qr_total: 0, qr_legacy: 0, ...over.qr },
  };
}

describe("preflight — resolveTimeouts (fail-closed)", () => {
  it("boş env'de güvenli varsayılanları verir", () => {
    expect(resolveTimeouts({})).toEqual(DEFAULT_TIMEOUTS);
  });

  it("0 (=sınırsız) statement_timeout'u REDDEDER", () => {
    expect(() => resolveTimeouts({ PREFLIGHT_STATEMENT_TIMEOUT_MS: "0" })).toThrow(
      /PREFLIGHT_STATEMENT_TIMEOUT_MS/,
    );
  });

  it("üst sınırın üstünü reddeder", () => {
    expect(() =>
      resolveTimeouts({ PREFLIGHT_STATEMENT_TIMEOUT_MS: String(MAX_STATEMENT_TIMEOUT_MS + 1) }),
    ).toThrow(/PREFLIGHT_STATEMENT_TIMEOUT_MS/);
  });

  it("tam sayı olmayanı reddeder", () => {
    expect(() => resolveTimeouts({ PREFLIGHT_LOCK_TIMEOUT_MS: "3s" })).toThrow(
      /PREFLIGHT_LOCK_TIMEOUT_MS/,
    );
  });

  it("aralıktaki değeri kabul eder", () => {
    expect(resolveTimeouts({ PREFLIGHT_STATEMENT_TIMEOUT_MS: "45000" }).statementMs).toBe(45_000);
  });
});

describe("preflight — decide (saf karar)", () => {
  it("çakışma yoksa TEMİZ", () => {
    expect(decide(stats())).toEqual({ code: "TEMIZ", exitCode: 0 });
  });

  it("yalnız yarış artığı varsa gözetimli dedupe ister", () => {
    expect(decide(stats({ groups: { hosp_groups: 3, hosp_same: 3 } }))).toEqual({
      code: "DEDUPE_GEREKLI",
      exitCode: 10,
    });
  });

  it("ÇELİŞKİLİ conversation id her şeyin üstünde — karar 2'ye döner", () => {
    expect(
      decide(stats({ groups: { hosp_groups: 4, hosp_same: 3, hosp_conflicting: 1 } })),
    ).toEqual({ code: "CELISKI", exitCode: 20 });
  });

  it("legacy QR satırı TEK BAŞINA kararı değiştirmez", () => {
    // ÖNCEKİ SÖZLEŞME YANLIŞTI (Codex): `qr_legacy > 0` tek başına
    // DEDUPE_GEREKLI veriyordu. Kısıtı ihlal eden şey eski-id'li bir satırın
    // VARLIĞI değil, aynı marker'ın BİRDEN FAZLA satırda olmasıdır — ve o
    // popülasyon zaten `qr_groups` ile sayılıyor. Marker'ını kimseyle
    // paylaşmayan bir legacy satır unique'i engellemez; onu karara katmak
    // tertemiz bir veritabanını "dedupe gerekli" diye işaretlerdi.
    expect(decide(stats({ qr: { qr_total: 9, qr_legacy: 4 } }))).toEqual({
      code: "TEMIZ",
      exitCode: 0,
    });
  });

  it("çakışan QR grubu ise kararı DEĞİŞTİRİR", () => {
    // Ayırt edici karşı-örnek: aynı legacy sayısı, fakat bu kez marker
    // paylaşan gerçek bir grup var.
    expect(decide(stats({ groups: { qr_groups: 1 }, qr: { qr_total: 9, qr_legacy: 4 } }))).toEqual({
      code: "DEDUPE_GEREKLI",
      exitCode: 10,
    });
  });

  it("QR marker öneki `ensureGuestChatConversation` ile birebir", () => {
    // Önek kayarsa sınıflandırma sessizce bozulur: QR satırları Hospitable
    // yarış artığı sanılır ve karar yanlış çıkar.
    expect(QR_PREFIX).toBe("qr-chat:");
  });
});
