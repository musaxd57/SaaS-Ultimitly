import { getEntitlement, isFounderOrg } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// PLAN BAŞINA KULLANIM SINIRLARI (kullanıcı kararı, 2026-07-31).
//
// Daire sayısının yanında paketleri ayrıştıran ikinci eksen. Gerekçe iki yönlü:
//  · TİCARİ — Başlangıç alanla İşletme alan aynı hacmi kullanamamalı.
//  · MALİYET — AI çağrısı ve istem boyutu doğrudan para; tavansız bırakılırsa
//    tek bir hesap aylık bütçeyi saatler içinde yakabilir (denetimde ölçüldü).
//
// TASARIM KURALLARI:
//  1. Sayılar BURADA, tek yerde. Fiyat kartı, hata mesajı ve kapı aynı kaynaktan
//     okur — biri değişip diğeri kalırsa müşteriye yalan söylemiş oluruz.
//  2. Sınırlar GERÇEK kullanımın belirgin üstünde. Amaç meşru host'u kısmak
//     değil, suistimali ve kazayı durdurmak. Rakamların gerekçesi aşağıda.
//  3. Deneme = Pro (14 gün tam Pro). Aboneliği olmayan (grandfathered) org ve
//     KURUCU hesabı EN GENİŞ sınırlara düşer — kurucu muafiyeti `limitsForOrg`
//     içinde AÇIKÇA kurulur; plan kodundan türemez (kurucunun gerçek bir Pro
//     aboneliği var, yani plan koduna güvenmek onu Pro sınırlarına sokardı).
// ---------------------------------------------------------------------------

export interface PlanLimits {
  /** Daire BAŞINA aktif bilgi tabanı kaydı. */
  kbItemsPerProperty: number;
  /** TEK bir bilgi tabanı kaydının karakter tavanı (her planda aynı). */
  kbCharsPerItem: number;
  /** İşletme başına GÜNLÜK AI çağrısı (öneri + çeviri + test + hazırlık özeti). */
  aiCallsPerDay: number;
  /** QR concierge: daire başına GÜNLÜK misafir sorusu. */
  qrQuestionsPerPropertyPerDay: number;
}

/**
 * TEK bir kaydın karakter tavanı — plana göre DEĞİŞMEZ, bilerek.
 *
 * Sebebi: kayıt sayısını sınırlarsan, kullanıcı her şeyi tek kayda doldurup
 * sınırı anlamsız kılabilir ("giriş mesajına hepsini yazarım"). Bu tavan o kaçışı
 * kapatır. Plana bağlamak yerine sabit tutuyoruz çünkü amacı ayrıştırma değil,
 * sayı-sınırının delinmesini engellemek. Ayrışma zaten KAYIT SAYISINDA.
 *
 * 3.000 karakter ≈ 420 Türkçe kelime. BOŞLUKLAR DA SAYILIR (`.length`). Hazır
 * şablonlarımızın en uzunu ~300 karakter, yani 10 kat pay var — meşru hiçbir
 * kaydı kesmez. Önceki değer 20.000'di; tek bir kayıtla AI istemini şişirmeye
 * fazlasıyla yetiyordu. (Kısaca 2.000 denendi, kullanıcı 3.000'e döndürdü:
 * "ne olur ne olmaz", ve 420 kelimeden uzun bir bilgi kaydı pratikte yazılmıyor.)
 */
const KB_CHARS_PER_ITEM = 3_000;

/**
 * Plan bazlı sınırlar.
 *
 * kbItemsPerProperty — kullanıcı kararı: 15 / 30 / 60.
 *
 * aiCallsPerDay — daire başına yoğun bir günde ~20 misafir mesajı varsayımıyla:
 *   Başlangıç (≤2 daire)  gerçekçi ~40/gün  → 150 (≈4x pay)
 *   Pro        (≤7 daire) gerçekçi ~140/gün → 500 (≈3.5x pay)
 *   İşletme    (≤25 daire) gerçekçi ~500/gün → 1500 (≈3x pay)
 * Tavana çarpan bir müşteri gerçekten olağandışı kullanıyordur; o zaman konuşulur.
 *
 * qrQuestionsPerPropertyPerDay — bir misafir konaklaması boyunca tipik 5-15 soru
 * sorar. Daire başına günlük 50 bile birden çok misafiri rahat karşılar.
 */
const LIMITS_BY_PLAN: Record<string, PlanLimits> = {
  free: {
    // "free" kodu LEGACY — bu, ücretli Başlangıç planıdır (plans.ts notu).
    kbItemsPerProperty: 15,
    kbCharsPerItem: KB_CHARS_PER_ITEM,
    aiCallsPerDay: 150,
    qrQuestionsPerPropertyPerDay: 50,
  },
  pro: {
    kbItemsPerProperty: 30,
    kbCharsPerItem: KB_CHARS_PER_ITEM,
    aiCallsPerDay: 500,
    qrQuestionsPerPropertyPerDay: 100,
  },
  business: {
    kbItemsPerProperty: 60,
    kbCharsPerItem: KB_CHARS_PER_ITEM,
    aiCallsPerDay: 1_500,
    qrQuestionsPerPropertyPerDay: 200,
  },
};

/**
 * Plan kodu bilinmiyorsa (grandfathered, kurucu, ya da gelecekte eklenen bir kod)
 * EN GENİŞ sınırlar uygulanır.
 *
 * Yön kararı bilinçli: bilinmeyen bir durumda mevcut bir müşteriyi kısmak, ona
 * sessizce hizmet kesmek demektir — oysa fazla izin vermenin bedeli yalnız biraz
 * kullanım. Kimlik/güvenlik kapılarında fail-closed doğrudur; KULLANIM
 * kapılarında fail-open doğrudur.
 */
const FALLBACK_LIMITS: PlanLimits = LIMITS_BY_PLAN.business;

export function planLimitsFor(planCode: string): PlanLimits {
  return LIMITS_BY_PLAN[planCode] ?? FALLBACK_LIMITS;
}

/**
 * Bir işletmenin yürürlükteki sınırları (deneme = Pro, kurucu = en geniş).
 *
 * ⚠️ KURUCU MUAFİYETİ AÇIKÇA YAZILIR. Bu dosyanın başındaki "kurucu sınırsız"
 * notu bir süre YALAN söyledi: `getEntitlement` yalnız `planCode` döndürüyor ve
 * kurucu hesabının GERÇEK bir Pro aboneliği olduğu için kurucu da Pro
 * sınırlarına tabi oluyordu — yani ürünün sahibi kendi ürününde "sınıra
 * ulaştınız" görebiliyordu (denetim, 07-31). `isFounderOrg` yalnız `active`'i
 * zorluyor, planı değiştirmiyor; muafiyet burada kurulmak zorunda.
 *
 * Yön doğru: bu bir KULLANIM kapısı, fail-open tarafı güvenli taraftır.
 */
export async function limitsForOrg(organizationId: string): Promise<PlanLimits> {
  if (isFounderOrg(organizationId)) return FALLBACK_LIMITS;
  // FAIL-OPEN BURADA, TEK YERDE (denetim, 08-01). `getEntitlement` düz bir
  // `findUnique`; DB hıçkırığında FIRLATIR ve `withManage` bunu 500'e çevirir —
  // yani ödeyen müşteri bilgi kaydını kaydedemez. Catch bir süre yalnız 5 çağrı
  // yerinin 2'sinde vardı (üç KB rotası açıktaydı). Kurala göre KULLANIM
  // kapıları fail-OPEN, kimlik kapıları fail-CLOSED; catch'i buraya almak
  // kuralı tek yerde ve kalıcı olarak uygular.
  const ent = await getEntitlement(organizationId).catch(() => null);
  if (!ent) return FALLBACK_LIMITS;
  return planLimitsFor(ent.planCode);
}

/**
 * İnsan-okur özet. "AI YANITI" DEMEZ — ama sebebi 07-31'den beri TERSİNE döndü
 * ve yorum bir süre yalan söyledi: sayaç artık misafire giden otomatik yanıtı DA
 * sayıyor (`automation.ts`, kullanıcı kararı). "Yanıt" dememesinin sebebi
 * kapsamın DAHA GENİŞ olması — panel içi işlemler (öneri · çeviri · test ·
 * hazırlık özeti) aynı kovadan yiyor. Yani "150 yanıt hakkım var" diye okuyan
 * müşteri, panelde yaptığı işlemlerin de düştüğünü göremezdi.
 */
export function planLimitSummary(planCode: string): string {
  const l = planLimitsFor(planCode);
  return `daire başına ${l.kbItemsPerProperty} bilgi kaydı · günde ${l.aiCallsPerDay} AI işlemi`;
}
