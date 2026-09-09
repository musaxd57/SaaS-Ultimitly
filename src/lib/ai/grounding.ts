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
  /**
   * Bu mülkte (bu kapsamda) hiç kalem yok. 🚨 KESİN TESPİT DEĞİL: "kalem yok",
   * misafirin SORDUĞU ŞEYİN eksik olduğunu kanıtlamaz (soru ↔ kategori
   * eşlemesi ayrı iştir — A3). Host'a yalnız İNCELEME ADAYI olarak sunulur.
   */
  | "absent";

export interface GroundingVerdict {
  label: GroundingLabel;
  /**
   * Bu etiket tek başına aksiyon gerekçesi olabilir mi? BUGÜN HİÇBİR SINIF
   * İÇİN `true` DEĞİL — `absent` DAHİL (kurucu düzeltmesi 09-08). Alan,
   * gelecekte gerçekten kesinleşen bir sınıf çıkarsa yerini hazır tutuyor ve
   * çağıranı bugünden "hipotez" diye okumaya zorluyor.
   */
  decisive: boolean;
  /**
   * Bu gözlem host'un İNCELEMESİNE aday mı?
   *
   * 🚨 ADI BİLİNÇLİ (kurucu, 09-08): önceki ad "şu kalemi ekle" gibi bir KESİN
   * TESPİT vaat ediyordu. Hiçbir sınıf `decisive` olmadığına göre bu bir tespit
   * değil, İNCELEME ADAYIDIR. `true` olması yalnız "host'un bakması gereken bir
   * aday" demektir; HİÇBİR koşulda otomatik kalem oluşturma yetkisi VERMEZ —
   * oluşturma A1'in açık onay yolundan geçer, bu fonksiyondan değil.
   */
  reviewCandidate: boolean;
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
  if (retrieved === null) return { label: "unknown", decisive: false, reviewCandidate: false };

  if (retrieved === 0) {
    // Sıra ÖNEMLİ: onay bekleyen kalem varken "bilgi yok" demek, host'a zaten
    // yazdığı bilgiyi yeniden yazdırmak olurdu.
    if (pending > 0) return { label: "awaiting_approval", decisive: false, reviewCandidate: false };
    if (dropped > 0) return { label: "capacity", decisive: false, reviewCandidate: false };
    return { label: "absent", decisive: false, reviewCandidate: true };
  }

  // Buradan aşağısı: kalem VARDI ve modele GİTTİ. Ne olursa olsun "bilgi
  // yokluğu" değildir → hiçbir dal yeni kalem önermez.
  if (verified !== null && verified > 0) {
    return { label: "grounded", decisive: false, reviewCandidate: false };
  }
  if (declared !== null && declared > 0) {
    // Beyan var, doğrulanan yok: model gerçekte OLMAYAN bir kaynağa atıf yaptı.
    return { label: "fabricated_citation", decisive: false, reviewCandidate: false };
  }
  if (dropped > 0) {
    // Beyan da yok ve kalem düştü: kapasite sorunu daha açıklayıcı.
    return { label: "capacity", decisive: false, reviewCandidate: false };
  }
  return { label: "ungrounded", decisive: false, reviewCandidate: false };
}

// ---------------------------------------------------------------------------
// KANIT — HANGİ KALEMLER, HANGİ SÜRÜMLE (yetkili iç denetim, kurucu 09-08).
//
// `newestUpdatedAt` bir TAZELİK İŞARETİdir, sürüm KİMLİĞİ değil: iki bambaşka
// küme aynı max'ı verebilir. "Bu cevap hangi bilgiye dayandı" sorusunu ancak
// kalem kimliği + o andaki `updatedAt` yanıtlar. Depoda bunun YERLEŞİK VE
// GÜVENLİ biçimi zaten var: `PropertyMemory.evidenceJson` = `[{type, id}]`
// (yalnız kimlik, içerik YOK). Burada aynı deyim kullanılıp sürüm damgası
// ekleniyor — yeni bir izleme mekanizması icat EDİLMİYOR.
//
// 🚨 NEREYE GİDER: yalnız `RiskEvent` (iç karar günlüğü / operatör yüzeyi).
// Misafire dönen QR yanıt gövdesine ASLA konmaz — QR yanıtları açık nesne
// literalleridir, bağlam nesnesi hiçbir yerde serileştirilmez (davranışsal pin).
//
// 🚨 NE KADAR KESİN: bu, İSTEM OLUŞTURUCUYA VERİLEN kümedir. `packKnowledgeBase`
// karakter bütçesi yüzünden içeride birkaç kalemi DAHA düşürebilir; dolayısıyla
// kanıt, modelin gördüğü kümenin ÜST SINIRIDIR. "Model tam olarak bunları
// gördü" diye okunmamalı — sınır bilinçli olarak burada yazılı.
// ---------------------------------------------------------------------------

/** Kanıt gövdesi için sert tavan — patolojik durumda satır şişmesin. */
const EVIDENCE_CHAR_CAP = 4_000;

export interface KbEvidenceInput {
  /**
   * İstem oluşturucuya verilen kalemler (tüm süzgeçlerden SONRA). `chunk`
   * (RAG dilim 1): hibrit seçimde kalemin HANGİ parçası gitti — kalem
   * kimliği + sürüm tek başına "uzun rehberin hangi dilimi" sorusunu yanıtlamaz.
   */
  retrieved: { id: string; updatedAt: Date; chunk?: number }[];
  /** Modelin beyan ettiği ve KODDA doğrulanan kaynak etiketleri ("kb:parking"). */
  usedLabels: string[];
  /**
   * Hibrit retrieval'ın PII'siz özeti (mod, alt sorgu sayısı, geri çekilme
   * sebebi, seçilen/aday parça, süre). Legacy'de yok (null/undefined) —
   * "ölçülmedi" ile "hibrit kapalıydı" ayrımı kanıtta okunur.
   */
  retrieval?: {
    mode: "hybrid";
    q: number;
    fb: string;
    sel: number;
    cand: number;
    ms: number;
    /** Etkin aday kaynakları ("bm25", "ngram", "semantic"). */
    srcs?: string[];
    /** Sürüm kuralıyla düşen kalem sayısı. */
    sup?: number;
    /** Tespit edilen saat-alanı çelişkisi sayısı. */
    conf?: number;
    /** Bütçeye sığmayan çelişki sayısı. */
    confDropped?: number;
  } | null;
}

/**
 * PII'siz kanıt JSON'u: yalnız kalem kimliği, kalem sürümü (`updatedAt`) ve
 * doğrulanmış kaynak ETİKETLERİ. İçerik/başlık/misafir metni TAŞIMAZ.
 *
 * İki taraf da boşsa `null` döner: boş bir JSON yazmak "ölçtük, boştu" ile
 * "ölçmedik"i karıştırırdı — A2'nin NULL sözleşmesiyle aynı gerekçe.
 */
export function buildKbEvidence(input: KbEvidenceInput): string | null {
  const retrieved = input.retrieved
    .filter((r) => typeof r?.id === "string" && r.id.length > 0 && r.updatedAt instanceof Date)
    .map((r) => ({
      type: "kb_item" as const,
      id: r.id,
      v: r.updatedAt.toISOString(),
      // Parça indeksi yalnız hibritte ve yalnız geçerli bir sayıysa yazılır —
      // legacy kanıt biçimi (`{type,id,v}`) karakteri karakterine korunur.
      ...(Number.isInteger(r.chunk) && (r.chunk as number) >= 0 ? { c: r.chunk } : {}),
    }));
  const used = input.usedLabels.filter((l) => typeof l === "string" && l.length > 0 && l.length <= 60);
  // Retrieval özeti: yalnız sayı/kod alanları taşınır (serbest metin YOK).
  const retrieval =
    input.retrieval && input.retrieval.mode === "hybrid"
      ? {
          mode: "hybrid" as const,
          q: input.retrieval.q,
          fb: String(input.retrieval.fb).slice(0, 24),
          sel: input.retrieval.sel,
          cand: input.retrieval.cand,
          ms: input.retrieval.ms,
          // Yalnız kapalı-küme etiketler / sayılar (serbest metin YOK).
          ...(Array.isArray(input.retrieval.srcs)
            ? { srcs: input.retrieval.srcs.filter((s) => typeof s === "string").map((s) => s.slice(0, 16)).slice(0, 4) }
            : {}),
          ...(Number.isInteger(input.retrieval.sup) ? { sup: input.retrieval.sup } : {}),
          ...(Number.isInteger(input.retrieval.conf) ? { conf: input.retrieval.conf } : {}),
          ...(Number.isInteger(input.retrieval.confDropped) ? { confDropped: input.retrieval.confDropped } : {}),
        }
      : undefined;
  if (retrieved.length === 0 && used.length === 0 && !retrieval) return null;
  const body = JSON.stringify({ retrieved, used, ...(retrieval ? { retrieval } : {}) });
  if (body.length <= EVIDENCE_CHAR_CAP) return body;
  // SESSİZ KIRPMA YOK: kaç kalemin kanıttan düştüğü açıkça yazılır, yoksa
  // denetim eksik bir listeyi TAM sanar.
  for (let keep = retrieved.length - 1; keep >= 0; keep--) {
    const truncated = JSON.stringify({
      retrieved: retrieved.slice(0, keep),
      used,
      omitted: retrieved.length - keep,
      ...(retrieval ? { retrieval } : {}),
    });
    if (truncated.length <= EVIDENCE_CHAR_CAP) return truncated;
  }
  return JSON.stringify({ retrieved: [], used: [], omitted: retrieved.length, ...(retrieval ? { retrieval } : {}) });
}
