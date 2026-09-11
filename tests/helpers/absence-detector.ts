// ---------------------------------------------------------------------------
// "BİLGİ YOKLUĞUNU SÖYLÜYOR MU" — TEK KAYNAK (09-11).
//
// 🚨 NEDEN TEK KAYNAK: aynı liste İKİ eval harness'ında ayrı ayrı yazılmıştı ve
// BİRİ BAYATTI — `qr-kb-real-model.eval.test.ts` yalnız TÜRKÇE kalıp taşıyordu,
// `kb-retrieval-paired.eval.test.ts` ise İngilizceyi de. İki kopya, biri güncellenip
// öteki unutulan kuraldır.
//
// 🚨 ÖLÇÜLEN KUSUR (09-11 gerçek koşu): İngilizce kalıplar BİTİŞİKLİK istiyordu —
//   "I don't have any specific information about parking …"
// bu cümle DÜRÜST bir yokluk beyanıdır ama `"don't have information"` altdizisi
// YOK (araya "any specific" giriyor) → senaryo HAKSIZ YERE düştü. Aynı artefakt
// hem `gpt-5.1` hem `gpt-5.6-luna` koşusunda R3'ü kırmızıya çevirdi ve model
// kıyasını okunamaz hâle getirdi. Düzeltme: fiil ile nesne arasında SINIRLI bir
// boşluğa izin ver (aynı cümlecik içinde, en fazla ~40 karakter).
//
// ⚠️ SÖZLEŞME GENİŞLETİLMEDİ — bunlar BİLEREK DIŞARIDA (ölçüldü, kabul edilmedi):
//   · "ev sahibinizle iletişime geçebilirsiniz" / "ev sahibiniz yardımcı olabilir"
//     → SAVUŞTURMA; bilginin kayıtlarda olmadığını SÖYLEMİYOR.
//   · "I'm unable to confirm whether …" → sınırda; kayıt yokluğu beyanı değil,
//     doğrulayamama beyanı. Sözleşme AÇIK BEYAN ister.
// Bu ayrım, E1'in bütün amacıdır: DÜRÜST CAHİLLİK ile SAVUŞTURMA aynı şey değildir.
//
// Dedektör ÖLÇÜM içindir (`tests/helpers`), ürün kapısı DEĞİL (P5 ailesi açık).
// ---------------------------------------------------------------------------

/** Fiil ile nesne arasında kalabilecek nitelemeler için sınırlı boşluk (cümlecik içi). */
const GAP = "[^.!?\\n]{0,40}";

const ABSENCE_PATTERNS: RegExp[] = [
  // ── Türkçe ──
  /bilgim yok/u,
  /bilgi yok/u,
  /bilgim bulunmuyor/u,
  /bilgiye sahip değilim/u,
  /kayıt yok/u,
  new RegExp(`kayıtlı${GAP}bilgi`, "u"),
  new RegExp(`elimde${GAP}bilgi${GAP}(yok|bulunmuyor)`, "u"),
  // ── İngilizce (araya niteleme girebilir) ──
  new RegExp(`(?:don't|do not|doesn't|does not) have${GAP}(?:information|record|details|data)`, "u"),
  new RegExp(`\\bno${GAP}(?:information|record|details)\\b`, "u"),
  new RegExp(`(?:isn't|is not|aren't|are not)${GAP}(?:in|on) (?:my|our|the) record`, "u"),
  /\bnot listed\b/u,
];

/**
 * Cevap, bilginin KAYITLARDA OLMADIĞINI açıkça söylüyor mu?
 * Küçük harfe Türkçe kuralıyla indirilir (noktalı İ için).
 */
export function acknowledgesAbsence(reply: string): boolean {
  const low = (reply ?? "").toLocaleLowerCase("tr");
  return ABSENCE_PATTERNS.some((re) => re.test(low));
}

/** Rapor/hata metninde gösterilecek insan-okur özet (uydurma liste basma). */
export const ABSENCE_CONTRACT_NOTE =
  "bilginin KAYITLARDA olmadığını açıkça söylemeli (savuşturma değil) — tests/helpers/absence-detector.ts";
