import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// BİLGİ TABANI ONAY SÖZLEŞMESİ — TEK KAYNAK (A1, 09-08).
//
// Neden var: bir kalemin MODELE gidip gitmeyeceği bugüne kadar tek bir bayrakla
// (`isActive`) belirleniyordu. Metinden ÇIKARILMIŞ taslak öneriler (A5) aynı
// tabloda yaşayacak; onları `isActive` ile ayırmak mümkün değil (host bir
// taslağı "aktif" görmek istemez ama pasif kalem de "host kapattı" demektir).
// Bu yüzden onay durumu AYRI bir kapalı küme olarak taşınıyor.
//
// 🚨 ESKİ SATIRLARIN ONAYI VARSAYILMAZ (kurucu, 09-08). Bu sözleşmeden ÖNCE
// yazılmış satırların host tarafından mı yazıldığı, kopyalamayla mı geldiği,
// hiç gözden geçirilip geçirilmediği KAYIT ALTINDA DEĞİL — böyle bir alan
// yoktu. Onları "host onayladı" diye damgalamak veriye sonradan sahte bir
// gerçek yazmak olurdu (V0.4'teki "çıkarım backfill'i YOK" kararının aynısı).
// Onlar `legacy` doğar: "onay sözleşmesinden önce vardı, kaynağı hakkında
// hüküm vermiyoruz". `legacy` bugün de modele gidiyordu → gitmeye devam eder;
// davranış birebir korunur. Kapanan tek şey `draft`tır.
// ---------------------------------------------------------------------------

/** Kalemin nereden geldiği. `legacy` = sözleşme öncesi, KAYNAĞI BİLİNMİYOR. */
export const KB_SOURCES = ["legacy", "host_manual", "extracted_draft", "suggestion_accepted"] as const;
export type KbSource = (typeof KB_SOURCES)[number];

/** İnceleme durumu. `legacy` = onay KAYDI YOK (onaylandı İDDİA EDİLMEZ). */
export const KB_REVIEW_STATES = ["legacy", "approved", "draft"] as const;
export type KbReviewState = (typeof KB_REVIEW_STATES)[number];

/**
 * MODELE GİDEBİLEN durumlar — ALLOWLIST (denylist DEĞİL).
 *
 * Allowlist olması bilinçli: yarın kümeye yeni bir durum eklendiğinde (örn.
 * `rejected`) denylist onu sessizce MODELE GÖNDERİRDİ. Allowlist'te yeni durum
 * varsayılan olarak DIŞARIDA kalır — yani hata yönü "fazla bilgi sızdırma"
 * değil "eksik bilgi ile insana devret" olur; ürünün kuralı zaten budur.
 *
 * `legacy` burada ŞART: bugün modele giden satırların tamamı bu sınıfa düşüyor,
 * çıkarılırsa canlıdaki her mülkün bilgi tabanı bir migration ile boşalırdı.
 */
export const AI_READABLE_REVIEW_STATES = ["legacy", "approved"] as const satisfies readonly KbReviewState[];

/**
 * ONAY KAPISI — tek Prisma WHERE parçası. `fetchKnowledgeBaseForPrompt` bunu
 * çağıranın filtresiyle `AND`'ler; çağıran EZEMEZ (bkz. kb-fetch.ts).
 */
export const KB_APPROVAL_GATE_WHERE = {
  reviewState: { in: [...AI_READABLE_REVIEW_STATES] },
} satisfies Prisma.KnowledgeBaseItemWhereInput;

/**
 * MİSAFİRE GİDEBİLEN şablon kalemi = aktif + onay kapısından geçmiş.
 *
 * Neden ayrı bir sabit: karşılama/giriş/çıkış şablonları MODELDEN GEÇMEZ,
 * içerikleri misafire AYNEN gönderilir. Onay kapısı yalnız `kb-fetch`'e
 * konsaydı "host onayından önce aktifleşmesin" şartı ürünün en doğrudan
 * yüzeyinde açık kalırdı. Gönderici ve ÖNİZLEME aynı fragmenti yayar —
 * ayrışsalardı host önizlemede gördüğü şablonun gitmediğini (ya da tersini)
 * yaşardı (V0.5'teki `messagingCapable` paritesiyle aynı gerekçe).
 */
export const GUEST_DELIVERABLE_KB_WHERE = {
  isActive: true,
  ...KB_APPROVAL_GATE_WHERE,
} satisfies Prisma.KnowledgeBaseItemWhereInput;

/** Kalem AI'ya (ve mülk hafızasına) gidebilir mi? Tek karar noktası. */
export function isAiReadableReviewState(state: string): boolean {
  return (AI_READABLE_REVIEW_STATES as readonly string[]).includes(state);
}
