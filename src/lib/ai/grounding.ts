import { CLAIM_CLASSES, type ClaimAudit } from "./claim-support";
import { UNDERSTANDING_INTENTS } from "./semantic/understanding-schema";
import { INTENT_RISK_KINDS, INTENT_RISK_REASON } from "./semantic/intent-risk";
import { STAY_REPLY_INTENTS } from "./semantic/stay-change";
import { EARLY_CHECKIN_CHECKS } from "@/lib/early-checkin/core";
import type { LlmUsage } from "./types";
import { cleanGateEvidence, type GateEvidence } from "./gate-evidence";
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

/**
 * §C (09-12) — SAYAÇLARI İSTEMİN GERÇEĞİNE ÇEKER.
 *
 * 🚨 ÖLÇÜLEN KUSUR: yüzeyler `kbRetrieved`/`kbDropped`i `suggestReply`'dan ÖNCE
 * hesaplıyor, yani yalnız İSTEM-ÖNCESİ düşüşleri biliyorlar (sorgu tavanı + sır
 * süzgeci + seçici). `packKnowledgeBase`in KENDİ karakter-bütçesi kesmesi o
 * sayılara hiç girmiyordu: istem modele "N kalem alınamadı" derken karar kaydı
 * daha küçük bir sayı (çoğu zaman 0) söylüyordu.
 *
 * @param omittedInPrompt `buildReplyPrompt(...).kbOmitted` — istemin TOPLAM
 *   düşüşü (ön düşüşler DÂHİL). `undefined` = model yolu hiç koşmadı (fallback)
 *   → A2 gereği hiçbir şey yazılmaz, uydurma sayı üretilmez.
 * @param selectedCount Seçicinin istem oluşturucuya VERDİĞİ kalem sayısı.
 *
 * 🚨 `kbDropped` EKLENMEZ, DEĞİŞTİRİLİR: `omittedInPrompt` zaten çağıranın
 * bildirdiği ön düşüşleri içerir (`packKnowledgeBase` `alreadyDropped`ı kendi
 * sayısına ekleyerek döndürür). Eklemek ön düşüşleri İKİ KEZ sayardı.
 *
 * ⚠️ `kbRetrieved` de düzeltilir — eskiden SEÇİLEN kalem sayısıydı, yani
 * modelin gördüğünün ÜST SINIRI. `grounding.ts`in kanıt başlığı bu sınırı
 * dürüstçe yazıyordu; artık sınır DEĞİL GERÇEK sayı raporlanıyor.
 */
export function applyPromptKbAudit<T extends GroundingCounts>(
  base: T,
  omittedInPrompt: number | undefined,
  selectedCount: number,
): T {
  if (typeof omittedInPrompt !== "number" || !Number.isFinite(omittedInPrompt)) return base;
  // Kodun bildiği taraf ölçülmemişse düzeltilecek bir şey de yok (A2).
  if (!measured(base.kbDropped) || !measured(base.kbRetrieved)) return base;
  const packOwn = Math.max(0, omittedInPrompt - base.kbDropped);
  return {
    ...base,
    kbDropped: omittedInPrompt,
    kbRetrieved: Math.max(0, selectedCount - packOwn),
  };
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
// 🚨 NE KADAR KESİN: bu LİSTE, İSTEM OLUŞTURUCUYA VERİLEN kümedir.
// `packKnowledgeBase` karakter bütçesi yüzünden içeride birkaç kalemi DAHA
// düşürebilir; dolayısıyla kanıt LİSTESİ, modelin gördüğü kümenin ÜST SINIRIDIR.
// "Model tam olarak bunları gördü" diye okunmamalı — sınır bilinçli olarak
// burada yazılı ve HÂLÂ GEÇERLİ (liste pack'ten önce kurulur).
//
// ⚠️ SAYAÇLAR ARTIK AYRIŞTI (§C, 09-12): `kbRetrieved`/`kbDropped` bu sınıra
// TABİ DEĞİL — `applyPromptKbAudit` onları `suggestReply` dönünce istemin
// gerçeğine çeker. Yani SAYI kesindir, LİSTE üst sınırdır. İkisini aynı
// kesinlikte okumak hata olur.
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
    /** Cevapsız önceki misafir mesajlarından eklenen alt sorgu sayısı. */
    pq?: number;
    /** Etkin birleşim ("sum" | "rrf"). */
    fus?: string;
    /** Anlamsal kaynağın durumu (yalnız anahtar açıkken). */
    sem?: string;
    /** Anlamsal hazırlık süresi (ms). */
    semMs?: number;
    /** Anlama katmanının eklediği sorgu sayısı. */
    uq?: number;
    /** Anlama katmanının durumu (ok/cached/failed). */
    un?: string;
    /** Anlama katmanının süresi (ms). */
    unMs?: number;
    /** Anlaşılan niyetler (kapalı küme). */
    ui?: string[];
    /** Yeniden sıralayıcının durumu (ok/failed/skipped; #186). */
    rr?: string;
    /** Yeniden sıralayıcının süresi (ms). */
    rrMs?: number;
    /** Modelin "cevaplıyor" dediği aday sayısı. */
    rrA?: number;
  } | null;
  /** İddia desteği gölge ölçümü (yalnız sayılar + kapalı-küme sınıflar; `claim-support.ts`). */
  claims?: ClaimAudit;
  /** Model token kullanımı (yalnız sayılar + sunulan model adı). */
  llm?: LlmUsage;
  /** Yapay zekâyı ele geçirme ifadesi taşıdığı için istemden çıkarılan kalem sayısı (`kb-fetch`). */
  hijackScreened?: number;
  /**
   * Konaklama değişikliği politikasının özeti (09-24, `evaluateAvailability`): uygulanan karar, `ev` (09-24'ten
   * beri karara eşit; eski kayıtlarda gölge kararıydı) ve katman sinyalleri — yalnız kapalı-küme kodlar.
   */
  stay?: StayEvidence;
  /**
   * Anlama katmanının risk niyeti (09-24, `semantic/intent-risk.ts`): uygulanan karar, `ev` (karara eşit; eski
   * kayıtlarda gölge kararıydı) ve sinyalin kendisi — yalnız kapalı-küme kodlar. Yalnız katman koştuysa verilir.
   */
  intentRisk?: { v: string; ev: string; k: string };
  /**
   * Doğrulanmış erken giriş akışı (09-24, `lib/early-checkin`): karar durumu, başarısız kontroller ve otomatik
   * gönderim — kapalı-küme kodlar + dayanak kimlikleri / zaman damgası / kural parmak izi (kanıt modeli U; saat,
   * tutar, metin, PII YOK). Yalnız akış koştuysa verilir.
   */
  earlyCheckin?: EarlyCheckinEvidenceInput;
  /**
   * Kapı kanıtı (09-25, `ai/gate-evidence.ts`): `blocked` ayrıntısı + kelime ağı uyarıları ile modelin kapatıcı
   * sinyalleri ayrı alanlarda (kapalı küme kodlar). Karar değil — ölçüm.
   */
  gate?: GateEvidence;
}

/** `ec` girdisi: `s/f/a` zorunlu; diğerleri isteğe bağlı ve TEK TEK doğrulanır (bozuk alan yalnız kendini düşürür). */
export interface EarlyCheckinEvidenceInput {
  s: string;
  f: string[];
  a: string;
  dr?: string;
  rm?: string;
  rt?: string;
  rh?: string;
  n?: string;
  dc?: string;
}

const IR_REASONS: ReadonlySet<string> = new Set(["-", INTENT_RISK_REASON]);
const IR_KINDS: ReadonlySet<string> = new Set(["-", ...INTENT_RISK_KINDS]);

const EC_STATUSES: ReadonlySet<string> = new Set(["approvable", "pending", "needs_host", "not_early"]);
const EC_CHECKS: ReadonlySet<string> = new Set(EARLY_CHECKIN_CHECKS);

/** Kayıt kimliği (cuid): yalnız küçük harf + rakam; serbest metin sızamaz. */
const EC_ID = /^[a-z0-9]{20,40}$/;
const EC_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const EC_HASH = /^[0-9a-f]{12}$/;

/**
 * `ec` kanıt alanı: durum + başarısız kontroller + otomatik gönderim (tanınmayan → ALAN düşer) + isteğe bağlı dayanaklar
 * (her biri kendi biçimiyle; bozuk olan yalnız kendini düşürür).
 */
function cleanEarlyCheckin(x: KbEvidenceInput["earlyCheckin"]): EarlyCheckinEvidenceInput | undefined {
  if (!x || !EC_STATUSES.has(x.s) || (x.a !== "0" && x.a !== "1") || !Array.isArray(x.f)) return undefined;
  if (!x.f.every((c) => EC_CHECKS.has(c)) || x.f.length > EC_CHECKS.size) return undefined;
  const ok = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
  return {
    s: x.s,
    f: [...x.f],
    a: x.a,
    ...(ok(x.dr, EC_ID) ? { dr: x.dr } : {}),
    ...(ok(x.rm, EC_ID) ? { rm: x.rm } : {}),
    ...(ok(x.rt, EC_MINUTE) ? { rt: x.rt } : {}),
    ...(ok(x.rh, EC_HASH) ? { rh: x.rh } : {}),
    ...(x.n === "0" || x.n === "1" || x.n === "2" ? { n: x.n } : {}),
    ...(x.dc === "1" ? { dc: "1" } : {}),
  };
}

/** `ir` kanıt alanını yeniden kurar: tanınmayan her değer alanı düşürür (serbest metin sızamaz). */
function cleanIntentRisk(x: KbEvidenceInput["intentRisk"]): { v: string; ev: string; k: string } | undefined {
  if (!x || !IR_REASONS.has(x.v) || !IR_REASONS.has(x.ev) || !IR_KINDS.has(x.k)) return undefined;
  return { v: x.v, ev: x.ev, k: x.k };
}

/** `sc` kanıt alanı — hepsi kapalı küme; metin/PII YOK. */
export interface StayEvidence {
  /** Uygulanan karar ("-" = temiz). */
  v: string;
  /** 09-24'ten beri `v`ye eşit (gölge kip kaldırıldı); eski kayıtlarda gölge kararıydı. Şema kararlılığı için. */
  ev: string;
  lx: string;
  d: string;
  g: string;
  gv?: string;
  u: string;
  /** Cevap modelinin niyet etiketi konaklama değişikliği adlandırıyorsa o etiket (kapalı küme). */
  ri?: string;
}

const STAY_REASONS = new Set(["-", "availability_claim", "availability_unconfirmed", "price_claim"]);
const STAY_REPLY_INTENT_CODES: ReadonlySet<string> = new Set(STAY_REPLY_INTENTS);
const STAY_KINDS = new Set(["none", "extend", "early_checkin", "late_checkout", "date_change", "availability", "unknown"]);
const STAY_STANCES = new Set(["none", "defers", "grants", "states_calendar", "refuses", "unknown"]);

/** Kanıt özetini yeniden kurar: tanınmayan her değer düşer (serbest metin sızamaz). */
function cleanStay(x: StayEvidence | undefined): StayEvidence | undefined {
  if (!x) return undefined;
  if (!STAY_REASONS.has(x.v) || !STAY_REASONS.has(x.ev)) return undefined;
  if (!/^(?:-|c?r?d?m?)$/.test(x.lx) || x.lx === "") return undefined;
  if (x.d !== "absent") {
    const [asked, stance, extra] = String(x.d).split("/");
    if (extra !== undefined || !STAY_KINDS.has(asked) || !STAY_STANCES.has(stance)) return undefined;
  }
  if (x.g !== "off" && x.g !== "ok" && x.g !== "failed") return undefined;
  if (x.u !== "off" && x.u !== "req" && x.u !== "none" && x.u !== "failed") return undefined;
  const gv = typeof x.gv === "string" && /^(?:-|q?s?a?d?x?t?p?)$/.test(x.gv) && x.gv !== "" ? x.gv : undefined;
  // Niyet etiketi yalnız kapalı kümeden; tanınmayan değer yalnız KENDİSİ düşer (`gv` gibi — sinyal özeti kalır).
  const ri = typeof x.ri === "string" && STAY_REPLY_INTENT_CODES.has(x.ri) ? x.ri : undefined;
  return { v: x.v, ev: x.ev, lx: x.lx, d: x.d, g: x.g, ...(gv ? { gv } : {}), u: x.u, ...(ri ? { ri } : {}) };
}

/** İddia özetini yeniden kurar: yalnız bilinen alanlar, yalnız sayı/kapalı-küme sınıf (serbest metin sızamaz). */
function cleanClaims(c: ClaimAudit | undefined): ClaimAudit | undefined {
  if (!c || c.v !== 1) return undefined;
  const int = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : 0);
  const classes = (xs: unknown) =>
    Array.isArray(xs) ? CLAIM_CLASSES.filter((k) => (xs as unknown[]).includes(k)) : [];
  return { v: 1, n: int(c.n), ctx: int(c.ctx), op: int(c.op), echo: int(c.echo), k: int(c.k), u: int(c.u), uc: classes(c.uc), ec: classes(c.ec) };
}

function cleanUsage(u: LlmUsage | undefined): LlmUsage | undefined {
  if (!u) return undefined;
  const out: LlmUsage = {};
  for (const k of ["pt", "ct", "cpt", "rt"] as const) {
    const v = u[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  if (typeof u.m === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(u.m)) out.m = u.m;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * PII'siz kanıt JSON'u: yalnız kalem kimliği, kalem sürümü (`updatedAt`) ve
 * doğrulanmış kaynak ETİKETLERİ. İçerik/başlık/misafir metni TAŞIMAZ.
 *
 * İki taraf da boşsa `null` döner: boş bir JSON yazmak "ölçtük, boştu" ile
 * "ölçmedik"i karıştırırdı — A2'nin NULL sözleşmesiyle aynı gerekçe. ⚠️ 09-25'ten beri kanal oto-yanıtı her kararda
 * kapı kanıtını (`g`) verir → o yolun kaydı artık NULL OLMAZ (kapı ölçüldü); "KB kanıtı var mı" sayımı `retrieved`/`used`
 * alanlarına bakmalı, kolonun NULL olmayışına değil.
 */
/** Anlamsal kaynak durumları — kapalı küme (`embeddings/semantic-retrieval.ts`). */
const SEM_STATUSES = new Set(["ok", "cold", "unavailable", "not_needed"]);
/** Anlama katmanı durumları + niyetleri — kapalı kümeler (`ai/semantic/understanding-schema.ts`). */
const UN_STATUSES = new Set(["ok", "cached", "failed"]);
/** Yeniden sıralayıcı durumları — kapalı küme (`ai/semantic/rerank.ts`, #186). */
const RR_STATUSES = new Set(["ok", "failed", "skipped"]);
const INTENT_SET: ReadonlySet<string> = new Set(UNDERSTANDING_INTENTS);

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
          ...(Number.isInteger(input.retrieval.pq) ? { pq: input.retrieval.pq } : {}),
          // 🚨 `fus` 09-11'den beri "kanıttan denetlenebilir" diye belgelenmişti ama BURADA
          // düşüyordu (09-23 ölçüldü): kapalı küme, taşınır.
          ...(input.retrieval.fus === "sum" || input.retrieval.fus === "rrf" ? { fus: input.retrieval.fus } : {}),
          ...(SEM_STATUSES.has(String(input.retrieval.sem)) ? { sem: String(input.retrieval.sem) } : {}),
          ...(typeof input.retrieval.semMs === "number" && Number.isFinite(input.retrieval.semMs) && input.retrieval.semMs >= 0
            ? { semMs: Math.round(input.retrieval.semMs * 10) / 10 }
            : {}),
          // Yeniden sıralayıcı (#186): yalnız kapalı küme / sayı; aday metni ve model çıktısı kanıta GİRMEZ.
          ...(RR_STATUSES.has(String(input.retrieval.rr)) ? { rr: String(input.retrieval.rr) } : {}),
          ...(typeof input.retrieval.rrMs === "number" && Number.isFinite(input.retrieval.rrMs) && input.retrieval.rrMs >= 0
            ? { rrMs: Math.round(input.retrieval.rrMs * 10) / 10 }
            : {}),
          ...(Number.isInteger(input.retrieval.rrA) && (input.retrieval.rrA as number) >= 0 ? { rrA: input.retrieval.rrA } : {}),
          // Anlama katmanı (09-24): yalnız kapalı küme / sayı; sorgu METNİ kanıta GİRMEZ.
          ...(Number.isInteger(input.retrieval.uq) && (input.retrieval.uq as number) > 0 ? { uq: input.retrieval.uq } : {}),
          ...(UN_STATUSES.has(String(input.retrieval.un)) ? { un: String(input.retrieval.un) } : {}),
          ...(typeof input.retrieval.unMs === "number" && Number.isFinite(input.retrieval.unMs) && input.retrieval.unMs >= 0
            ? { unMs: Math.round(input.retrieval.unMs) }
            : {}),
          ...(Array.isArray(input.retrieval.ui)
            ? (() => {
                const ui = input.retrieval.ui.filter((x) => INTENT_SET.has(x)).slice(0, 5);
                return ui.length > 0 ? { ui } : {};
              })()
            : {}),
        }
      : undefined;
  const claims = cleanClaims(input.claims);
  const llm = cleanUsage(input.llm);
  // Yalnız ölçüldüyse yazılır: kanıt biçimi ölçülmeyen yolda karakteri karakterine aynı kalır.
  const hj = Number.isInteger(input.hijackScreened) && (input.hijackScreened as number) > 0 ? (input.hijackScreened as number) : undefined;
  const sc = cleanStay(input.stay);
  const ir = cleanIntentRisk(input.intentRisk);
  const ec = cleanEarlyCheckin(input.earlyCheckin);
  const g = cleanGateEvidence(input.gate);
  const extra = {
    ...(claims ? { claims } : {}),
    ...(llm ? { llm } : {}),
    ...(hj ? { hj } : {}),
    ...(sc ? { sc } : {}),
    ...(ir ? { ir } : {}),
    ...(ec ? { ec } : {}),
    ...(g ? { g } : {}),
  };
  if (retrieved.length === 0 && used.length === 0 && !retrieval && !claims && !llm && !hj && !sc && !ir && !ec && !g) return null;
  const body = JSON.stringify({ retrieved, used, ...(retrieval ? { retrieval } : {}), ...extra });
  if (body.length <= EVIDENCE_CHAR_CAP) return body;
  // SESSİZ KIRPMA YOK: kaç kalemin kanıttan düştüğü açıkça yazılır, yoksa
  // denetim eksik bir listeyi TAM sanar.
  for (let keep = retrieved.length - 1; keep >= 0; keep--) {
    const truncated = JSON.stringify({
      retrieved: retrieved.slice(0, keep),
      used,
      omitted: retrieved.length - keep,
      ...(retrieval ? { retrieval } : {}),
      ...extra,
    });
    if (truncated.length <= EVIDENCE_CHAR_CAP) return truncated;
  }
  return JSON.stringify({ retrieved: [], used: [], omitted: retrieved.length, ...(retrieval ? { retrieval } : {}), ...extra });
}
