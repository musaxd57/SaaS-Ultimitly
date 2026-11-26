import { DEPLOYABLE_ORIGINS } from "@/lib/app-config";

// ---------------------------------------------------------------------------
// LIXUS'UN KENDİ TAKVİM BESLEMESİ — içe aktarma kaynağı OLAMAZ (Tur 7 CAL-1, kurucu onayı 11-05; kodda doğrulandı).
// Dairenin kendi dışa aktarım bağlantısı aynı sayfadaki "takvim ekle" formuna yapıştırılınca her senkron bütün etkinlikleri yeni kopya
// olarak içe alıyor, kopyalar yeni kimlikle yeniden dışa aktarılıyordu (geçiş başına çoğalan rezervasyon + temizlik görevi + çakışma,
// kanallara giden beslemede sahte doluluk). İki katman:
//   1) Ekleme formu: ayrıştırılmış adresin GERÇEK alan adı (bütün Lixus dağıtımları, www'lu ve www'suz) + dışa aktarım yolu → ret.
//      Metinde "lixus" ARANMAZ (Codex: "lixus-ev.com/takvim" meşru bir adres olabilir).
//   2) Okuyucu: beslemede kendi dışa aktarım kimliğimiz (UID `…@guestops-ai`) varsa — yönlendirme servisi / kopyalanmış adres dahil —
//      HİÇBİR satır yazılmaz, kayıp uzlaştırması KOŞMAZ (önceki rezervasyonlar iptal edilmez), kaynak açıkça "hata" yazılır.
// ---------------------------------------------------------------------------

/** Dışa aktarılan her etkinliğin kimlik soneki (`export/ics.ts` aynı sabiti kullanır). */
export const OWN_EXPORT_UID_SUFFIX = "@guestops-ai";

/** Kurucunun onayladığı metin (11-05) — form reddi ve kaynak durumu aynı cümle. */
export const OWN_FEED_IMPORT_TEXT =
  "Lixus takvim bağlantıları içe aktarma kaynağı olarak kullanılamaz. Airbnb, Booking veya desteklenen başka bir takvimin dışa aktarım bağlantısını ekleyin.";

/**
 * Elle DOSYA yüklemede aynı tanıma, ayrı metin (kurucu onayı 11-05). Abonelik döngüsünden farkı: dosya bir kez okunur — risk sonsuz
 * döngü değil, mevcut rezervasyonların KOPYASI. Yedekten geri yükleme istenirse bu, normal takvim içe aktarımından AYRI, kontrollü bir
 * işlem olarak tasarlanır (bugün yok).
 */
export const OWN_FILE_IMPORT_TEXT =
  "Lixus'tan dışa aktarılan takvim dosyaları içe aktarılamaz. Bu dosya, Lixus'taki rezervasyonlarınızın kopyasını oluşturur. Airbnb, Booking veya başka bir takvimin dışa aktarım dosyasını yükleyin.";

/** Etkinlik kimliği Lixus'un kendi dışa aktarımından mı. */
export function isOwnExportUid(uid: string | null | undefined): boolean {
  return typeof uid === "string" && uid.trim().toLowerCase().endsWith(OWN_EXPORT_UID_SUFFIX);
}

function lixusHosts(): Set<string> {
  const out = new Set<string>();
  for (const origin of DEPLOYABLE_ORIGINS) {
    const host = new URL(origin).host.toLowerCase();
    out.add(host);
    out.add(host.startsWith("www.") ? host.slice(4) : `www.${host}`);
  }
  return out;
}

/**
 * Adres bir Lixus dağıtımının takvim dışa aktarım yolu mu (`/api/calendar/<jeton>`; `/api/calendar/sync` iç uç DEĞİL). Ayrıştırılamayan
 * adres `false` (form zaten ayrı reddeder).
 */
export function isOwnExportFeedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!lixusHosts().has(u.hostname.toLowerCase())) return false;
  const m = /^\/api\/calendar\/([^/]+)\/?$/i.exec(u.pathname);
  return m !== null && m[1].toLowerCase() !== "sync";
}
