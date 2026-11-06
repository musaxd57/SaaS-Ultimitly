import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { __licenseTestHooks, createLicenseApplication, decideLicense, recordOwnershipProof, recordRegistryReading, withdrawLicense } from "@/lib/licenses/write";
import { listOrgLicenses, orgLicenseMarks, operatorLicenseQueue } from "@/lib/licenses/read";
import { buildOrganizationDataExport } from "@/lib/data-export";

// ---------------------------------------------------------------------------
// İŞLETME BELGESİ Faz 1a — tek yazıcı (tasarım docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md §3–§5).
// Kurgusal fikstür ("Lale Turizm", "Örnek Tur"); TC kimlik örneği yaygın bilinen sahte test numarası.
// ---------------------------------------------------------------------------

const SECRET = "test-license-secret-0123456789abcdef";
const OP = "operator-user";
const DAY = 24 * 60 * 60 * 1000;

async function seedOrg(name = "Lale") {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} 1` } });
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

const validReading = (over: Record<string, unknown> = {}) => ({
  source: "ktb_agency_search",
  query: "12345",
  outcome: "valid",
  fields: { number: "12.345", legalName: "LALE TUR. TİC. LTD. ŞTİ.", group: "C", statusText: "Geçerli" },
  ...over,
});
/** Operatör belgeden vergi numarasını YAZAR (kutu yok); varsayılan, agencyApp'in numarası. */
const strongProof = (taxId = "1234567890") => ({ method: "esign_declaration", evidenceRef: "TSG 2025/123 s.4 — yetkili e-imzası", taxId });

async function approveFlow(licenseId: string, readingOver: Record<string, unknown> = {}, taxId = "1234567890") {
  expect((await recordRegistryReading({ licenseId, operatorUserId: OP, reading: validReading(readingOver) })).ok).toBe(true);
  expect(await recordOwnershipProof({ licenseId, operatorUserId: OP, proof: strongProof(taxId) })).toEqual({ ok: true, taxIdMatched: true });
  return decideLicense({ licenseId, operatorUserId: OP, action: "approve" });
}

describe("işletme belgesi — tek yazıcı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("LICENSE_HMAC_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sır yoksa (ya da kısa) kapalı — hiçbir satır yazılmaz", async () => {
    const o = await seedOrg();
    vi.stubEnv("LICENSE_HMAC_SECRET", "kisa");
    expect(await agencyApp(o)).toEqual({ ok: false, reason: "disabled" });
    expect(await prisma.businessLicense.count()).toBe(0);
    expect(await prisma.licenseHolder.count()).toBe(0);
  });

  it("başvuru: bekleyen + 14 gün; VKN şifreli, TCKN HİÇ saklanmaz (yalnız özet + son iki hane); olay yazılır", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    const lic = await prisma.businessLicense.findUniqueOrThrow({ where: { id: r.licenseId } });
    expect(lic).toMatchObject({ status: "pending", numberNorm: "12345", lockKey: null, version: 0 });
    expect(lic.pendingUntil!.getTime() - lic.createdAt.getTime()).toBeGreaterThan(13.9 * DAY);
    const holder = await prisma.licenseHolder.findUniqueOrThrow({ where: { id: lic.holderId } });
    expect(holder.taxIdEnc).toBeTruthy();
    expect(JSON.stringify(holder)).not.toContain("1234567890");
    expect(holder).toMatchObject({ taxIdLast2: "90", verifiedGuard: null, legalNameNorm: "lale tur tic ltd sti" });
    expect(await prisma.licenseEvent.count({ where: { licenseId: lic.id, reason: "application", actorKind: "host" } })).toBe(1);

    const p = await seedOrg("Şahıs");
    const s = await createLicenseApplication({
      organizationId: p.orgId,
      userId: p.userId,
      type: "simple_accommodation",
      number: "07-1234",
      attributes: {},
      holder: { kind: "sole_proprietor", legalName: "Ayşe Örnek", taxId: "10000000146" },
      propertyIds: [p.propertyId],
    });
    if (!s.ok) throw new Error(s.reason);
    const sh = await prisma.licenseHolder.findFirstOrThrow({ where: { organizationId: p.orgId } });
    expect(sh.taxIdEnc).toBeNull();
    expect(JSON.stringify(sh)).not.toContain("10000000146");
    expect(sh.taxIdLast2).toBe("46");
  });

  it("hatalı girdi kodlu reddedilir; kapsam kuralı: acentada daire yok, tesiste en az bir KENDİ dairesi", async () => {
    const o = await seedOrg();
    const other = await seedOrg("Başka");
    expect(await agencyApp(o, { number: "12;345" })).toEqual({ ok: false, reason: "invalid_number" });
    expect(await agencyApp(o, { holder: { kind: "company", legalName: "Lale", taxId: "123" } })).toEqual({ ok: false, reason: "invalid_tax_id" });
    expect(await agencyApp(o, { attributes: { group: "Z" } })).toEqual({ ok: false, reason: "invalid_attributes" });
    expect(await agencyApp(o, { propertyIds: [o.propertyId] })).toEqual({ ok: false, reason: "invalid_units" });
    expect(await agencyApp(o, { type: "tourism_operation", attributes: {}, propertyIds: [] })).toEqual({ ok: false, reason: "invalid_units" });
    expect(await agencyApp(o, { type: "tourism_operation", attributes: {}, propertyIds: [other.propertyId] })).toEqual({ ok: false, reason: "invalid_units" });
    expect(await agencyApp(o, { type: "str_permit" })).toEqual({ ok: false, reason: "invalid_type" });
    expect(await prisma.businessLicense.count()).toBe(0);
  });

  it("en çok 3 açık başvuru; aynı belge kendi hesabında ikinci kez açılmaz; süresi dolan sayılmaz ve tembel olarak 'expired' olur", async () => {
    const o = await seedOrg();
    for (const n of ["111", "222", "333"]) expect((await agencyApp(o, { number: n })).ok).toBe(true);
    expect(await agencyApp(o, { number: "444" })).toEqual({ ok: false, reason: "too_many_open" });
    await prisma.businessLicense.updateMany({ where: { organizationId: o.orgId, numberNorm: "111" }, data: { pendingUntil: new Date(Date.now() - 1000) } });
    expect(await agencyApp(o, { number: "222" })).toEqual({ ok: false, reason: "duplicate" });
    expect((await agencyApp(o, { number: "444" })).ok).toBe(true);
    const expired = await prisma.businessLicense.findFirstOrThrow({ where: { organizationId: o.orgId, numberNorm: "111" } });
    expect(expired.status).toBe("expired");
    expect(await prisma.licenseEvent.count({ where: { licenseId: expired.id, reason: "expire", actorKind: "system" } })).toBe(1);
  });

  it("🚨 eşzamanlı başvurular sınırı aşamaz (işletme başına danışma kilidi)", async () => {
    const o = await seedOrg();
    const results = await Promise.all(["1", "2", "3", "4", "5", "6"].map((n) => agencyApp(o, { number: `9${n}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await prisma.businessLicense.count({ where: { organizationId: o.orgId, status: "pending" } })).toBe(3);
  });

  it("🚨 bekleyen başvuru KİLİTLEMEZ: rakip aynı numarayı yazsa da gerçek sahip başvurabilir ve doğrulanır", async () => {
    const rival = await seedOrg("Rakip");
    const real = await seedOrg("Lale");
    expect((await agencyApp(rival)).ok).toBe(true);
    const r = await agencyApp(real);
    if (!r.ok) throw new Error(r.reason);
    expect(await approveFlow(r.licenseId)).toEqual({ ok: true, status: "verified" });
  });

  it("onay şartları: okuma + güçlü kanıt + belgedeki vergi numarası eşleşmesi; eksikler sırayla döner", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({
      ok: false,
      reason: "not_ready",
      missing: ["reading", "proof"],
    });
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ fields: { number: "12345", legalName: "Lala Turizm Ltd. Şti.", group: "A" } }) });
    // Belgedeki numara başvurudakinden farklı → eşleşmedi (numara saklanmaz).
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: { method: "registered_domain", evidenceRef: "DNS TXT kaydı görüldü", taxId: "1234567899" } })).toEqual({
      ok: true,
      taxIdMatched: false,
    });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({
      ok: false,
      reason: "not_ready",
      missing: ["name_mismatch", "proof_weak", "tax_unconfirmed"],
    });
    // Unvan farkı yalnız yazılı gerekçeyle geçilir; gerekçe olay günlüğünde kalır.
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: strongProof() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: "kısa" })).toMatchObject({ reason: "not_ready" });
    const ok = await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: "Kayıtta eski unvan; TSG unvan değişikliği ilanı görüldü" });
    expect(ok).toEqual({ ok: true, status: "verified" });
    const ev = await prisma.licenseEvent.findFirstOrThrow({ where: { licenseId: r.licenseId, reason: "approve" } });
    expect((ev.evidence as { nameOverride?: string }).nameOverride).toMatch(/TSG/);
  });

  it("onay: kayıttaki grup kazanır, bekçiler dolar, son okuma zamanı yazılır, işaret hesaplanır; 8 günlük okuma yetmez", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await approveFlow(r.licenseId)).toEqual({ ok: true, status: "verified" });
    const lic = await prisma.businessLicense.findUniqueOrThrow({ where: { id: r.licenseId }, include: { holder: true } });
    expect(lic.attributes).toEqual({ group: "C" });
    expect(lic.lockKey).toBe("agency:12345");
    expect(lic.holder.verifiedGuard).toBe(lic.holder.taxIdHash);
    expect(lic.lastRegistrySource).toBe("ktb_agency_search");
    const marks = await orgLicenseMarks(o.orgId);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ type: "agency", group: "C", authority: "ministry", propertyIds: null });
    const [row] = await listOrgLicenses(o.orgId);
    expect(row.mark?.text).toMatch(/^Seyahat acentası işletme belgesi \(C grubu\) Bakanlık kaydıyla eşleşti · son kontrol /);

    const p = await seedOrg("Eski");
    const r2 = await agencyApp(p, { number: "77777", holder: { kind: "company", legalName: "Eski Tur A.Ş.", taxId: "5555555555" } });
    if (!r2.ok) throw new Error(r2.reason);
    await recordRegistryReading({ licenseId: r2.licenseId, operatorUserId: OP, reading: validReading({ query: "77777", fields: { number: "77777", legalName: "Eski Tur Anonim Şirketi", group: "A" } }) });
    await prisma.licenseEvent.updateMany({ where: { licenseId: r2.licenseId, reason: "registry_read" }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    await recordOwnershipProof({ licenseId: r2.licenseId, operatorUserId: OP, proof: strongProof("5555555555") });
    expect(await decideLicense({ licenseId: r2.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "not_ready", missing: ["reading_stale"] });
  });

  it("🚨 bir belge aynı anda tek hesapta doğrulanmış: ikinci hesap onayı → incelemede (ev sahibine 'İnceleniyor', fark yok)", async () => {
    const a = await seedOrg("Lale");
    const b = await seedOrg("Başka");
    const ra = await agencyApp(a);
    const rb = await agencyApp(b, { holder: { kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", taxId: "9999999999" } });
    if (!ra.ok || !rb.ok) throw new Error("başvuru");
    expect(await approveFlow(ra.licenseId)).toEqual({ ok: true, status: "verified" });
    expect(await approveFlow(rb.licenseId, {}, "9999999999")).toEqual({ ok: false, reason: "lock_conflict" });
    const lb = await prisma.businessLicense.findUniqueOrThrow({ where: { id: rb.licenseId } });
    expect(lb).toMatchObject({ status: "under_review", lockKey: null });
    expect(await prisma.licenseEvent.count({ where: { licenseId: rb.licenseId, reason: "lock_conflict" } })).toBe(1);
    const [hostRow] = await listOrgLicenses(b.orgId);
    expect(hostRow.statusLabel).toBe("İnceleniyor");
    // Alan da sızdırmaz: ham "under_review" ev sahibine gitmez (Haiku 11-06 #1).
    expect(hostRow.status).toBe("pending");
    expect((await prisma.businessLicense.findUniqueOrThrow({ where: { id: ra.licenseId } })).status).toBe("verified");
    // Operatör kuyruğu çakışmayı görür (yalnız orada).
    const q = await operatorLicenseQueue();
    expect(q.open.find((x) => x.id === rb.licenseId)?.status).toBe("under_review");
  });

  it("🚨 bir şirket (vergi no) aynı anda tek hesapta doğrulanmış (kurucu S5): başka belgeyle bile ikinci hesap → incelemede", async () => {
    const a = await seedOrg("Lale");
    const b = await seedOrg("İkinci");
    const ra = await agencyApp(a);
    const rb = await agencyApp(b, { number: "54321" });
    if (!ra.ok || !rb.ok) throw new Error("başvuru");
    expect(await approveFlow(ra.licenseId)).toEqual({ ok: true, status: "verified" });
    expect(await approveFlow(rb.licenseId, { query: "54321", fields: { number: "54321", legalName: "LALE TUR. TİC. LTD. ŞTİ.", group: "C" } })).toEqual({ ok: false, reason: "lock_conflict" });
    expect((await prisma.businessLicense.findUniqueOrThrow({ where: { id: rb.licenseId } })).status).toBe("under_review");
    expect(await prisma.licenseEvent.findFirst({ where: { licenseId: rb.licenseId, reason: "lock_conflict" }, select: { evidence: true } })).toMatchObject({ evidence: { on: "holder" } });
  });

  it("doğrulanmış belgede okuma: eşleşen okuma işareti tazeler; AÇIK iptal hemen askıya alır; bulunamadı / okunamadı hüküm vermez (F16)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await approveFlow(r.licenseId);
    await prisma.businessLicense.update({ where: { id: r.licenseId }, data: { lastRegistryOkAt: new Date(Date.now() - 29 * DAY) } });
    const renew = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ source: "tursab_agency_search" }) });
    expect(renew).toMatchObject({ ok: true, renewed: true, autoSuspended: false });
    const after = await prisma.businessLicense.findUniqueOrThrow({ where: { id: r.licenseId } });
    expect(Date.now() - after.lastRegistryOkAt!.getTime()).toBeLessThan(60_000);
    expect(after.lastRegistrySource).toBe("tursab_agency_search");

    for (const outcome of ["not_found", "unreadable"]) {
      const res = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: { source: "ktb_agency_search", query: "12345", outcome } });
      expect(res).toMatchObject({ ok: true, autoSuspended: false, renewed: false, markCleared: false });
      const still = await prisma.businessLicense.findUniqueOrThrow({ where: { id: r.licenseId } });
      expect(still.status).toBe("verified");
      expect(still.lastRegistryOkAt).not.toBeNull();
    }
    const cancel = await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ outcome: "cancelled", fields: { number: "12345", legalName: "Lale Turizm Ltd. Şti.", statusText: "İptal" } }) });
    expect(cancel).toMatchObject({ ok: true, autoSuspended: true });
    const sus = await prisma.businessLicense.findUniqueOrThrow({ where: { id: r.licenseId } });
    expect(sus).toMatchObject({ status: "suspended", suspendReason: "registry_cancelled", lockKey: "agency:12345" });
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(0);
    // Askıdan dönüş yalnız taze, geçerli ve eşleşen okumayla.
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toMatchObject({ ok: false, reason: "not_ready" });
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading() });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toEqual({ ok: true, status: "verified" });
    expect(await orgLicenseMarks(o.orgId)).toHaveLength(1);
  });

  it("okuma kaynağı türe uygun olmalı; kapanmış belgeye okuma yazılmaz", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ source: "ktb_facility_search" }) })).toEqual({
      ok: false,
      reason: "invalid",
      field: "source",
    });
    expect(await withdrawLicense({ organizationId: o.orgId, userId: o.userId, licenseId: r.licenseId })).toEqual({ ok: true });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading() })).toEqual({ ok: false, reason: "not_open" });
  });

  it("geri çekme: yalnız kendi işletmesinin belgesi; doğrulanmış belge geri çekilince bekçiler boşalır, başka hesap doğrulanabilir", async () => {
    const a = await seedOrg("Lale");
    const b = await seedOrg("Yeni");
    const ra = await agencyApp(a);
    if (!ra.ok) throw new Error(ra.reason);
    await approveFlow(ra.licenseId);
    expect(await withdrawLicense({ organizationId: b.orgId, userId: b.userId, licenseId: ra.licenseId })).toEqual({ ok: false, reason: "not_found" });
    expect(await withdrawLicense({ organizationId: a.orgId, userId: a.userId, licenseId: ra.licenseId })).toEqual({ ok: true });
    const la = await prisma.businessLicense.findUniqueOrThrow({ where: { id: ra.licenseId }, include: { holder: true } });
    expect(la).toMatchObject({ status: "withdrawn", lockKey: null });
    expect(la.holder.verifiedGuard).toBeNull();
    const rb = await agencyApp(b);
    if (!rb.ok) throw new Error(rb.reason);
    expect(await approveFlow(rb.licenseId)).toEqual({ ok: true, status: "verified" });
  });

  it("süresi dolmuş bekleyen başvuruya karar verilmez; durumu tablo dışı eylem reddedilir", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reinstate" })).toEqual({ ok: false, reason: "not_open" });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "suspend", reason: "operator" })).toEqual({ ok: false, reason: "not_open" });
    await prisma.businessLicense.update({ where: { id: r.licenseId }, data: { pendingUntil: new Date(Date.now() - 1000) } });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reject", reason: "other" })).toEqual({ ok: false, reason: "not_open" });
    const [row] = await listOrgLicenses(o.orgId);
    expect(row).toMatchObject({ status: "expired", statusLabel: "Süresi doldu" });
  });

  it("doğrulanmış ama son okuması 30 günü geçmiş belge 'Eşleşti' demez; işaret yok", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await approveFlow(r.licenseId);
    await prisma.businessLicense.update({ where: { id: r.licenseId }, data: { lastRegistryOkAt: new Date(Date.now() - 31 * DAY) } });
    const [row] = await listOrgLicenses(o.orgId);
    expect(row).toMatchObject({ status: "verified", statusLabel: "Yeniden kontrol bekleniyor", mark: null });
  });

  it("🚨 okumadan SONRA unvan başka başvuruyla değişirse onay eski eşleşmeyle geçmez (eşleşme karar anında)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading() });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: strongProof() });
    // Aynı vergi no ile ikinci başvuru, farklı unvan → doğrulanmamış hak sahibinin unvanı değişir.
    expect((await agencyApp(o, { number: "999", holder: { kind: "company", legalName: "Bambaşka Turizm A.Ş.", taxId: "1234567890" } })).ok).toBe(true);
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" })).toEqual({ ok: false, reason: "not_ready", missing: ["name_mismatch"] });
  });

  it("süresi dolmuş (süpürülmemiş) bekleyen başvuruya okuma da kanıt da yazılmaz", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await prisma.businessLicense.update({ where: { id: r.licenseId }, data: { pendingUntil: new Date(Date.now() - 1000) } });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading() })).toEqual({ ok: false, reason: "not_open" });
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: strongProof() })).toEqual({ ok: false, reason: "not_open" });
  });

  it("🚨 operatörün serbest metnine TC kimlik numarası yazılamaz (kanıt kaydı, okuma notu, karar notu, unvan gerekçesi)", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    const T = "10000000146";
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: { ...strongProof(), evidenceRef: `İmzalayan TC ${T}` } })).toEqual({ ok: false, reason: "invalid", field: "ref" });
    // Ayraçlı yazım da yakalanır (Opus 11-06 P3-17).
    expect(await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: { ...strongProof(), evidenceRef: "İmzalayan TC 100 000 001 46" } })).toEqual({ ok: false, reason: "invalid", field: "ref" });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ fields: { number: "12345", legalName: `Lale ${T}`, group: "A" } }) })).toEqual({ ok: false, reason: "invalid", field: "fields" });
    expect(await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading({ note: `kimlik ${T}` }) })).toEqual({ ok: false, reason: "invalid", field: "note" });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reject", reason: "other", note: `no:${T}` })).toEqual({ ok: false, reason: "invalid" });
    expect(await decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve", nameOverride: `Yetkili ${T} beyan etti` })).toEqual({ ok: false, reason: "invalid" });
    // KONTROL: 10 haneli VKN ve tarih / sayfa numarası serbest.
    expect((await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: { ...strongProof(), evidenceRef: "VKN 1234567890, TSG 2025/123 s.4" } })).ok).toBe(true);
    expect(await prisma.licenseEvent.count({ where: { licenseId: r.licenseId, evidence: { string_contains: T } } })).toBe(0);
  });

  it("🚨 hesap dökümü (KVKK): hak sahibi + belge var; vergi no özeti / şifresi YOK; çakışmayla incelemede olan 'pending' görünür; operatör günlüğü YOK", async () => {
    const a = await seedOrg("Lale");
    const b = await seedOrg("Başka");
    const ra = await agencyApp(a);
    const rb = await agencyApp(b, { holder: { kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", taxId: "9999999999" } });
    if (!ra.ok || !rb.ok) throw new Error("başvuru");
    await approveFlow(ra.licenseId);
    expect(await approveFlow(rb.licenseId, {}, "9999999999")).toEqual({ ok: false, reason: "lock_conflict" });
    const dump = await buildOrganizationDataExport(b.orgId);
    const text = JSON.stringify(dump);
    expect(dump?.businessLicenses.licenses).toHaveLength(1);
    expect(dump?.businessLicenses.licenses[0].status).toBe("pending");
    expect(dump?.businessLicenses.holders[0]).toMatchObject({ legalName: "Lale Turizm Ticaret Limited Şirketi", taxIdLast2: "99" });
    expect(text).not.toMatch(/taxIdHash|taxIdEnc|verifiedGuard|lockKey|lock_conflict|9999999999|operator-user/);
  });

  it("🚨 eşzamanlı iki karar: biri kazanır, sürüm çakışması öbürünü durdurur (CAS); tek onay olayı", async () => {
    const o = await seedOrg();
    const r = await agencyApp(o);
    if (!r.ok) throw new Error(r.reason);
    await recordRegistryReading({ licenseId: r.licenseId, operatorUserId: OP, reading: validReading() });
    await recordOwnershipProof({ licenseId: r.licenseId, operatorUserId: OP, proof: strongProof() });
    const [x, y] = await Promise.all([
      decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "approve" }),
      decideLicense({ licenseId: r.licenseId, operatorUserId: OP, action: "reject", reason: "other" }),
    ]);
    const oks = [x, y].filter((v) => v.ok);
    expect(oks).toHaveLength(1);
    expect(await prisma.licenseEvent.count({ where: { licenseId: r.licenseId, reason: { in: ["approve", "reject"] } } })).toBe(1);
  });
});
