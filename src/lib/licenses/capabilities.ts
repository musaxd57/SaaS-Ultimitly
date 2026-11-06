// ---------------------------------------------------------------------------
// BELGE YETKİLERİ — HESAPLANIR, SAKLANMAZ (Faz 1a; tasarım §5). SAF.
//
// Faz 1a'nın tek yetkisi "eşleşti" işareti: belge ve kapsam başına, kaynağa göre metin, son başarılı kayıt okumasından 30 gün sonra
// KENDİLİĞİNDEN kalkar (Opus P1-8: süresiz, genel "doğrulanmış işletme" rozeti YOK). Yetki her gösterimde bu fonksiyondan yeniden
// hesaplanır — belge askıya alınınca "işareti de kaldır" diye ayrı bir adım unutulamaz.
// ---------------------------------------------------------------------------

import { LICENSE_TYPE_INFO, REGISTRY_SOURCES, isLicenseType, isRegistrySourceId, type LicenseType, type RegistryAuthority } from "./catalog";

export const MARK_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseMarkInput = {
  id: string;
  type: string;
  number: string;
  status: string;
  attributes: unknown;
  lastRegistryOkAt: Date | null;
  lastRegistrySource: string | null;
  /** Tesis belgelerinde kapsanan daireler; acentada boş. */
  propertyIds: string[];
};

export type LicenseMark = {
  licenseId: string;
  type: LicenseType;
  number: string;
  authority: RegistryAuthority;
  checkedAt: Date;
  expiresAt: Date;
  /** null = hak sahibi geneli (acenta); dizi = yalnız bu daireler. */
  propertyIds: string[] | null;
  group: string | null;
};

/** Geçerli işaretler: yalnız `verified` + son başarılı okuma 30 günden yeni + kaynak bilinen ve türe uygun. */
export function licenseMarks(rows: LicenseMarkInput[], now: Date): LicenseMark[] {
  const out: LicenseMark[] = [];
  for (const r of rows) {
    if (r.status !== "verified" || !r.lastRegistryOkAt || !isLicenseType(r.type)) continue;
    if (!r.lastRegistrySource || !isRegistrySourceId(r.lastRegistrySource)) continue;
    if (!LICENSE_TYPE_INFO[r.type].sources.includes(r.lastRegistrySource)) continue;
    const expiresAt = new Date(r.lastRegistryOkAt.getTime() + MARK_TTL_DAYS * DAY_MS);
    if (expiresAt.getTime() <= now.getTime()) continue;
    // Gelecekteki okuma zamanı (saat kayması / bozuk veri) işaret üretmez.
    if (r.lastRegistryOkAt.getTime() > now.getTime() + 60_000) continue;
    const scope = LICENSE_TYPE_INFO[r.type].scope;
    if (scope === "units" && r.propertyIds.length === 0) continue;
    const attrs = r.attributes && typeof r.attributes === "object" ? (r.attributes as Record<string, unknown>) : {};
    out.push({
      licenseId: r.id,
      type: r.type,
      number: r.number,
      authority: REGISTRY_SOURCES[r.lastRegistrySource].authority,
      checkedAt: r.lastRegistryOkAt,
      expiresAt,
      propertyIds: scope === "units" ? [...r.propertyIds] : null,
      group: r.type === "agency" && typeof attrs.group === "string" ? attrs.group : null,
    });
  }
  return out;
}

/** Bu daireyi kapsayan işaretler (acenta işareti daireye bağlı değildir). */
export function marksForProperty(marks: LicenseMark[], propertyId: string): LicenseMark[] {
  return marks.filter((m) => m.propertyIds !== null && m.propertyIds.includes(propertyId));
}
