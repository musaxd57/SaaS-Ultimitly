import { describe, it, expect } from "vitest";
import { isLicenseType, parseAttributes, sourceAllowedFor, isRegistrySourceId, LICENSE_TYPES } from "@/lib/licenses/catalog";
import { normalizeLicenseNumber, normalizeLegalName } from "@/lib/licenses/normalize";
import { isValidTckn, parseTaxId, maskTaxId } from "@/lib/licenses/tax-id";
import {
  nextStatus,
  effectiveStatus,
  lockKeyFor,
  pendingUntilFrom,
  isPendingExpired,
  LICENSE_STATUSES,
  PENDING_TTL_DAYS,
  type LicenseAction,
} from "@/lib/licenses/state";
import { licenseMarks, marksForProperty, MARK_TTL_DAYS, type LicenseMarkInput } from "@/lib/licenses/capabilities";
import { LICENSE_STATUS_LABEL, markText } from "@/lib/licenses/messages";
import { licenseSecret, licensesEnabled, taxIdHash } from "@/lib/licenses/secret";

// ---------------------------------------------------------------------------
// İŞLETME BELGESİ Faz 1a — saf çekirdek (tasarım docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md §2–§5).
// Kurgusal adlar ("Lale", "Örnek"); TC kimlik örneği yaygın bilinen sahte test numarası.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

describe("katalog", () => {
  it("Faz 1a türleri kapalı küme; konut izni (7464) YOK — Bakanlık API'si gelmeden doğrulanamaz", () => {
    expect([...LICENSE_TYPES]).toEqual(["agency", "tourism_operation", "simple_accommodation"]);
    expect(isLicenseType("str_permit")).toBe(false);
    expect(isLicenseType("municipal_license")).toBe(false);
  });

  it("kaynak türe uygun olmalı: acenta belgesi tesis sorgusundan 'eşleşti' sayılmaz; bilinmeyen kaynak yok", () => {
    expect(sourceAllowedFor("agency", "ktb_agency_search")).toBe(true);
    expect(sourceAllowedFor("agency", "tursab_agency_search")).toBe(true);
    expect(sourceAllowedFor("agency", "ktb_facility_search")).toBe(false);
    expect(sourceAllowedFor("tourism_operation", "tursab_agency_search")).toBe(false);
    expect(isRegistrySourceId("tursab-sorgu.example")).toBe(false);
    expect(isRegistrySourceId("__proto__")).toBe(false);
  });

  it("nitelikler: acentada grup zorunlu (A/B/C); fazladan alan reddedilir; tesis metni temizlenir ve sınırlıdır", () => {
    expect(parseAttributes("agency", { group: "A" })).toEqual({ ok: true, value: { group: "A" } });
    expect(parseAttributes("agency", { group: "D" })).toEqual({ ok: false });
    expect(parseAttributes("agency", {})).toEqual({ ok: false });
    expect(parseAttributes("agency", { group: "A", extra: 1 })).toEqual({ ok: false });
    expect(parseAttributes("tourism_operation", { facilityType: "  Butik​   otel ", starClass: "" })).toEqual({
      ok: true,
      value: { facilityType: "Butik otel" },
    });
    expect(parseAttributes("tourism_operation", { facilityType: "x".repeat(61) })).toEqual({ ok: false });
    expect(parseAttributes("simple_accommodation", { group: "A" })).toEqual({ ok: false });
    expect(parseAttributes("simple_accommodation", undefined)).toEqual({ ok: true, value: {} });
    expect(parseAttributes("agency", ["A"])).toEqual({ ok: false });
  });
});

describe("normalleştirme", () => {
  it("numara: ayraçlar atılır, harf büyür; başka karakter, rakamsız ya da çok uzun → geçersiz", () => {
    expect(normalizeLicenseNumber(" 12.345 ")).toBe("12345");
    expect(normalizeLicenseNumber("ab-12/3")).toBe("AB123");
    expect(normalizeLicenseNumber("12345")).toBe(normalizeLicenseNumber("12 345"));
    expect(normalizeLicenseNumber("12;345")).toBe("");
    expect(normalizeLicenseNumber("ABC")).toBe("");
    expect(normalizeLicenseNumber("1".repeat(41))).toBe("");
    expect(normalizeLicenseNumber("")).toBe("");
  });

  it("unvan: biçim farkı yok olur ('Limited Şirketi' = 'Ltd. Şti.', 'Anonim Şirketi' = 'A.Ş.'), farklı unvan farklı kalır", () => {
    const a = normalizeLegalName("Lale Turizm Ticaret Limited Şirketi");
    expect(a).toBe("lale tur tic ltd sti");
    expect(normalizeLegalName("LALE TUR. TİC. LTD. ŞTİ.")).toBe(a);
    expect(normalizeLegalName("Örnek Tur Anonim Şirketi")).toBe("ornek tur as");
    expect(normalizeLegalName("ÖRNEK TUR A.Ş.")).toBe("ornek tur as");
    expect(normalizeLegalName("Örnek Seyahat Acentalığı")).toBe(normalizeLegalName("ornek seyahat acentasi"));
    expect(normalizeLegalName("İSTANBUL IŞIK")).toBe("istanbul isik");
    // "Benziyor" puanı yok: tek harf farkı farklı anahtar → insan karar verir.
    expect(normalizeLegalName("Lale Turizm Ltd. Şti.")).not.toBe(normalizeLegalName("Lala Turizm Ltd. Şti."));
    expect(normalizeLegalName("")).toBe("");
  });
});

describe("vergi numarası", () => {
  it("TC kimlik resmî sağlama kuralı", () => {
    expect(isValidTckn("10000000146")).toBe(true);
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("00000000146")).toBe(false);
    expect(isValidTckn("1000000014")).toBe(false);
  });

  it("şirket yalnız 10 hane; şahıs 11 haneli geçerli TCKN ya da eski 10 haneli VKN; harf / başka karakter reddedilir", () => {
    expect(parseTaxId("company", "123 456-7890")).toEqual({ digits: "1234567890", form: "vkn" });
    expect(parseTaxId("company", "10000000146")).toBeNull();
    expect(parseTaxId("sole_proprietor", "10000000146")).toEqual({ digits: "10000000146", form: "tckn" });
    expect(parseTaxId("sole_proprietor", "10000000147")).toBeNull();
    expect(parseTaxId("sole_proprietor", "1234567890")).toEqual({ digits: "1234567890", form: "vkn" });
    expect(parseTaxId("company", "12345a7890")).toBeNull();
    expect(parseTaxId("company", 1234567890)).toBeNull();
    expect(maskTaxId("46")).toBe("••••••••46");
  });
});

describe("durum makinesi", () => {
  it("geçiş tablosu kapalı: izinli geçişler tam liste, gerisi null", () => {
    const allowed: Record<string, string> = {};
    const actions: LicenseAction[] = ["approve", "reject", "review", "suspend", "reinstate", "withdraw", "expire"];
    for (const s of LICENSE_STATUSES) for (const a of actions) {
      const n = nextStatus(s, a);
      if (n) allowed[`${s}:${a}`] = n;
    }
    expect(allowed).toEqual({
      "pending:approve": "verified",
      "pending:reject": "rejected",
      "pending:review": "under_review",
      "pending:withdraw": "withdrawn",
      "pending:expire": "expired",
      "under_review:approve": "verified",
      "under_review:reject": "rejected",
      "under_review:withdraw": "withdrawn",
      "verified:suspend": "suspended",
      "verified:withdraw": "withdrawn",
      "suspended:reinstate": "verified",
      "suspended:reject": "rejected",
      "suspended:withdraw": "withdrawn",
    });
  });

  it("bekleyen başvuru 14 gün; süresi dolunca okuyan 'expired' görür (tembel)", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    const until = pendingUntilFrom(now);
    // Sayı SABİTİN KENDİSİYLE ölçülmez (mutasyon AC2: sabit 30 yapılınca test de 30'u bekliyordu) — tasarımdaki 14 gün.
    expect(PENDING_TTL_DAYS).toBe(14);
    expect(until.getTime() - now.getTime()).toBe(14 * DAY);
    const row = { status: "pending", pendingUntil: until };
    expect(effectiveStatus(row, new Date(until.getTime() - 1))).toBe("pending");
    expect(effectiveStatus(row, until)).toBe("expired");
    expect(isPendingExpired({ status: "under_review", pendingUntil: until }, new Date(until.getTime() + DAY))).toBe(false);
  });

  it("🚨 kilit yalnız doğrulanmış / askıdaki belgede — bekleyen başvuru KİLİTLEMEZ (rakip önünü tıkayamaz)", () => {
    expect(lockKeyFor("verified", "agency", "12345")).toBe("agency:12345");
    expect(lockKeyFor("suspended", "agency", "12345")).toBe("agency:12345");
    for (const s of ["pending", "under_review", "rejected", "withdrawn", "expired"] as const) expect(lockKeyFor(s, "agency", "12345")).toBeNull();
  });
});

describe("'eşleşti' işareti — hesaplanır, 30 günde kendiliğinden kalkar", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const base: LicenseMarkInput = {
    id: "l1",
    type: "tourism_operation",
    number: "2024-0123",
    status: "verified",
    attributes: {},
    lastRegistryOkAt: new Date(now.getTime() - 3 * DAY),
    lastRegistrySource: "ktb_facility_search",
    propertyIds: ["p1", "p2"],
  };

  it("doğrulanmış + taze okuma → kapsanan dairelere işaret", () => {
    const marks = licenseMarks([base], now);
    expect(marks).toHaveLength(1);
    expect(marks[0].authority).toBe("ministry");
    expect(marks[0].propertyIds).toEqual(["p1", "p2"]);
    expect(marksForProperty(marks, "p1")).toHaveLength(1);
    expect(marksForProperty(marks, "p9")).toHaveLength(0);
  });

  it("işaret üretmeyenler: doğrulanmamış, 30 günden eski okuma, türe uymayan / bilinmeyen kaynak, kapsamsız tesis, gelecek tarih", () => {
    // Tasarımdaki 30 gün YAZIYLA (mutasyon AC16: sabitle ölçülen test 31 güne de uyuyordu).
    expect(MARK_TTL_DAYS).toBe(30);
    const stale = { ...base, lastRegistryOkAt: new Date(now.getTime() - 30 * DAY) };
    const fresh29 = { ...base, lastRegistryOkAt: new Date(now.getTime() - 29 * DAY) };
    expect(licenseMarks([fresh29], now)).toHaveLength(1);
    for (const r of [
      { ...base, status: "suspended" },
      { ...base, status: "pending" },
      stale,
      { ...base, lastRegistryOkAt: null },
      { ...base, lastRegistrySource: "tursab_agency_search" },
      { ...base, lastRegistrySource: "bilinmeyen" },
      { ...base, propertyIds: [] },
      { ...base, lastRegistryOkAt: new Date(now.getTime() + DAY) },
      { ...base, type: "str_permit" },
    ]) {
      expect(licenseMarks([r], now), JSON.stringify(r)).toHaveLength(0);
    }
  });

  it("acenta işareti hak sahibi geneli (daireye bağlı değil) ve grubu taşır; metin kaynağa göre, mutlak iddia yok", () => {
    const agency: LicenseMarkInput = { ...base, id: "l2", type: "agency", attributes: { group: "A" }, lastRegistrySource: "tursab_agency_search", propertyIds: [] };
    const [m] = licenseMarks([agency], now);
    expect(m.propertyIds).toBeNull();
    expect(m.group).toBe("A");
    expect(marksForProperty([m], "p1")).toHaveLength(0);
    expect(markText({ ...m, checkedAt: new Date("2026-11-03T09:00:00Z") })).toBe(
      "Seyahat acentası işletme belgesi (A grubu) TÜRSAB kaydıyla eşleşti · son kontrol 3 Kasım",
    );
    const [t] = licenseMarks([base], now);
    expect(markText({ ...t, checkedAt: new Date("2026-11-03T22:30:00Z") })).toBe(
      "Turizm işletmesi belgesi Bakanlık kaydıyla eşleşti · son kontrol 4 Kasım",
    );
    expect(markText(t)).not.toMatch(/doğrulandı|geçerli|onaylı/i);
  });
});

describe("metinler + sır", () => {
  it("çakışma nedeniyle incelemedeki başvuru ev sahibine farklı GÖRÜNMEZ (sızıntı yok)", () => {
    expect(LICENSE_STATUS_LABEL.under_review).toBe(LICENSE_STATUS_LABEL.pending);
  });

  it("özellik ancak anahtar '1' VE en az 32 karakterlik ayrı sır varken açık; özet sırra bağlı ve belirlenimli", () => {
    const secret = "s".repeat(32);
    expect(licensesEnabled({ BUSINESS_LICENSES_ENABLED: "1", LICENSE_HMAC_SECRET: secret })).toBe(true);
    expect(licensesEnabled({ BUSINESS_LICENSES_ENABLED: "true", LICENSE_HMAC_SECRET: secret })).toBe(false);
    expect(licensesEnabled({ BUSINESS_LICENSES_ENABLED: "1", LICENSE_HMAC_SECRET: "s".repeat(31) })).toBe(false);
    expect(licensesEnabled({ BUSINESS_LICENSES_ENABLED: "1" })).toBe(false);
    // ENCRYPTION_KEY / AUTH_SECRET'e düşmez.
    expect(licenseSecret({ AUTH_SECRET: secret, ENCRYPTION_KEY: secret })).toBeNull();
    expect(taxIdHash(secret, "1234567890")).toBe(taxIdHash(secret, "1234567890"));
    expect(taxIdHash(secret, "1234567890")).not.toBe(taxIdHash("t".repeat(32), "1234567890"));
    expect(taxIdHash(secret, "1234567890")).not.toBe(taxIdHash(secret, "1234567891"));
  });
});
