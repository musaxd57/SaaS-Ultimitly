// ---------------------------------------------------------------------------
// EVAL TARAFI — ÜRÜN DEDEKTÖRÜNÜN TEK KAYNAĞINA BAĞLIDIR (09-11).
//
// 🚨 KOPYA YAZMA. Bu dosya bilerek yalnız yeniden-dışa-aktarımdır: eval'in
// "bilgi yokluğunu söylüyor mu" ölçütü ile ürünün GÖNDERİM KAPISI aynı yüklemi
// kullanmak ZORUNDA. Ayrı listeler tutulsaydı eval, ürünün göndermediği bir
// cevabı "geçti" sayabilir ya da tersi olabilirdi — ve bu tam olarak 09-11 öncesi
// durumdu: aynı liste İKİ eval harness'ında ayrı yazılmıştı ve BİRİ BAYATTI
// (QR tarafı yalnız Türkçe kalıp taşıyordu).
//
// Ürün tarafı: `src/lib/ai/absence.ts` (kurucu kuralı: "bilgim yok" misafire gitmez).
// ---------------------------------------------------------------------------
export { ABSENCE_CONTRACT_NOTE, admitsMissingKnowledge } from "@/lib/ai/absence";
export { admitsMissingKnowledge as acknowledgesAbsence } from "@/lib/ai/absence";
