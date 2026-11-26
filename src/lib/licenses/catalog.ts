// ---------------------------------------------------------------------------
// İŞLETME BELGESİ KATALOĞU — TEK KAYNAK (Faz 1a, kurucu 11-06 "Faz1a'ya başla"; tasarım
// docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md §2.2, §3.2). SAF: DB / ağ yok.
//
// · Belge türleri kapalı küme. Konut izni (7464) BİLEREK yok: herkese açık sorgusu bulunmadı, resmî tek yol Bakanlık Veri Doğrulama
//   API'si (Genelge 2026/4) → Faz 1b.
// · Resmî kayıt kaynakları da kapalı küme ve TAM adreslidir: kullanıcının verdiği bir "doğrulama bağlantısı" asla kaynak sayılmaz
//   (resmî olmayan "TÜRSAB sorgu" siteleri var — tasarım Ek A R2). Operatör okumayı yalnız bu listedeki kaynaktan kaydeder.
// · Belediye ruhsatı ve turizm yatırımı belgesi yetki AÇMAZ (2021'den beri Bakanlık / basit konaklama belgesi zorunlu; yatırım belgesi
//   işletme izni değil) → katalogda yer almaz.
// ---------------------------------------------------------------------------

export const LICENSE_TYPES = ["agency", "tourism_operation", "simple_accommodation"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const HOLDER_KINDS = ["company", "sole_proprietor"] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

export const AGENCY_GROUPS = ["A", "B", "C"] as const;
export type AgencyGroup = (typeof AGENCY_GROUPS)[number];

export type RegistryAuthority = "ministry" | "tursab";

export const REGISTRY_SOURCES = {
  ktb_agency_search: {
    label: "Bakanlık — Seyahat Acentası Arama",
    authority: "ministry",
    url: "https://yatirimisletmeleruygulama.kultur.gov.tr/acente.web.sorgu/sorgu/acentesorgu",
  },
  tursab_agency_search: {
    label: "TÜRSAB — Acenta Arama",
    authority: "tursab",
    url: "https://online.tursab.org.tr/publicpages/embedded/agencysearch/",
  },
  ktb_facility_search: {
    label: "Bakanlık — Belgeli ve Başvurusu Olan Tesisler",
    authority: "ministry",
    url: "https://www.ktb.gov.tr/genel/searchhotelgenel.aspx",
  },
} as const satisfies Record<string, { label: string; authority: RegistryAuthority; url: string }>;

export type RegistrySourceId = keyof typeof REGISTRY_SOURCES;
export const REGISTRY_SOURCE_IDS = Object.keys(REGISTRY_SOURCES) as RegistrySourceId[];

/** Kapsam: acenta belgesi hak sahibi GENELİ (merkez); tesis belgeleri yalnız kapsadığı daireler (`LicenseUnit`). */
export const LICENSE_TYPE_INFO: Record<LicenseType, { label: string; scope: "holder" | "units"; sources: readonly RegistrySourceId[] }> = {
  agency: { label: "Seyahat acentası işletme belgesi", scope: "holder", sources: ["ktb_agency_search", "tursab_agency_search"] },
  tourism_operation: { label: "Turizm işletmesi belgesi", scope: "units", sources: ["ktb_facility_search"] },
  simple_accommodation: { label: "Basit konaklama turizm işletmesi belgesi", scope: "units", sources: ["ktb_facility_search"] },
};

export const HOLDER_KIND_LABEL: Record<HolderKind, string> = {
  company: "Şirket",
  sole_proprietor: "Şahıs işletmesi",
};

export function isLicenseType(v: unknown): v is LicenseType {
  return typeof v === "string" && (LICENSE_TYPES as readonly string[]).includes(v);
}

export function isHolderKind(v: unknown): v is HolderKind {
  return typeof v === "string" && (HOLDER_KINDS as readonly string[]).includes(v);
}

export function isRegistrySourceId(v: unknown): v is RegistrySourceId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REGISTRY_SOURCES, v);
}

/** Bu kaynak bu belge türü için okunabilir mi (acenta belgesi tesis sorgusundan "eşleşti" sayılmaz). */
export function sourceAllowedFor(type: LicenseType, source: RegistrySourceId): boolean {
  return LICENSE_TYPE_INFO[type].sources.includes(source);
}

// --- Nitelikler -------------------------------------------------------------------------------------------------------------------

export type AgencyAttributes = { group: AgencyGroup };
export type FacilityAttributes = { facilityType?: string; starClass?: string };
export type LicenseAttributes = AgencyAttributes | FacilityAttributes;

const FREE_TEXT_MAX = { facilityType: 60, starClass: 20 } as const;

/** Görünmez / denetim karakterlerini atar, boşlukları teke indirir (yalnız gösterim alanı; karşılaştırmaya girmez). */
function cleanShortText(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? null : s;
}

/**
 * Tür bazında nitelik doğrulaması. Acentada grup ZORUNLU; tesiste tür / sınıf isteğe bağlı kısa metin. Bilinmeyen alan reddedilir
 * (gövdeye eklenmiş fazladan alan sessizce saklanmasın).
 */
export function parseAttributes(type: LicenseType, raw: unknown): { ok: true; value: LicenseAttributes } | { ok: false } {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const obj = raw as Record<string, unknown>;
  if (type === "agency") {
    const keys = Object.keys(obj);
    if (keys.some((k) => k !== "group")) return { ok: false };
    const g = obj.group;
    if (typeof g !== "string" || !(AGENCY_GROUPS as readonly string[]).includes(g)) return { ok: false };
    return { ok: true, value: { group: g as AgencyGroup } };
  }
  const keys = Object.keys(obj);
  if (keys.some((k) => k !== "facilityType" && k !== "starClass")) return { ok: false };
  const facilityType = cleanShortText(obj.facilityType, FREE_TEXT_MAX.facilityType);
  const starClass = cleanShortText(obj.starClass, FREE_TEXT_MAX.starClass);
  if (facilityType === null || starClass === null) return { ok: false };
  const value: FacilityAttributes = {};
  if (facilityType) value.facilityType = facilityType;
  if (starClass) value.starClass = starClass;
  return { ok: true, value };
}
