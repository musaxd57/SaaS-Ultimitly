import type { SeniorChecks } from "./absence-judge";

// ---------------------------------------------------------------------------
// KIDEMLİ OKUYUCU → AYNI ANLAMDA BİR KEZ YENİDEN YAZ (kurucu 10-22, aynen: "airbnbnin engelleyeceği bir cevap üretildiyse … gitmeme nedeni
// ve cümleleri aynı anlamda sınıra takılmadan yapabileceği şekilde değiştirip tekrar deneyebilir tekrar kontrolden geçerek ve hemen bir
// kez cevap gitmedi diye sürekli hosta mail gitmemezlik olmasın").
//
// Okuyucu (`absence-judge.ts`, anahtar `AI_SENIOR_READER_ENABLED`) ilk taslakta düzeltilebilir bir sorun görürse cevap hemen ev sahibine
// bırakılmaz: model SEBEBİ not olarak alıp aynı cevabı bir kez daha yazar, yeni taslak BÜTÜN kapılardan ve okuyucudan yeniden geçer. İkinci
// taslak da takılırsa ev sahibine taslak kalır (tek kayıt; bu tutuş için ayrıca e-posta YOK). Düzeltilebilir sorunlar: ev sahibine platform
// dışı ödeme, Airbnb'nin engellediği iletişim (yalnız o pencerede), özür (özür kuralı açıkken). "Bilgim yok" bu listede DEĞİL — eksik bilgi
// yeniden yazmakla gelmez. Saf; not metinleri misafir metni / değer taşımaz.
// ---------------------------------------------------------------------------

export type SeniorRewriteReason = "payHost" | "contact" | "apology";

export const SENIOR_REWRITE_REASONS: readonly SeniorRewriteReason[] = ["payHost", "contact", "apology"];

/** İlk taslağın yeniden yazılmasını gerektiren sebepler (kapının tutacağı sebeplerle BİREBİR aynı koşullar). */
export function seniorRewriteReasons(
  checks: SeniorChecks | undefined,
  ctx: { contactHolds: boolean; apologyRule: boolean },
): SeniorRewriteReason[] {
  if (!checks) return [];
  const out: SeniorRewriteReason[] = [];
  if (checks.payHost) out.push("payHost");
  if (checks.contact && ctx.contactHolds) out.push("contact");
  if (checks.apology && ctx.apologyRule) out.push("apology");
  return out;
}

/** Modele giden sabit notlar — sebep + "aynı anlamı şöyle yaz". */
export const SENIOR_REWRITE_NOTES: Record<SeniorRewriteReason, string> = {
  payHost:
    "Önceki taslak misafiri ev sahibine / daireye platform DIŞINDA ödemeye (nakit, havale, IBAN, kapıda, ödeme bağlantısı) yönlendiriyordu; " +
    "Airbnb ve Booking bunu yasaklar. Aynı cevabı bu yönlendirme OLMADAN yaz: ev sahibine ödeme yöntemi / yeri söyleme, ödeme konusunu " +
    "platformun kendi adımına bırak. Üçüncü tarafa ödeme bilgisi (otopark gişesi, taksi, restoran) yazılabilir.",
  contact:
    "Önceki taslak bu konuşmada Airbnb'nin ENGELLEDİĞİ içerik taşıyordu (telefon numarası, e-posta, web bağlantısı, WhatsApp / sosyal medya " +
    "ya da konuşmayı / rezervasyonu / ödemeyi platform dışına taşıma daveti). Airbnb böyle bir mesajı misafire ULAŞTIRMAZ. Aynı anlamı " +
    "bunlar OLMADAN yeniden yaz: iletişim için bu mesajlaşmayı öner; bağlantı yerine yerin adını ya da adresini yaz.",
  apology:
    "Önceki taslak özür / üzüntü / kusur kabulü / telafi sözü içeriyordu; ev sahibi adına bu yazılmaz. Aynı cevabı özürsüz ve nötr yaz: " +
    "sorunun kendisi hakkında yorum yapma, yalnız cevaplanabilir soruyu cevapla.",
};

export function seniorRewriteNotes(reasons: readonly SeniorRewriteReason[]): string[] {
  return reasons.map((r) => SENIOR_REWRITE_NOTES[r]);
}
