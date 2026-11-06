import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { __licenseTestHooks, createLicenseApplication, decideLicense, recordOwnershipProof, recordRegistryReading, withdrawLicense } from "@/lib/licenses/write";
import { listOrgLicenses, orgLicenseMarks, operatorLicenseQueue, propertyLicenseMarkTexts } from "@/lib/licenses/read";
import { buildOrganizationDataExport } from "@/lib/data-export";

// ---------------------------------------------------------------------------
// İŞLETME BELGESİ Faz 1a — Opus 11-06 derin incelemesi düzeltmeleri (kanıtın kendisi doğrulanır, yarışlar kapalı):
// P1-2 vergi numarası operatörce YAZILIR ve özetle karşılaştırılır · P1-3 tesis belgesinde daire teyidi · P2-4 / P2-7 satır kilitleri ·
// P2-5 başka numaranın iptali askıya almaz · P2-6 grup daralma / genişleme · P2-8 eşleşme kayıttaki numarayla · P3-11 askıdan dönüş
// yalnız askıdan SONRAKİ okumayla · P3-12 uyuşmayan geçerli okuma işareti kaldırır · P3-15 paket düşünce işaret görünmez · P3-18 günde
// 10 başvuru · P3-19 kuyrukta eşleşmenin bugünkü değeri. Kurgusal fikstür ("Lale", "Örnek"); TC kimlik örneği yaygın bilinen sahte numara.
// ---------------------------------------------------------------------------

const SECRET = "test-license-secret-0123456789abcdef";
const OP = "operator-user";
const DAY = 24 * 60 * 60 * 1000;
const TCKN = "10000000146";

async function seedOrg(name = "Lale") {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} 1`, address: "Çiçek Sk. 1", city: "Muğla" } });
  return { orgId: org.id, propertyId: property.id, userId: `u-${org.id}` };
}

const agencyApp = (o: { orgId: string; userId: string }, over: Partial<Parameters<typeof createLicenseApplication>[0]> = {}) =>
  createLicenseApplication({
    organizationId: o.orgId,
    userId: o.userId,
    type: "agency",
    number: "12.345",
    attributes: { group: "A" },
    holder: { kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", taxId: "1234567890" },
    propertyIds: [],
    ...over,
  });

const reading = (over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
  source: "ktb_agency_search",
  query: "12345",
  outcome: "valid",
  fields: { number: "12345", legalName: "LALE TUR. TİC. LTD. ŞTİ.", group: "A", ...fields },
  ...over,
});
const proof = (taxId = "1234567890") => ({ method: "esign_declaration", evidenceRef: "TSG 2025/123 s.4 — yetkili e-imzası", taxId });

async function verify(licenseId: string, readingOver: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) {
  expect((await recordRegistryReading({ licenseId, operatorUserId: OP, reading: reading(readingOver, fields) })).ok).toBe(true);
  expect(await recordOwnershipProof({ licenseId, operatorUserId: OP, proof: proof() })).toEqual({ ok: true, taxIdMatched: true });
  expect(await decideLicense({ licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: true, status: "verified" });
}

const lic = (id: string) => prisma.businessLicense.findUniqueOrThrow({ where: { id }, include: { holder: true, units: true } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** İki işlemi, ikisi de yazıp KAPANMADAN önce buluşturur (kilit varsa ikinci kilitte bekler, birincisi süre dolunca kapanır). */
function rendezvous(timeoutMs = 800) {
  let arrived = 0;
  let release!: () => void;
  const both = new Promise<void>((r) => (release = r));
  __licenseTestHooks.beforeCommit = async () => {
    arrived += 1;
    if (arrived >= 2) release();
    await Promise.race([both, sleep(timeoutMs)]);
  };
}

describe("işletme belgesi — kanıtın kendisi doğrulanır (Opus 11-06)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("LICENSE_HMAC_SECRET", SECRET);
  });
  afterEach(() => {
    __licenseTestHooks.beforeCommit = undefined;
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 P1-2 vergi numarası: kutu işaretlemek yetmez — operatör belgeden YAZAR, kod özetle karşılaştırır, numara HİÇBİR olayda yok", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    // Eski biçim (yalnız kutu) reddedilir.
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: { method: "esign_declaration", evidenceRef: "TSG 2025/123 s.4", taxIdConfirmed: true } })).toEqual({
      ok: false,
      reason: "invalid",
      field: "tax",
    });
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof("1234567899") })).toEqual({ ok: true, taxIdMatched: false });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "not_ready", missing: ["tax_unconfirmed"] });
    // Ayraçlı yazım aynı numaradır.
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof("123 456-7890") })).toEqual({ ok: true, taxIdMatched: true });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: true, status: "verified" });
    const events = await prisma.licenseEvent.findMany({ where: { licenseId: r.licenseId } });
    expect(JSON.stringify(events)).not.toMatch(/1234567890|1234567899/);
  });

  it("🚨 P1-2 şahıs işletmesi YALNIZ TC kimlik numarasıyla (eski 10 haneli numarayla ikinci kimlik açılamaz); kanıtta da", async () => {
    const o = await seedOrg("Şahıs");
    const base = {
      organizationId: o.orgId,
      userId: o.userId,
      type: "simple_accommodation",
      number: "48-2026-0001",
      attributes: {},
      propertyIds: [o.propertyId],
    } as const;
    expect(await createLicenseApplication({ ...base, holder: { kind: "sole_proprietor", legalName: "Ayşe Örnek", taxId: "1234567890" } })).toEqual({ ok: false, reason: "invalid_tax_id" });
    const s = await createLicenseApplication({ ...base, holder: { kind: "sole_proprietor", legalName: "Ayşe Örnek", taxId: TCKN } });
    if (!s.ok) throw new Error(s.reason);
    expect(await recordOwnershipProof({ licenseId: s.licenseId, operatorUserId: OP, proof: proof("1234567890") })).toEqual({ ok: false, reason: "invalid", field: "tax" });
    expect(await recordOwnershipProof({ licenseId: s.licenseId, operatorUserId: OP, proof: proof(TCKN) })).toEqual({ ok: true, taxIdMatched: true });
    expect(JSON.stringify(await prisma.licenseEvent.findMany({ where: { licenseId: s.licenseId } }))).not.toContain(TCKN);
  });

  it("🚨 P1-3 tesis belgesi: onay kayıttaki tesisle eşleştirilen dairelerle; teyitsiz daire belgeden çıkar ve işaret almaz; unvansız kayıt gerekçe ister", async () => {
    const o = await seedOrg();
    const p2 = await prisma.property.create({ data: { organizationId: o.orgId, name: "Lale 2", address: "Örnek Sk. 5", city: "Muğla" } });
    const other = await seedOrg("Başka");
    const r = await createLicenseApplication({
      organizationId: o.orgId,
      userId: o.userId,
      type: "tourism_operation",
      number: "2024-0123",
      attributes: { facilityType: "Apart otel" },
      holder: { kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", taxId: "1234567890" },
      propertyIds: [o.propertyId, p2.id],
    });
    if (!r.ok) throw new Error(r.reason);
    const facility = {
      source: "ktb_facility_search",
      query: "2024-0123",
      outcome: "valid",
      fields: { number: "2024/0123", facilityName: "Lale Apart", address: "Örnek Sk. 5", city: "Muğla", facilityType: "Apart otel", starClass: "3" },
    };
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: facility })).toMatchObject({ ok: true, match: { number: true, legalName: false } });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "not_ready", missing: ["name_mismatch", "units_unconfirmed"] });
    const why = "Kayıtta işletmeci unvanı görünmüyor; belgede işletmeci aynı şirket (e-imzalı beyan)";
    // Başvuruda olmayan daire (başka işletmeninki bile) teyit edilemez.
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: why, confirmedUnitIds: [other.propertyId] })).toEqual({ ok: false, reason: "invalid" });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: why, confirmedUnitIds: [] })).toMatchObject({ reason: "not_ready", missing: ["units_unconfirmed"] });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: why, confirmedUnitIds: [p2.id] })).toEqual({ ok: true, status: "verified" });
    const l = await lic(r.licenseId);
    expect(l.units.map((u) => u.propertyId)).toEqual([p2.id]);
    expect(l.registryNameNorm).toBeNull();
    expect(l.attributes).toEqual({ facilityType: "Apart otel", starClass: "3" });
    const ev = await prisma.licenseEvent.findFirstOrThrow({ where: { licenseId: r.licenseId, reason: "approve" } });
    expect(ev.evidence).toMatchObject({ units: { confirmed: [p2.id], removed: [o.propertyId] } });
    // Teyit anındaki ad / adres olayda (Opus 11-06 ikinci tur P3-8 — daire sonradan değişirse karşılaştırılabilsin).
    expect((ev.evidence as { units: { confirmedSnapshot: unknown } }).units.confirmedSnapshot).toEqual([{ id: p2.id, name: "Lale 2", address: "Örnek Sk. 5", city: "Muğla" }]);
    expect(await propertyLicenseMarkTexts(o.orgId, p2.id)).toHaveLength(1);
    expect(await propertyLicenseMarkTexts(o.orgId, o.propertyId)).toHaveLength(0);
    // Aynı (unvansız) kayıt yeniden okununca işaret tazelenir.
    await prisma.businessLicense.update({ where: { id: r.licenseId }, data: { lastRegistryOkAt: new Date(Date.now() - 29 * DAY) } });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: facility })).toMatchObject({ ok: true, renewed: true });
  });

  it("acenta belgesinde daire teyidi gönderilemez; tesis kaydında tesis adı ve kayıttaki numara zorunlu", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", confirmedUnitIds: [o.propertyId] })).toEqual({ ok: false, reason: "invalid" });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { number: undefined }) })).toEqual({ ok: false, reason: "invalid", field: "number" });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { facilityName: "Lale Apart" }) })).toEqual({ ok: false, reason: "invalid", field: "fields" });
  });

  it("🚨 P2-8 eşleşme kayıtta GÖRÜNEN numarayla: sorgu alanı belge numarasıyla dolu olsa da kayıttaki numara farklıysa eşleşmez", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({ query: "12345" }, { number: "12346" }) })).toMatchObject({
      ok: true,
      match: { number: false, legalName: true },
    });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "not_ready", missing: ["number_mismatch"] });
    // Unvanla aranmış kayıt (sorgu numara değil) — kayıttaki numara tutuyorsa eşleşir.
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({ query: "12.345" }, { number: "12 345" }) })).toMatchObject({ match: { number: true } });
  });

  it("🚨 P2-5 doğrulanmış belge: kayıtta BAŞKA numaranın iptali askıya almaz (yalnız işareti kaldırır); bu numaranın iptali askıya alır", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    const wrong = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({ outcome: "cancelled" }, { number: "54321", legalName: "Başka Tur Ltd. Şti.", group: undefined, statusText: "İptal" }) });
    // Opus 11-06 ikinci tur P3-5: numara kopyalanırken yazım hatası iptal edilmiş belgeyi 30 gün işaretli bırakmasın.
    expect(wrong).toMatchObject({ ok: true, autoSuspended: false, renewed: false, markCleared: true });
    expect((await lic(r.licenseId)).status).toBe("verified");
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(0);
    const right = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({ outcome: "cancelled" }, { group: undefined, statusText: "İptal" }) });
    expect(right).toMatchObject({ ok: true, autoSuspended: true });
    expect((await lic(r.licenseId)).status).toBe("suspended");
  });

  it("🚨 P2-6 grup: A'dan C'ye daralma hemen uygulanır (işaret dar grubu söyler); C'den A'ya genişleme işareti kaldırır, operatör askı + dönüşle kabul eder", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    expect((await lic(r.licenseId)).attributes).toEqual({ group: "A" });
    const narrowed = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { group: "C" }) });
    expect(narrowed).toMatchObject({ ok: true, renewed: true, markCleared: false });
    expect((await lic(r.licenseId)).attributes).toEqual({ group: "C" });
    const [row] = await listOrgLicenses(o.orgId);
    expect(row.mark?.text).toMatch(/\(C grubu\)/);
    expect(await prisma.licenseEvent.count({ where: { licenseId: r.licenseId, evidence: { path: ["groupNarrowed"], equals: true } } })).toBe(1);

    const widened = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { group: "A" }) });
    expect(widened).toMatchObject({ ok: true, renewed: false, markCleared: true });
    const l = await lic(r.licenseId);
    expect(l).toMatchObject({ status: "verified", lastRegistryOkAt: null, attributes: { group: "C" } });
    const [stale] = await listOrgLicenses(o.orgId);
    expect(stale).toMatchObject({ mark: null, statusLabel: "Yeniden kontrol bekleniyor" });
    // Operatörün açık kararı: askı → taze okuma → dönüş; nitelik kayıttan.
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "suspend", reason: "operator" })).toEqual({ ok: true, status: "suspended" });
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { group: "A" }) });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toEqual({ ok: true, status: "verified" });
    expect((await lic(r.licenseId)).attributes).toEqual({ group: "A" });
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(1);
  });

  it("🚨 P3-11 askıdan dönüş YALNIZ askıdan sonraki okumayla (askıdan önceki taze okuma yetmez)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "suspend", reason: "mismatch" })).toEqual({ ok: true, status: "suspended" });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toEqual({ ok: false, reason: "not_ready", missing: ["reading"] });
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toEqual({ ok: true, status: "verified" });
  });

  it("🚨 P3-12 + gerekçeli onay: kayıttaki ESKİ unvan tazelenir; kayıt sahibin unvanına dönerse de; üçüncü bir unvan ya da başka numara işareti kaldırır", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    const old = { legalName: "Eski Unvan Turizm Ltd. Şti." };
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, old) });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: "TSG unvan değişikliği ilanı; kayıt henüz eski unvanda" })).toEqual({ ok: true, status: "verified" });
    expect((await lic(r.licenseId)).registryNameNorm).toBe("eski unvan tur ltd sti");
    const age = () => prisma.businessLicense.update({ where: { id: r.licenseId }, data: { lastRegistryOkAt: new Date(Date.now() - 20 * DAY) } });

    await age();
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, old) })).toMatchObject({ renewed: true });
    await age();
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() })).toMatchObject({ renewed: true });
    expect((await lic(r.licenseId)).registryNameNorm).toBe("lale tur tic ltd sti");

    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { legalName: "Bambaşka Turizm A.Ş." }) })).toMatchObject({ renewed: false, markCleared: true });
    expect((await lic(r.licenseId)).lastRegistryOkAt).toBeNull();
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(0);
    expect(await prisma.licenseEvent.count({ where: { licenseId: r.licenseId, evidence: { path: ["markCleared"], equals: "name" } } })).toBe(1);

    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() })).toMatchObject({ renewed: true });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({}, { number: "99999" }) })).toMatchObject({ markCleared: true });
    expect(await prisma.licenseEvent.count({ where: { licenseId: r.licenseId, evidence: { path: ["markCleared"], equals: "number" } } })).toBe(1);
    expect((await lic(r.licenseId)).status).toBe("verified");
  });

  it("🚨 P2-4 eşzamanlı: bir belge geri çekilirken aynı şirketin öbür belgesi onaylanınca şirket bekçisi BOŞALMAZ (hak sahibi satır kilidi)", async () => {
    const o = await seedOrg();
    const r1 = await agencyApp(o);
    const r2 = await agencyApp(o, { number: "54321" });
    if (!r1.ok || !r2.ok) throw new Error("başvuru");
    await verify(r1.licenseId);
    await recordRegistryReading({ licenseId: r2.licenseId, operatorUserId: OP, reading: reading({ query: "54321" }, { number: "54321" }) });
    await recordOwnershipProof({ licenseId: r2.licenseId, operatorUserId: OP, proof: proof() });
    rendezvous();
    const [w, d] = await Promise.all([
      withdrawLicense({ organizationId: o.orgId, userId: o.userId, licenseId: r1.licenseId }),
      decideLicense({ licenseId: r2.licenseId, operatorUserId: OP, action: "approve" }),
    ]);
    expect(w).toEqual({ ok: true, from: "verified" });
    expect(d).toEqual({ ok: true, status: "verified" });
    const holder = await prisma.licenseHolder.findFirstOrThrow({ where: { organizationId: o.orgId } });
    expect(holder.verifiedGuard).toBe(holder.taxIdHash);
  });

  it("🚨 P2-4 eşzamanlı: onay sürerken aynı vergi numarasıyla gelen farklı unvanlı başvuru, doğrulanan hak sahibinin unvanını DEĞİŞTİREMEZ", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    rendezvous();
    const [d, a] = await Promise.all([
      decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" }),
      (async () => {
        await sleep(100);
        return agencyApp(o, { number: "999", holder: { kind: "company", legalName: "Bambaşka Turizm A.Ş.", taxId: "1234567890" } });
      })(),
    ]);
    expect(d).toEqual({ ok: true, status: "verified" });
    expect(a.ok).toBe(true);
    const holder = await prisma.licenseHolder.findFirstOrThrow({ where: { organizationId: o.orgId } });
    expect(holder).toMatchObject({ legalName: "Lale Turizm Ticaret Limited Şirketi", verifiedGuard: holder.taxIdHash });
  });

  it("🚨 P2-7 eşzamanlı: onay ile aynı anda yazılan 'kayıtta iptal' okuması — doğrulanmış belge iptal okumasıyla askısız KALAMAZ (belge satır kilidi)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    rendezvous();
    const [, decision] = await Promise.all([
      recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading({ outcome: "cancelled" }, { group: undefined, statusText: "İptal" }) }),
      decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" }),
    ]);
    const l = await lic(r.licenseId);
    // Ya okuma önce: onay "geçerli okuma yok" der; ya onay önce: iptal okuması doğrulanmış belgeyi askıya alır. Doğrulanmış + son okuma iptal OLMAZ.
    if (decision.ok) expect(l.status).toBe("suspended");
    else {
      expect(decision).toEqual({ ok: false, reason: "not_ready", missing: ["reading_not_valid"] });
      expect(l.status).toBe("pending");
    }
  });

  it("🚨 P3-2 ev sahibinin yazdığı alanlarda TC kimlik numarası saklanmaz: belge numarası yerine kendi numarası, unvanda ya da nitelikte numara", async () => {
    const o = await seedOrg("Şahıs");
    const base = {
      organizationId: o.orgId,
      userId: o.userId,
      type: "simple_accommodation",
      number: "48-2026-0001",
      attributes: {},
      holder: { kind: "sole_proprietor", legalName: "Ayşe Örnek", taxId: TCKN },
      propertyIds: [o.propertyId],
    } as const;
    expect(await createLicenseApplication({ ...base, number: TCKN })).toEqual({ ok: false, reason: "invalid_number" });
    expect(await createLicenseApplication({ ...base, number: "100-000-001-46" })).toEqual({ ok: false, reason: "invalid_number" });
    expect(await createLicenseApplication({ ...base, holder: { ...base.holder, legalName: `Ayşe Örnek ${TCKN}` } })).toEqual({ ok: false, reason: "invalid_name" });
    expect(await createLicenseApplication({ ...base, type: "tourism_operation", attributes: { facilityType: `Apart ${TCKN}` } })).toEqual({ ok: false, reason: "invalid_attributes" });
    expect(await prisma.businessLicense.count()).toBe(0);
    // KONTROL: düzgün başvuru geçer.
    expect((await createLicenseApplication(base)).ok).toBe(true);
  });

  it("🚨 P3-9 incelemedeki (çakışmalı) başvuru da 14 günde dolar — ev sahibi bekleyenle AYNI şeyi görür, süpürülür, karar verilmez", async () => {
    const a = await seedOrg("Lale");
    const b = await seedOrg("Başka");
    const ra = await agencyApp(a);
    const rb = await agencyApp(b, { holder: { kind: "company", legalName: "Rakip Tur A.Ş.", taxId: "9999999999" } });
    if (!ra.ok || !rb.ok) throw new Error("başvuru");
    await verify(ra.licenseId);
    await recordRegistryReading({ licenseId: rb.licenseId, operatorUserId: OP, reading: reading({}, { legalName: "Rakip Tur A.Ş." }) });
    await recordOwnershipProof({ licenseId: rb.licenseId, operatorUserId: OP, proof: proof("9999999999") });
    expect(await decideLicense({ licenseId: rb.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "lock_conflict" });
    // Kıyas için B'nin bir de sıradan bekleyen başvurusu.
    const plain = await agencyApp(b, { number: "777", holder: { kind: "company", legalName: "Rakip Tur A.Ş.", taxId: "9999999999" } });
    if (!plain.ok) throw new Error(plain.reason);
    const past = new Date(Date.now() - 1000);
    await prisma.businessLicense.updateMany({ where: { organizationId: b.orgId }, data: { pendingUntil: past } });
    const rows = await listOrgLicenses(b.orgId);
    const view = (id: string) => {
      const x = rows.find((row) => row.id === id)!;
      return { status: x.status, statusLabel: x.statusLabel, statusText: x.statusText };
    };
    expect(view(rb.licenseId)).toEqual({ status: "expired", statusLabel: "Süresi doldu", statusText: expect.any(String) });
    expect(view(rb.licenseId)).toEqual(view(plain.licenseId));
    // Hesap dökümü de aynı şeyi söyler (süpürülmemiş olsa da "expired").
    expect((await buildOrganizationDataExport(b.orgId))?.businessLicenses.licenses.map((l) => l.status)).toEqual(["expired", "expired"]);
    expect(await decideLicense({ licenseId: rb.licenseId, operatorUserId: OP, action: "reject", reason: "mismatch" })).toEqual({ ok: false, reason: "not_open" });
    expect((await operatorLicenseQueue()).open.map((x) => x.id)).not.toContain(rb.licenseId);
    // İlk yazma süpürür: geri çekme kalıcı olarak "expired"e çeker.
    expect(await withdrawLicense({ organizationId: b.orgId, userId: b.userId, licenseId: rb.licenseId })).toEqual({ ok: false, reason: "not_open" });
    expect(await lic(rb.licenseId)).toMatchObject({ status: "expired", lockKey: null });
    expect(await prisma.licenseEvent.count({ where: { licenseId: rb.licenseId, reason: "expire", fromStatus: "under_review" } })).toBe(1);
  });

  it("P3-12 doğrulanmış hak sahibinin unvanı başvuruyla değişmez; yazılan unvan kaybolmaz — operatör kuyrukta görür", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    const r2 = await agencyApp(o, { number: "999", holder: { kind: "company", legalName: "Lale Turizm Yeni Unvan A.Ş.", taxId: "1234567890" } });
    if (!r2.ok) throw new Error(r2.reason);
    const holder = await prisma.licenseHolder.findFirstOrThrow({ where: { organizationId: o.orgId } });
    expect(holder.legalName).toBe("Lale Turizm Ticaret Limited Şirketi");
    const row = (await operatorLicenseQueue()).open.find((x) => x.id === r2.licenseId)!;
    expect(row.typedLegalName).toBe("Lale Turizm Yeni Unvan A.Ş.");
    expect(row.pendingUntil).not.toBeNull();
    // Son günü boş bekleyen satır kuyruktan düşmez (incelemedekiyle aynı kural — Haiku 11-06).
    await prisma.businessLicense.update({ where: { id: r2.licenseId }, data: { pendingUntil: null } });
    expect((await operatorLicenseQueue()).open.find((x) => x.id === r2.licenseId)).toMatchObject({ status: "pending", pendingUntil: null });
  });

  it("P3-7 askıdaki belgede kuyruk, okumanın askıdan sonra olup olmadığını söyler (onay yolunun kuralıyla aynı)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "suspend", reason: "operator" });
    const before = (await operatorLicenseQueue()).open.find((x) => x.id === r.licenseId)!;
    expect(before.lastReading).toMatchObject({ afterSuspend: false });
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    const after = (await operatorLicenseQueue()).open.find((x) => x.id === r.licenseId)!;
    expect(after.lastReading).toMatchObject({ afterSuspend: true, current: { number: true, legalName: true } });
    // Bekleyen başvuruda alan yok (null).
    const p = await agencyApp(o, { number: "888" });
    if (!p.ok) throw new Error(p.reason);
    await recordRegistryReading({ licenseId: p.licenseId, operatorUserId: OP, reading: reading({ query: "888" }, { number: "888" }) });
    expect((await operatorLicenseQueue()).open.find((x) => x.id === p.licenseId)?.lastReading?.afterSuspend).toBeNull();
  });

  it("P3-15 paket düşünce 'eşleşti' işareti görünmez (belge ve durumu listede kalır); Pro'da yeniden görünür", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await verify(r.licenseId);
    vi.stubEnv("BILLING_ENFORCED", "1");
    await prisma.subscription.create({ data: { organizationId: o.orgId, planCode: "free", status: "active", provider: "manual" } });
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(0);
    const [row] = await listOrgLicenses(o.orgId);
    expect(row).toMatchObject({ status: "verified", statusLabel: "Eşleşti", mark: null });
    await prisma.subscription.update({ where: { organizationId: o.orgId }, data: { planCode: "pro" } });
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(1);
  });

  it("P3-18 geri çek + yeniden başvur döngüsü: işletme başına son 24 saatte en çok 10 başvuru", async () => {
    const o = await seedOrg();
    for (let i = 0; i < 10; i++) {
      const r = await agencyApp(o, { number: `70${i}` });
      if (!r.ok) throw new Error(r.reason);
      expect(await withdrawLicense({ organizationId: o.orgId, userId: o.userId, licenseId: r.licenseId })).toEqual({ ok: true, from: "pending" });
    }
    expect(await agencyApp(o, { number: "799" })).toEqual({ ok: false, reason: "too_many_recent" });
    await prisma.businessLicense.updateMany({ where: { organizationId: o.orgId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect((await agencyApp(o, { number: "799" })).ok).toBe(true);
  });

  it("P3-19 operatör kuyruğu eşleşmenin BUGÜNKÜ değerini gösterir (okumadan sonra unvan değiştiyse 'eşleşiyor' demez); daireler adresiyle", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: reading() });
    expect((await agencyApp(o, { number: "999", holder: { kind: "company", legalName: "Bambaşka Turizm A.Ş.", taxId: "1234567890" } })).ok).toBe(true);
    const q = await operatorLicenseQueue();
    const row = q.open.find((x) => x.id === r.licenseId)!;
    expect(row.lastReading?.value.match.legalName).toBe(true);
    expect(row.lastReading?.current).toEqual({ number: true, legalName: false });
    // Kanıttan sonra çok sayıda okuma olsa da kuyruk kanıtı gösterir (Haiku 11-06: ortak olay penceresi kanıtı düşürüyordu).
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: proof() });
    for (let i = 0; i < 21; i++) await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: { source: "ktb_agency_search", query: "12345", outcome: "unreadable" } });
    const qp = (await operatorLicenseQueue()).open.find((x) => x.id === r.licenseId)!;
    expect(qp.lastProof?.value).toMatchObject({ method: "esign_declaration", taxIdMatched: true });

    const t = await createLicenseApplication({
      organizationId: o.orgId,
      userId: o.userId,
      type: "simple_accommodation",
      number: "48-0001",
      attributes: {},
      holder: { kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", taxId: "1234567890" },
      propertyIds: [o.propertyId],
    });
    if (!t.ok) throw new Error(t.reason);
    const q2 = await operatorLicenseQueue();
    expect(q2.open.find((x) => x.id === t.licenseId)?.units).toEqual([{ id: o.propertyId, name: "Lale 1", address: "Çiçek Sk. 1", city: "Muğla" }]);
  });
});
