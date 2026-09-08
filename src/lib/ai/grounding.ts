// ---------------------------------------------------------------------------
// TEMELLENDİRME SINIFLANDIRMASI (A2, 09-08) — OKUMA ZAMANINDA, HÜKÜM DEĞİL.
//
// Ne işe yarar: canlıda "AI cevap veremedi / insana devretti" görüldüğünde
// SEBEBİ ayırmak. Bugüne kadar tek elimizdeki `usedSources` boşluğuydu ve o,
// birbirinden bambaşka üç durumu aynı görüntüye indiriyordu.
//
// 🚨 İKİ KURAL, İKİSİ DE KURUCUNUN AÇIK ŞARTI (09-08):
//
// 1. `usedSources` TEK BAŞINA KANIT DEĞİLDİR. O modelin BEYANIDIR: modele hiç
//    kalem verilmemiş de olabilir (bilgi yokluğu), verilmiş ama model onu
//    kullanmamış/beyan etmemiş de (temellendirme başarısızlığı). Bu yüzden
//    sınıflandırma girdisi ASLA tek bir sayı değildir — kodun bildiği
//    "ne getirildi" ile modelin beyan ettiği "ne kullandım" BİRLİKTE okunur.
//
// 2. SAYILAR HÜKÜM DEĞİLDİR. Bu fonksiyon bir `label` ve bir `decisive` bayrağı
//    döndürür. `decisive: false` = "bu etiket bir hipotezdir, tek başına aksiyon
//    gerekçesi değildir". Örnek: `absent` etiketi "bu mülkte hiç kalem yok"
//    demektir — misafirin SORDUĞU ŞEYİN eksik olduğunu KANITLAMAZ; soru ile
//    kategori eşlemesi ayrı bir iştir (A3) ve orada da tek gözlem yetmez.
//
// Ölçülmemiş alan `undefined`/`null`'dır ve 0 DEĞİLDİR: "ölçmedik" ile
// "sıfırdı" aynı şey olsaydı, ölçmeyen her eski satır sahte bir "bilgi yokluğu"
// istatistiği üretirdi.
// ---------------------------------------------------------------------------

export interface GroundingCounts {
  /** Koda göre isteme GERÇEKTEN giren kalem sayısı. */
  kbRetrieved?: number | null;
  /** Adet tavanı yüzünden düşen kalem sayısı. */
  kbDropped?: number | null;
  /** Aktif ama onay kapısından geçmeyen (A1 `draft`) kalem sayısı. */
  kbPendingApproval?: number | null;
  /** Modelin BEYAN ettiği kaynak sayısı. */
  srcDeclared?: number | null;
  /** Gerçek girdiyle DOĞRULANAN kaynak sayısı (beyanın alt kümesi). */
  srcVerified?: number | null;
}

export type GroundingLabel =
  /** Ölçüm yok — hüküm verilemez. */
  | "unknown"
  /** Cevap gerçek kaynağa dayandı. */
  | "grounded"
  /** Model olmayan bir kaynağa atıf yaptı (doğrulama eledi) — en ağır sınıf. */
  | "fabricated_citation"
  /** Kalem vardı, modele gitti, ama cevap hiçbirine dayanmadı. */
  | "ungrounded"
  /** Kalem adet tavanından düştü — kapasite sorunu. */
  | "capacity"
  /** Bilgi VAR ama onay bekliyor (A1) — bilgi eksiği DEĞİL. */
  | "awaiting_approval"
  /** Bu mülkte hiç kalem yok. */
  | "absent";

export interface GroundingVerdict {
  label: GroundingLabel;
  /**
   * Bu etiket tek başına aksiyon gerekçesi olabilir mi? BUGÜN HİÇBİRİ İÇİN
   * `true` DEĞİL — kasıtlı. Alan, gelecekte gerçekten kesinleşen bir sınıf
   * çıkarsa (örn. doğrulanmış kategori eşlemesiyle) yerini hazır tutuyor ve
   * çağıranı bugünden "hipotez" diye okumaya zorluyor.
   */
  decisive: boolean;
  /** Host'a "bu bilgiyi ekle" önerisi üretmek MEŞRU mu? */
  suggestsNewItem: boolean;
}

/** Ölçülmüş bir sayı mı? (NULL/undefined/NaN/negatif/kesirli → hayır) */
function measured(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function classifyGrounding(c: GroundingCounts): GroundingVerdict {
  const retrieved = measured(c.kbRetrieved) ? c.kbRetrieved : null;
  const dropped = measured(c.kbDropped) ? c.kbDropped : 0;
  const pending = measured(c.kbPendingApproval) ? c.kbPendingApproval : 0;
  const declared = measured(c.srcDeclared) ? c.srcDeclared : null;
  const verified = measured(c.srcVerified) ? c.srcVerified : null;

  // Kodun bildiği taraf ölçülmemişse hiçbir şey söyleyemeyiz. `usedSources`
  // tek başına yeterli OLSAYDI burada ona düşerdik — bilinçli olarak düşmüyoruz.
  if (retrieved === null) return { label: "unknown", decisive: false, suggestsNewItem: false };

  if (retrieved === 0) {
    // Sıra ÖNEMLİ: onay bekleyen kalem varken "bilgi yok" demek, host'a zaten
    // yazdığı bilgiyi yeniden yazdırmak olurdu.
    if (pending > 0) return { label: "awaiting_approval", decisive: false, suggestsNewItem: false };
    if (dropped > 0) return { label: "capacity", decisive: false, suggestsNewItem: false };
    return { label: "absent", decisive: false, suggestsNewItem: true };
  }

  // Buradan aşağısı: kalem VARDI ve modele GİTTİ. Ne olursa olsun "bilgi
  // yokluğu" değildir → hiçbir dal yeni kalem önermez.
  if (verified !== null && verified > 0) {
    return { label: "grounded", decisive: false, suggestsNewItem: false };
  }
  if (declared !== null && declared > 0) {
    // Beyan var, doğrulanan yok: model gerçekte OLMAYAN bir kaynağa atıf yaptı.
    return { label: "fabricated_citation", decisive: false, suggestsNewItem: false };
  }
  if (dropped > 0) {
    // Beyan da yok ve kalem düştü: kapasite sorunu daha açıklayıcı.
    return { label: "capacity", decisive: false, suggestsNewItem: false };
  }
  return { label: "ungrounded", decisive: false, suggestsNewItem: false };
}
