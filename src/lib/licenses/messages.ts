// ---------------------------------------------------------------------------
// EV SAHİBİNE GÖRÜNEN METİNLER (Faz 1a; tasarım Ek B). Sade, teknik terimsiz, "-in" hitap (CLAUDE.md "MÜŞTERİYE GİDEN METİN SADE").
// 🚨 Başvuru sonucu dışarıya TEK genel cümleyle döner: "bu belge / bu vergi numarası başka bir hesapta" asla söylenmez (kiracılar arası
// sızıntı ve yoklama — tasarım §3.3, Opus P2-14). "Kayıttaki unvan farklı" cümlesi sızıntı değildir: resmî kayıt herkese açıktır.
// ---------------------------------------------------------------------------

import { LICENSE_TYPE_INFO, type LicenseType, type RegistryAuthority } from "./catalog";
import type { LicenseStatus, RejectReason, SuspendReason } from "./state";
import type { LicenseMark } from "./capabilities";

export const LICENSE_TEXT = {
  applicationReceived: "Başvurunuzu aldık. Kontrol ettikten sonra size haber vereceğiz.",
  twoFactorRequired: "Belge eklemek için önce iki aşamalı doğrulamayı açın.",
  planRequired: "Bu özellik Pro ve Business paketlerinde var.",
  tooManyOpen: "Aynı anda en çok 3 başvurunuz incelemede olabilir. Sonuçlanmalarını bekleyin.",
  tooManyRecent: "Bir günde en çok 10 başvuru yapabilirsiniz. Daha sonra yeniden deneyin.",
  invalidNumber: "Belge numarasını kontrol edin.",
  invalidTaxId: "Vergi numarasını kontrol edin.",
  invalidTckn: "TC kimlik numarasını kontrol edin.",
  invalidName: "Ticari unvanı yazın.",
  invalidUnits: "Belgenin kapsadığı daireleri seçin.",
  invalidGroup: "Acenta grubunu seçin.",
  withdrawn: "Belgeyi geri çektiniz.",
  /** İncelemedeki başvuru geri çekilince (soru da "Başvuruyu…" der — 11-06). */
  applicationWithdrawn: "Başvuruyu geri çektiniz.",
} as const;

/**
 * Geri çekmede eşleşmiş / askıdaki BELGE ile incelemedeki BAŞVURU ayrı söylenir (kurucu 11-06 S-B). TEK kural: ekrandaki soru, ekranın
 * bildirimi ve sunucunun cevabı bunu kullanır (sunucu geri çekilen satırın kilit altındaki ESKİ durumunu verir).
 */
export function isWithdrawnDocument(status: string): boolean {
  return status === "verified" || status === "suspended";
}

export function withdrawnText(status: string): string {
  return isWithdrawnDocument(status) ? LICENSE_TEXT.withdrawn : LICENSE_TEXT.applicationWithdrawn;
}

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  pending: "İnceleniyor",
  // Çakışma ya da uyuşmazlık nedeniyle insana düşen başvuru ev sahibine farklı GÖSTERİLMEZ (sızıntı olmasın).
  under_review: "İnceleniyor",
  verified: "Eşleşti",
  suspended: "Askıda",
  rejected: "Onaylanmadı",
  withdrawn: "Geri çekildi",
  expired: "Süresi doldu",
};

/** Doğrulanmış belgenin son okuması 30 günü geçti — işaret kalktı, yeniden kontrol bekleniyor. */
export const VERIFIED_STALE_LABEL = "Yeniden kontrol bekleniyor";

export const SUSPEND_REASON_TEXT: Record<SuspendReason, string> = {
  registry_cancelled: "Resmî kayıtta belgeniz geçerli görünmüyor. Bir hata olduğunu düşünüyorsanız bize yazın.",
  not_found: "Belgeniz resmî kayıtta bulunamadı. Bir hata olduğunu düşünüyorsanız bize yazın.",
  mismatch: "Resmî kayıttaki bilgiler, girdiğiniz bilgilerle uyuşmuyor. Ekibimiz kontrol edip size dönecek.",
  operator: "Belgeniz yeniden incelemeye alındı. Ekibimiz kontrol edip size dönecek.",
};

export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  not_found: "Bu numarayla resmî kayıtta bir belge bulamadık. Numarayı kontrol edip yeniden başvurun.",
  mismatch: "Resmî kayıttaki unvan, girdiğiniz unvanla aynı değil. Unvanı kontrol edip yeniden başvurun.",
  // Şahıs işletmesinde "şirket" yok (Opus 11-06 P3-20) — iki duruma da uyan cümle.
  no_authority: "Belge sahibi adına başvuru yetkiniz doğrulanamadı.",
  other: "Başvurunuz onaylanmadı.",
};

export const EXPIRED_TEXT = "Başvuru 14 gün içinde sonuçlanmadı. Yeniden başvurabilirsiniz.";

const AUTHORITY_LABEL: Record<RegistryAuthority, string> = { ministry: "Bakanlık", tursab: "TÜRSAB" };

export function formatMarkDate(d: Date, timeZone = "Europe/Istanbul"): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone }).format(d);
}

/**
 * "Eşleşti" işareti metni — kaynağa göre (Bakanlık / TÜRSAB), mutlak "doğrulandı" iddiası YOK; yalnız "kayıtla eşleşti" + tarih
 * (Bakanlık, sorgu sonuçlarının hukuki sonuç için yazılı teyit gerektirdiğini belirtiyor — tasarım §17).
 */
export function markText(mark: Pick<LicenseMark, "type" | "authority" | "checkedAt" | "group">, timeZone?: string): string {
  const label = mark.type === "agency" && mark.group ? `${LICENSE_TYPE_INFO.agency.label} (${mark.group} grubu)` : LICENSE_TYPE_INFO[mark.type as LicenseType].label;
  return `${label} ${AUTHORITY_LABEL[mark.authority]} kaydıyla eşleşti · son kontrol ${formatMarkDate(mark.checkedAt, timeZone)}`;
}
