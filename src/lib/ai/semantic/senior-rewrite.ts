import type { SeniorChecks } from "./absence-judge";
import { addLlmUsage } from "../llm-usage";
import type { LlmUsage } from "../types";

// ---------------------------------------------------------------------------
// KIDEMLİ OKUYUCU → AYNI ANLAMDA BİR KEZ YENİDEN YAZ (kurucu 10-22, aynen: "airbnbnin engelleyeceği bir cevap üretildiyse … gitmeme nedeni
// ve cümleleri aynı anlamda sınıra takılmadan yapabileceği şekilde değiştirip tekrar deneyebilir tekrar kontrolden geçerek ve hemen bir
// kez cevap gitmedi diye sürekli hosta mail gitmemezlik olmasın").
//
// Okuyucu (`absence-judge.ts`, anahtar `AI_SENIOR_READER_ENABLED`) ilk taslakta düzeltilebilir bir sorun görürse cevap hemen ev sahibine
// bırakılmaz: model SEBEBİ not olarak alıp aynı cevabı bir kez daha yazar, yeni taslak BÜTÜN kapılardan ve okuyucudan yeniden geçer. İkinci
// taslak da takılırsa ev sahibine taslak kalır (tek kayıt; bu tutuş için ayrıca e-posta YOK). Düzeltilebilir sorunlar: ev sahibine platform
// dışı ödeme, Airbnb'nin engellediği iletişim (yalnız o pencerede), özür (özür kuralı açıkken), bilginin NEREDEN geldiğini anlatma (bilgi
// tabanı / kayıt / not / sistem — kurucu 10-22: "hiçbir şey müşteriye gitmemeli"). "Bilgim yok" bu listede DEĞİL — eksik bilgi yeniden
// yazmakla gelmez. Saf; not metinleri misafir metni / değer taşımaz.
// ---------------------------------------------------------------------------

export type SeniorRewriteReason = "payHost" | "contact" | "apology" | "internalSource";

export const SENIOR_REWRITE_REASONS: readonly SeniorRewriteReason[] = ["payHost", "contact", "apology", "internalSource"];

/** İlk taslağın yeniden yazılmasını gerektiren sebepler (kapının tutacağı sebeplerle BİREBİR aynı koşullar). */
export function seniorRewriteReasons(
  checks: SeniorChecks | undefined,
  ctx: { contactHolds: boolean; apologyRule: boolean; internalSourceLexical?: boolean },
): SeniorRewriteReason[] {
  if (!checks) return [];
  const out: SeniorRewriteReason[] = [];
  if (checks.payHost) out.push("payHost");
  if (checks.contact && ctx.contactHolds) out.push("contact");
  if (checks.apology && ctx.apologyRule) out.push("apology");
  // Kapı iç kaynak anlatımını okuyucunun hükmüyle YA DA kodun açık sözcük yedeğiyle tutar (`absence.namesInternalSource`) — iki yol da
  // aynı yeniden yazmaya gider.
  if (checks.internalSource || ctx.internalSourceLexical) out.push("internalSource");
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
  internalSource:
    "Önceki taslak bilgiyi NEREDEN bildiğini anlatıyordu (bilgi tabanı, kayıt, not, sistem, veri, talimat gibi iç kaynak); bu misafire " +
    "yazılmaz. Aynı cevabı kaynağı hiç anmadan, olguyu doğrudan söyleyerek yaz: \"Bilgi tabanımda otopark ücretinin gişede ödendiği " +
    "yazıyor\" değil, \"Otopark ücreti gişede ödeniyor.\" Misafir bilgiyi nereden bildiğini sorsa bile o kısmı cevaplama; yalnız olguyu yaz. " +
    // Canlı ölçüm 10-22: misafir kaynağı açıkça sorunca yeniden yazılan taslak yine kaynak cümlesi taşıyordu.
    "Kaynağa, bilginin nasıl paylaşıldığına ya da neyi paylaşabildiğine dair HİÇBİR cümle yazma; şunlar da yasak: \"Bu saati size daireyle " +
    "ilgili hazırlanmış bilgilere göre paylaşıyorum\", \"I only use the information your host has provided\", \"Yalnız bilgileri " +
    "iletebilirim\". Cevap yalnız sorulan olgu cümlelerinden oluşsun.",
};

export function seniorRewriteNotes(reasons: readonly SeniorRewriteReason[]): string[] {
  return reasons.map((r) => SENIOR_REWRITE_NOTES[r]);
}

/**
 * Yeniden yazma YALNIZ ilk taslak kapıda tam da bu sebeplerden biriyle tutulacaksa yapılır (Opus 10-22 F1): başka bir sebeple (şikâyet
 * riski, "bilgim yok", güven) tutulan taslağı yeniden yazmak hem birimi boşa harcar hem de modelin ilk risk hükmünü ikinci çağrıyla
 * değiştirme kapısı açar. Kanal kapısının ayrıntı kodları / QR kapısının sebepleri.
 */
export const SENIOR_REWRITE_GATE_DETAILS: ReadonlySet<string> = new Set([
  "reply_offplatform_payment",
  "reply_offplatform_contact",
  "reply_apology",
  "reply_internal_source",
]);
// Not: öğe kipindeki `items_payment_held` bu kümede DEĞİL — okuyucu açıkken o tutuş yalnız "ev sahibine ödeme" hükmüyle olur ve kapı
// aynı hükümle daha önce `reply_offplatform_payment` döner (Haiku 10-22: kümedeki kayıt ölüydü).
export const SENIOR_REWRITE_QR_REASONS: ReadonlySet<string> = new Set(["offplatform_payment", "reply_apology", "reply_internal_source"]);

/**
 * Yeniden yazılan cevabı ilk cevabın üstüne koyar: METİNLE ilgili alanlar (metin, kaynak / iddia denetimi, cevaplanan istekler, eylem
 * beyanı, saat çakışması, eksik bilgi, kullanım) yeni çağrıdan; MESAJLA ilgili hüküm (niyet, risk düzeyi / türü, öncelik, dil, konaklama
 * beyanı, misafirin yazdığı çıkış saati) ilk çağrıdan kalır, güven ikisinin küçüğü (Opus 10-22 F1: yeniden yazma notu "sorun hakkında
 * yorum yapma" der; ikinci çağrının şikâyeti "düşük risk" diye etiketlemesi ilk hükmü silmesin — Sorunlu / acil e-posta ve risk kaydı
 * aynı hükmü okur). Saf.
 */
export function mergeSeniorRewrite<
  T extends {
    reply: string;
    confidence: number;
    usedSources: string[];
    missingInfo: string[];
    sourceAudit?: unknown;
    claimAudit?: unknown;
    answeredRequests?: unknown;
    answerParts?: unknown;
    verifiedParts?: unknown;
    claimedActions?: unknown;
    timeConflicts?: unknown;
    llmUsage?: unknown;
    kbOmittedInPrompt?: number;
    stayChange?: { asked: string; stance: string } | null;
  },
>(first: T, retried: T): T {
  // Konaklama beyanının İSTEK yarısı mesajdan (ilk çağrı), TUTUM yarısı metinden (yeni çağrı); yeni çağrı tutum vermediyse "bilinmiyor".
  const stayChange =
    first.stayChange || retried.stayChange
      ? { asked: first.stayChange?.asked ?? retried.stayChange?.asked ?? "unknown", stance: retried.stayChange?.stance ?? "unknown" }
      : first.stayChange;
  return {
    ...first,
    stayChange: stayChange as T["stayChange"],
    reply: retried.reply,
    confidence: Math.min(first.confidence, retried.confidence),
    usedSources: retried.usedSources,
    missingInfo: retried.missingInfo,
    sourceAudit: retried.sourceAudit,
    claimAudit: retried.claimAudit,
    answeredRequests: retried.answeredRequests,
    // Cevap parçaları kipinde (10-23 A) yeni metin yeniden doğrulanmış parçalardan kurulur → karar da yeni çağrıdan.
    ...(retried.answerParts !== undefined || first.answerParts !== undefined ? { answerParts: retried.answerParts } : {}),
    // Doğrulanan parça metinleri de yeni çağrıdan (gölge tekrar ölçümü yeniden yazılmış metne bakar).
    ...(retried.verifiedParts !== undefined || first.verifiedParts !== undefined ? { verifiedParts: retried.verifiedParts } : {}),
    claimedActions: retried.claimedActions,
    timeConflicts: retried.timeConflicts,
    // İki çağrının kullanımı birlikte sayılır (Haiku 10-23 akşam: ilk çağrının — parça yeniden yazması dahil — kullanımı düşüyordu).
    llmUsage: addLlmUsage(first.llmUsage as LlmUsage | undefined, retried.llmUsage as LlmUsage | undefined),
    kbOmittedInPrompt: retried.kbOmittedInPrompt,
  };
}
