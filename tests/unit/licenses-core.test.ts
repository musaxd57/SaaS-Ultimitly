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
import { licenseSecret, licensesEnabled, sameTaxIdHash, taxIdHash } from "@/lib/licenses/secret";
import { MAX_APPLICATIONS_PER_DAY } from "@/lib/licenses/state";
import {
  approvalReadiness,
  containsTcknLike,
  groupChange,
  parseProof,
  parseReading,
  reinstateReadiness,
  verifiedReadingVerdict,
  type ReadingEvidence,
} from "@/lib/licenses/evidence";

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
    // Şahıs işletmesinde YALNIZ TC kimlik numarası (Opus 11-06 P1-2): eski 10 haneli numara ikinci bir kimlik açamaz.
    expect(parseTaxId("sole_proprietor", "1234567890")).toBeNull();
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

describe("kanıt (Opus 11-06)", () => {
  const agency = { type: "agency" as const, numberNorm: "12345", holderNameNorm: normalizeLegalName("Lale Turizm Ltd. Şti.") };
  const facility = { type: "tourism_operation" as const, numberNorm: "20240123", holderNameNorm: agency.holderNameNorm };
  const ok = (r: ReturnType<typeof parseReading>): ReadingEvidence => {
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const read = (fields: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    parseReading(agency, { source: "ktb_agency_search", query: "12345", outcome: "valid", fields: { number: "12345", legalName: "LALE TUR. LTD. ŞTİ.", group: "A", ...fields }, ...over });

  it("P2-8 numara eşleşmesi kayıtta GÖRÜNEN numarayla (sorgu değeri değil); kayıt bulunduysa numara zorunlu", () => {
    expect(ok(read({ number: "12346" })).match).toEqual({ number: false, legalName: true });
    expect(ok(read({ number: "12.345" }, { query: "Lale" })).match.number).toBe(true);
    expect(read({ number: undefined })).toEqual({ ok: false, error: "number" });
    expect(read({ number: "12;345" })).toEqual({ ok: false, error: "number" });
    // Bulunamadı / okunamadı: alan yok, eşleşme yok.
    expect(ok(parseReading(agency, { source: "ktb_agency_search", query: "12345", outcome: "not_found" })).match).toEqual({ number: false, legalName: false });
    expect(parseReading(agency, { source: "ktb_agency_search", query: "12345", outcome: "not_found", fields: { number: "12345" } })).toEqual({ ok: false, error: "fields" });
  });

  it("türe göre alanlar: acentada unvan + grup, tesiste tesis adı zorunlu (unvan isteğe bağlı); öbür türün alanı reddedilir", () => {
    expect(read({ facilityName: "Lale Apart" })).toEqual({ ok: false, error: "fields" });
    expect(read({ group: "D" })).toEqual({ ok: false, error: "group" });
    expect(read({ legalName: undefined })).toEqual({ ok: false, error: "fields" });
    const fac = (fields: Record<string, unknown>) => parseReading(facility, { source: "ktb_facility_search", query: "2024-0123", outcome: "valid", fields: { number: "2024-0123", ...fields } });
    expect(fac({})).toEqual({ ok: false, error: "fields" });
    expect(ok(fac({ facilityName: "Lale Apart", address: "Örnek Sk. 5", district: "Fethiye", city: "Muğla" })).match).toEqual({ number: true, legalName: false });
    expect(fac({ facilityName: "Lale Apart", group: "A" })).toEqual({ ok: false, error: "group" });
  });

  it("🚨 P3-17 TC kimlik numarası ayraçlı / görünmez karakterli / tam genişlikli yazımda da yakalanır; 10 haneli VKN ve tarihler serbest", () => {
    for (const t of ["10000000146", "100 000 001 46", "100.000.001.46", "1000-0000-146", "1\u200b0000000146", "１０００００００１４６"]) {
      expect(containsTcknLike(`kimlik ${t} yazıldı`), t).toBe(true);
    }
    for (const t of ["VKN 1234567890", "TSG 2025/123 s.4", "12.03.2025 10:30", "0532 123 45 67", "+90 532 123 45 67"]) expect(containsTcknLike(t), t).toBe(false);
    expect(read({ legalName: "Lale 100 000 001 46 Ltd." })).toEqual({ ok: false, error: "fields" });
    expect(read({}, { query: "10000000146" })).toEqual({ ok: false, error: "query" });
    // Belgenin kendi numarası TCKN'ye benzese de sorgu olarak kabul edilir.
    expect(parseReading({ ...agency, numberNorm: "34202400001" }, { source: "ktb_agency_search", query: "34202400001", outcome: "valid", fields: { number: "34202400001", legalName: "Lale Tur Ltd. Şti.", group: "A" } }).ok).toBe(true);
  });

  it("P3-17 süre: uzun boşluk / rakam dizilerinde doğrusal", () => {
    const t0 = performance.now();
    containsTcknLike("1" + " ".repeat(50_000) + "x");
    containsTcknLike("1 ".repeat(25_000));
    containsTcknLike("9".repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("🚨 P1-2 kanıtta vergi numarası YAZILIR: şirkette 10 hane, şahısta yalnız geçerli TC kimlik; kutu biçimi geçmez; eski kayıt biçimi onay açmaz", () => {
    const base = { method: "esign_declaration", evidenceRef: "TSG 2025/123 s.4" };
    expect(parseProof({ ...base, taxIdConfirmed: true }, "company")).toEqual({ ok: false, error: "tax" });
    expect(parseProof({ ...base, taxId: "123 456 7890" }, "company")).toEqual({ ok: true, value: { method: "esign_declaration", evidenceRef: "TSG 2025/123 s.4", taxDigits: "1234567890" } });
    expect(parseProof({ ...base, taxId: "1234567890" }, "sole_proprietor")).toEqual({ ok: false, error: "tax" });
    expect(parseProof({ ...base, taxId: "10000000146" }, "sole_proprietor")).toMatchObject({ ok: true });
    const r = { at: new Date("2026-11-06T09:00:00Z"), value: ok(read({})) };
    const now = new Date("2026-11-06T10:00:00Z");
    const legacy = { at: now, value: { method: "esign_declaration", evidenceRef: "x", taxIdConfirmed: true } as never };
    expect(approvalReadiness({ lastReading: r, lastProof: legacy, now })).toEqual({ ok: false, missing: ["tax_unconfirmed"] });
    expect(approvalReadiness({ lastReading: r, lastProof: { at: now, value: { method: "esign_declaration", evidenceRef: "x", taxIdMatched: true } }, now })).toEqual({ ok: true });
    expect(approvalReadiness({ lastReading: r, lastProof: { at: now, value: { method: "esign_declaration", evidenceRef: "x", taxIdMatched: true } }, now, unitsConfirmed: false })).toEqual({
      ok: false,
      missing: ["units_unconfirmed"],
    });
    const secret = "s".repeat(32);
    expect(sameTaxIdHash(taxIdHash(secret, "1234567890"), taxIdHash(secret, "1234567890"))).toBe(true);
    expect(sameTaxIdHash(taxIdHash(secret, "1234567890"), taxIdHash(secret, "1234567891"))).toBe(false);
    expect(sameTaxIdHash("", "")).toBe(false);
  });

  it("P2-5 / P2-6 / P3-12 doğrulanmış belgeye okuma: başka numaranın iptali hiçbir şey; bu numaranın iptali askı; grup daralma / genişleme; uyuşmazlık işareti kaldırır", () => {
    const v = (fields: Record<string, unknown>, over: Record<string, unknown> = {}, attrs: unknown = { group: "A" }, accepted: string | null = agency.holderNameNorm) =>
      verifiedReadingVerdict({ type: "agency", attributes: attrs, acceptedNameNorm: accepted, holderNameNorm: agency.holderNameNorm, reading: ok(read(fields, over)) });
    expect(v({ number: "54321", group: undefined }, { outcome: "cancelled" })).toEqual({ kind: "none" });
    expect(v({ group: undefined }, { outcome: "cancelled" })).toEqual({ kind: "suspend" });
    expect(v({})).toEqual({ kind: "renew", attributes: { group: "A" }, registryNameNorm: agency.holderNameNorm, groupNarrowed: false });
    expect(v({ group: "C" })).toMatchObject({ kind: "renew", attributes: { group: "C" }, groupNarrowed: true });
    expect(v({ group: "A" }, {}, { group: "C" })).toEqual({ kind: "clear", why: "group" });
    expect(v({ group: "C" }, {}, { group: "B" })).toEqual({ kind: "clear", why: "group" });
    expect(v({ number: "99999" })).toEqual({ kind: "clear", why: "number" });
    expect(v({ legalName: "Bambaşka Tur A.Ş." })).toEqual({ kind: "clear", why: "name" });
    // Gerekçeyle onaylanmış eski kayıt unvanı tazelenir; kayıt sahibin unvanına dönerse kabul edilen unvan güncellenir.
    expect(v({ legalName: "Eski Unvan Tur Ltd. Şti." }, {}, { group: "A" }, "eski unvan tur ltd sti")).toMatchObject({ kind: "renew", registryNameNorm: "eski unvan tur ltd sti" });
    expect(v({}, {}, { group: "A" }, "eski unvan tur ltd sti")).toMatchObject({ kind: "renew", registryNameNorm: agency.holderNameNorm });
    expect(groupChange("A", "B")).toBe("narrowed");
    expect(groupChange("B", "A")).toBe("changed");
    expect(groupChange("B", "B")).toBe("same");
    expect(groupChange(undefined, "A")).toBe("changed");
  });

  it("P3-11 askıdan dönüş: askıdan sonraki okuma şart, 7 günden eski olamaz, numara + unvan tutmalı", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    const at = (d: number) => new Date(now.getTime() - d * DAY);
    const good = ok(read({}));
    expect(reinstateReadiness(null, now, agency.holderNameNorm, agency.holderNameNorm)).toBe(false);
    expect(reinstateReadiness({ at: at(1), value: good }, now, agency.holderNameNorm, agency.holderNameNorm)).toBe(true);
    expect(reinstateReadiness({ at: at(8), value: good }, now, agency.holderNameNorm, agency.holderNameNorm)).toBe(false);
    expect(reinstateReadiness({ at: at(1), value: ok(read({ number: "99999" })) }, now, agency.holderNameNorm, agency.holderNameNorm)).toBe(false);
    expect(reinstateReadiness({ at: at(1), value: ok(read({ legalName: "Başka Tur A.Ş." })) }, now, agency.holderNameNorm, agency.holderNameNorm)).toBe(false);
  });

  it("P3-18 günlük başvuru sınırı tasarımdaki 10 (sabitin kendisiyle ölçülmez)", () => {
    expect(MAX_APPLICATIONS_PER_DAY).toBe(10);
  });
});
