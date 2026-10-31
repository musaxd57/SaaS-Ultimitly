import "server-only";

import { prisma } from "@/lib/db";
import { isAiReadableReviewState } from "@/lib/kb-review";

// ---------------------------------------------------------------------------
// A3 — EKSİK BİLGİ ANALİZİ (09-08). Salt-okuma; hiçbir şey YAZMAZ.
//
// Neden var: host'a yüzlerce alan doldurtmak yerine ürünün KENDİ ÖLÇTÜĞÜ boşluğu
// göstermek. Üç girdi zaten canlı akıyor:
//   · `Signal`            — misafir NE sordu (PII'siz, V1'den beri)
//   · `KnowledgeBaseItem` — o kategoride ONAYLI kalem var mı (A1'in `reviewState`i)
//   · `RiskEvent`         — cevap temellenebildi mi (A2 sayaçları)
// Sinyal ile karar kaydı AYNI mesaj kimliğinden bağlanır
// (`Signal.sourceEntityId` === `RiskEvent.triggerId`), yani "sorduğu şeye verilen
// cevap dayanaklı mıydı" sorusu ÇIKARIMLA değil VERİYLE yanıtlanır.
//
// 🚨 ÜÇ SINIF AYRI TUTULUR (kurucu şartı):
//   1. BİLGİ YOKLUĞU        → `absent`            → host'a inceleme adayı
//   2. TEMELLENDİRME HATASI → `ungrounded`        → TEŞHİS, öneri DEĞİL
//      (bilgi vardı ve modele gitti; yeni kalem eklemek YANLIŞ cevaptır)
//   3. ONAY EKSİĞİ          → `awaiting_approval` → bilgi yazılmış, onay bekliyor
//   + OPERASYONEL TALEP (şikayet/para/insan) hiç listeye girmez: bilgi eksiği
//     değil, İŞ. Çözümü kalem eklemek olmadığı için öneri üretmek yanıltıcı olurdu.
//
// 🚨 HİÇBİR SATIR KESİN TESPİT DEĞİL (`decisive: false`) — hepsi İNCELEME ADAYI.
// 🚨 BİLDİRİM YOK: bu fonksiyon yalnız okunur; mesaj başına uyarı üretilmez.
// 🚨 SAKLAMA YOK: "kapat/ertele" ilk dilimde bilinçli olarak yok — o kalıcı bir
//    host kararıdır ve migration ister (bkz. `docs/MIGRATION-IHTIYAC-RAPORU-A1-A5.md`).
// ---------------------------------------------------------------------------

/** Soru penceresi (gün). Bundan eskisi sayılmaz. */
export const GAP_WINDOW_DAYS = 90;
/**
 * Öneri eşiği. Tek gözlem kanıt değildir; `PATTERN_MIN_SIGNALS` ile aynı sayı
 * (aynı gerekçe: bir misafirin bir kez sorması mülkün eksiği demek değil).
 */
export const GAP_MIN_QUESTIONS = 3;

/**
 * Misafir NİYETİ → KB KATEGORİSİ. KAPALI ve DAR eşleme.
 *
 * Yalnız hedefi TARTIŞMASIZ olanlar burada. Dışarıda kalanlar ve gerekçeleri:
 *  · `complaint · refund · human_request · early_departure` → OPERASYONEL: cevabı
 *    bilgi değil eylem. "Şikayet bilgisi ekle" diye bir tavsiye olamaz.
 *  · `early_checkin · late_checkout` → cevabı KB'de değil DEVİR PLANINDA (komşu
 *    rezervasyon + saatler). Buraya bağlamak host'a yanlış yere yazdırırdı.
 *  · `amenity` → net hedef yok. "faq" demek bulanık tavsiye üretirdi
 *    ("ütü var mı?" sorusuna "SSS kalemi ekleyin" demek yardım değildir).
 *  · `general` → sinyal ZATEN üretilmiyor (derive.ts gürültü sayıyor).
 */
export const INTENT_TO_KB_CATEGORY: Readonly<Record<string, string>> = {
  wifi: "wifi",
  parking: "parking",
  location: "location",
  checkin: "checkin",
  checkout: "checkout",
  cleaning: "cleaning",
};

/**
 * Kurulum kontrol listesi — misafir hiç sormamış olsa da bu kategorilerde kalem
 * olmalı. Kasıtlı olarak `KB_PRESETS`in kapsadığı altı kategori: host'a "eksik"
 * dediğimiz her satırın tek tıkla doldurulabilir bir karşılığı var (A4).
 */
export const SETUP_CATEGORIES = ["wifi", "checkin", "parking", "trash", "rules", "checkout"] as const;

export type KbGapLabel = "absent" | "awaiting_approval" | "ungrounded";

export interface KbGap {
  propertyId: string;
  propertyName: string;
  /** `asked` = misafir gerçekten sordu · `setup` = kurulum kontrol listesi. */
  kind: "asked" | "setup";
  category: string;
  /** Pencere içinde bu kategoride gelen misafir sorusu sayısı (setup'ta 0). */
  questionCount: number;
  label: KbGapLabel;
  /**
   * Host'un İNCELEMESİNE aday mı? 🚨 `true` bile "şu bilgiyi ekle" EMRİ değil,
   * bakılacak bir aday demektir. Otomatik kalem oluşturma YOKTUR.
   */
  reviewCandidate: boolean;
  /**
   * Her zaman `false`. Bu bir hipotezdir: "bu kategoride kalem yok", misafirin
   * SORDUĞU ŞEYİN eksik olduğunu kanıtlamaz (niyet sınıflandırması kelime ağıdır
   * ve Türkçe olumsuz fiil boşluğu ÖLÇÜLMÜŞ bir açıktır).
   */
  decisive: false;
}

export interface FindKbGapsOptions {
  /** Yalnız tek mülk için hesapla. */
  propertyId?: string;
  /**
   * Ayrılmış: operasyonel/eşlenmemiş niyet sayaçlarını da döndürmek istersek.
   * BUGÜN DAVRANIŞI DEĞİŞTİRMEZ — operasyonel talep hiçbir hâlde öneri satırı
   * olmaz; sayaç yüzeyi ayrı bir dilim (bkz. A3 ikinci dilim).
   */
  includeCounters?: boolean;
}

/**
 * Mülk × kategori bazında eksik bilgi adaylarını hesaplar. Tekilleştirilmiş ve
 * önem sırasına konmuş: önce GERÇEKTEN SORULAN (çok sorulan başta), sonra
 * kurulum kontrol listesi.
 */
export async function findKbGaps(organizationId: string, options: FindKbGapsOptions = {}): Promise<KbGap[]> {
  const since = new Date(Date.now() - GAP_WINDOW_DAYS * 86_400_000);
  const scope = options.propertyId ? { id: options.propertyId } : {};

  const properties = await prisma.property.findMany({
    where: { organizationId, ...scope },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (properties.length === 0) return [];
  const propertyIds = properties.map((p) => p.id);

  const [signals, items] = await Promise.all([
    // Yalnız misafir mesajı sinyalleri; rezervasyon olayları (iptal/tarih) bilgi
    // eksiği sorusu değildir.
    prisma.signal.groupBy({
      by: ["propertyId", "category"],
      where: {
        organizationId,
        propertyId: { in: propertyIds },
        source: "guest_message",
        kind: "message.intent",
        occurredAt: { gte: since },
      },
      _count: { _all: true },
    }),
    // Aktif kalemler: onay kapısını geçen ile geçmeyen AYRI sayılır — "bilgi yok"
    // ile "bilgi var, onay bekliyor" farklı sınıflardır (A1).
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId: { in: propertyIds }, isActive: true },
      select: { propertyId: true, category: true, reviewState: true },
    }),
  ]);

  const approved = new Set<string>();
  const pending = new Set<string>();
  for (const it of items) {
    const key = `${it.propertyId}:${it.category}`;
    // Onay kapısının TEK karar noktası (A1) — burada ikinci bir liste yazılmaz.
    if (isAiReadableReviewState(it.reviewState)) approved.add(key);
    else pending.add(key);
  }

  // Sorulan kategoriler → eşik üstü ve EŞLENMİŞ olanlar.
  const asked = new Map<string, { propertyId: string; category: string; count: number }>();
  for (const s of signals) {
    const kbCategory = INTENT_TO_KB_CATEGORY[s.category];
    if (!kbCategory) continue; // operasyonel / eşlenmemiş → öneri üretilmez
    if (s._count._all < GAP_MIN_QUESTIONS) continue;
    const key = `${s.propertyId}:${kbCategory}`;
    const prev = asked.get(key);
    // Aynı KB kategorisine düşen iki niyet olursa sayılar TOPLANIR (bugün
    // eşleme birebir; ileride genişlerse tekilleştirme burada korunur).
    asked.set(key, {
      propertyId: s.propertyId,
      category: kbCategory,
      count: (prev?.count ?? 0) + s._count._all,
    });
  }

  // Temellendirme: yalnız gerçekten SORULAN ve kalemi OLAN kategoriler için
  // gerekiyor, o yüzden sorgu dar tutuluyor.
  const groundedKeys = new Set<string>();
  const ungroundedKeys = new Set<string>();
  const needGrounding = [...asked.values()].filter((a) => approved.has(`${a.propertyId}:${a.category}`));
  if (needGrounding.length > 0) {
    const intents = Object.entries(INTENT_TO_KB_CATEGORY)
      .filter(([, kb]) => needGrounding.some((n) => n.category === kb))
      .map(([intent]) => intent);
    const rows = await prisma.signal.findMany({
      where: {
        organizationId,
        propertyId: { in: needGrounding.map((n) => n.propertyId) },
        source: "guest_message",
        kind: "message.intent",
        category: { in: intents },
        occurredAt: { gte: since },
      },
      select: { propertyId: true, category: true, sourceEntityId: true },
    });
    const byMessage = new Map(rows.map((r) => [r.sourceEntityId, r]));
    const events = await prisma.riskEvent.findMany({
      where: { organizationId, triggerId: { in: [...byMessage.keys()] } },
      select: { triggerId: true, kbRetrieved: true, srcVerified: true },
    });
    for (const ev of events) {
      const sig = byMessage.get(ev.triggerId);
      if (!sig) continue;
      const kbCategory = INTENT_TO_KB_CATEGORY[sig.category];
      if (!kbCategory) continue;
      const key = `${sig.propertyId}:${kbCategory}`;
      // ÖLÇÜLMEMİŞ satır hüküm vermez (NULL = ölçülmedi, 0 değil — A2).
      if (ev.kbRetrieved === null || ev.kbRetrieved === 0) continue;
      if (ev.srcVerified === null) continue;
      if (ev.srcVerified > 0) groundedKeys.add(key);
      else ungroundedKeys.add(key);
    }
  }

  const nameById = new Map(properties.map((p) => [p.id, p.name]));
  const out: KbGap[] = [];
  const seen = new Set<string>();

  const push = (g: KbGap) => {
    const key = `${g.propertyId}:${g.category}`;
    if (seen.has(key)) return; // mülk × kategori TEK satır
    seen.add(key);
    out.push(g);
  };

  // 1) Gerçekten sorulanlar — çok sorulan önce.
  for (const a of [...asked.values()].sort((x, y) => y.count - x.count)) {
    const key = `${a.propertyId}:${a.category}`;
    let label: KbGapLabel;
    let reviewCandidate: boolean;
    if (approved.has(key)) {
      // Kalem VAR. Cevaplar temellenmişse söylenecek bir şey yok.
      if (!ungroundedKeys.has(key) || groundedKeys.has(key)) continue;
      label = "ungrounded";
      reviewCandidate = false; // 🚨 yeni kalem eklemek YANLIŞ cevaptır
    } else if (pending.has(key)) {
      label = "awaiting_approval";
      reviewCandidate = false; // bilgi zaten yazılmış, onay bekliyor
    } else {
      label = "absent";
      reviewCandidate = true;
    }
    push({
      propertyId: a.propertyId,
      propertyName: nameById.get(a.propertyId) ?? "",
      kind: "asked",
      category: a.category,
      questionCount: a.count,
      label,
      reviewCandidate,
      decisive: false,
    });
  }

  // 2) Kurulum kontrol listesi — soru olmasa da.
  for (const p of properties) {
    for (const category of SETUP_CATEGORIES) {
      const key = `${p.id}:${category}`;
      if (approved.has(key)) continue;
      push({
        propertyId: p.id,
        propertyName: p.name,
        kind: "setup",
        category,
        questionCount: 0,
        label: pending.has(key) ? "awaiting_approval" : "absent",
        reviewCandidate: !pending.has(key),
        decisive: false,
      });
    }
  }

  return out;
}
