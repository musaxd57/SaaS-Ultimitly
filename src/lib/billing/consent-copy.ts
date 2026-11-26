// ---------------------------------------------------------------------------
// ÖDEME ONAYI METİNLERİ — TEK KAYNAK (kurucu 11-13: "ödeme ekranını en yasal şekilde yap; sözleşmelerin onaylandığı mı kabul edildiği mi —
// kelime seçimleri önemli, ceza yemeyelim"). Saf yaprak modül (istemci + sunucu güvenli; hiçbir şey import etmez).
//
// Neden ÜÇ ayrı kutu ve neden bu fiiller (araştırma: scratchpad/handoff/ODEME-ONAY-HUKUK.md; avukat teyidi bekliyor):
//  · Ön Bilgilendirme Formu bir sözleşme DEĞİL — Mesafeli Sözleşmeler Yönetmeliği md. 7 tüketicinin ön bilgileri "edindiğini teyit" etmesini
//    ister (teyit yoksa sözleşme kurulmamış sayılır) → "okudum ve bu bilgileri aldığımı onaylıyorum". Eski tek kutu formu "kabul" ettiriyordu.
//  · Mesafeli Satış Sözleşmesi irade beyanıyla kurulur → "okudum ve kabul ediyorum".
//  · Cayma hakkının istisnası (md. 15/1-h: cayma süresi dolmadan TÜKETİCİNİN ONAYIYLA ifasına başlanan hizmet; AB 2011/83 md. 16(m) "açık
//    onay + kabul") ayrı ve açık bir onay ister — sözleşme kabulünün içine gömülürse ispatı zayıflar. Eski metin onayı "kullanmaya başlamakla
//    verilmiş sayılır" diye ZIMNİ sayıyordu → "hemen başlamasını onaylıyorum … cayma hakkımı kaybedeceğimi kabul ediyorum".
// Kutuların hepsi BOŞ başlar (önceden işaretli kutu yok) ve hepsi zorunludur; sunucu üçünü de ayrı alan olarak ister.
// 🚨 Gösterilen cümleler ödeme onayı satırının özetine girer (`checkoutLegalTextHash`, `lib/legal-text-hash.ts`): satır, o ekranda HANGİ
// cümlelerin gösterildiğini kanıtlar (kartla denemede iki, normal yolda üç). Bir kelime değişirse özet değişir → `LEGAL_VERSION` da artırılır.
// ---------------------------------------------------------------------------

export const CHECKOUT_CONSENT_COPY = {
  preInfo: {
    doc: "Ön Bilgilendirme Formu",
    href: "/on-bilgilendirme",
    after: "’nu okudum ve bu bilgileri aldığımı onaylıyorum.",
    missing: "Devam etmek için Ön Bilgilendirme Formu’nu okuduğunuzu onaylayın.",
  },
  contract: {
    doc: "Mesafeli Satış Sözleşmesi",
    href: "/mesafeli-satis",
    after: "’ni okudum ve kabul ediyorum.",
    missing: "Devam etmek için Mesafeli Satış Sözleşmesi’ni kabul edin.",
  },
  immediateStart: {
    text: "Ücretli planın 14 günlük cayma süresi dolmadan hemen başlamasını onaylıyorum. Bu nedenle cayma hakkımı kaybedeceğimi kabul ediyorum.",
    missing: "Ücretli plan hemen başladığı için bu onay gerekli.",
    /** Denemesi süren hesapta ikinci cümle (gerçek bir seçenek: önce ücretsiz denemek). */
    missingTrialHint: "İsterseniz önce ücretsiz denemeyi kullanın.",
  },
} as const;

export type CheckoutConsentKey = keyof typeof CHECKOUT_CONSENT_COPY;
export const CHECKOUT_CONSENT_KEYS: readonly CheckoutConsentKey[] = ["preInfo", "contract", "immediateStart"];

/**
 * Hangi kutular gösterilir ve sunucuda istenir. Kartla deneme fiyatında ücretli hizmet deneme BİTİNCE başlar ("Deneme süresince ücret
 * alınmaz"; deneme 14 gün = cayma süresi) → "hemen başlasın, cayma hakkımı kaybediyorum" onayı İSTENMEZ: istenseydi müşteriye elinde olan
 * bir hakkı bıraktırırdık (yanlış ve haksız şart). Sunucu aynı kuralı fiyattan uygular (`api/billing/consent`).
 */
const CARD_TRIAL_CONSENT_KEYS: readonly CheckoutConsentKey[] = ["preInfo", "contract"];
export function checkoutConsentKeysFor(opts: { cardTrial: boolean }): readonly CheckoutConsentKey[] {
  // Sabit diziler döner (aynı kimlik) → istemcide kanca bağımlılığı her çizimde değişmez.
  return opts.cardTrial ? CARD_TRIAL_CONSENT_KEYS : CHECKOUT_CONSENT_KEYS;
}

/** Ödeme ekranında gösterilen kutuların cümleleri, tam hâliyle ve sırayla (özet / kanıt için). Verilmezse üçü. */
export function checkoutConsentSentences(keys: readonly CheckoutConsentKey[] = CHECKOUT_CONSENT_KEYS): string[] {
  const c = CHECKOUT_CONSENT_COPY;
  const sentence: Record<CheckoutConsentKey, string> = {
    preInfo: `${c.preInfo.doc}${c.preInfo.after}`,
    contract: `${c.contract.doc}${c.contract.after}`,
    immediateStart: c.immediateStart.text,
  };
  return CHECKOUT_CONSENT_KEYS.filter((k) => keys.includes(k)).map((k) => sentence[k]);
}
