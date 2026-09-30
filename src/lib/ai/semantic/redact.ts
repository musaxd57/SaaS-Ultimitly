import "server-only";

import { redactSensitive } from "@/lib/report-error";
import { maskGuestIdentity, type TextAuthor } from "@/lib/ai/guest-identity-mask";
import { isDateOrTimeToken, isProtectedNumericRun, NUMERIC_RUN_SOURCE } from "./date-time-tokens";

// Testler ve eski çağıranlar için aynı adlarla (tek kaynak `date-time-tokens.ts`).
export { isDateOrTimeToken, isProtectedNumericRun };

// ---------------------------------------------------------------------------
// ANLAM KATMANI REDAKSİYONU — tarih ve saati KORUYAN sarmal (inceleme 09-24).
//
// `redactSensitive` telefon kalıbıyla "12.10.2026" / "2026-10-12" gibi TARİHLERİ de `[PHONE]` yapıyor
// (ölçüldü) → "o tarih boş mu?" sorusu bekçi ve anlama katmanı için okunmaz oluyordu; oysa bu katmanın
// işi tam olarak tarih/saat anlamaktır. Tarih ve saat redaksiyondan ÖNCE yer tutucuya alınır, sonra geri
// konur. Telefon/e-posta/uzun kod yine redakte edilir; bilinen adlar önce silinir.
//
// 🚨 KORUMA SAYI DİZİSİ BAZINDA (ikinci inceleme 09-24, ÖLÇÜLMÜŞ SIZINTI): ilk sürüm tarih/saat biçimli
// her PARÇAYI koruyordu ve noktalı/tireli yazılan telefonlar parça parça korunup redaksiyondan KAÇIYORDU:
// "06.12.34.56.78" (Fransız biçimi) = "06.12.34" tarih + "56.78" saat sanılıyordu; "0532.123.45.67",
// "0171-12-34-56", "12-34-56-78-90" de açıkta gidiyordu. Şimdi rakam + ayraçtan oluşan dizinin TAMAMI
// değerlendirilir: dizi yalnız geçerli tarih/saat parçalarından (en fazla bir küçük sayıyla: "14.10.2026 3
// kişi") oluşuyorsa korunur; aksi hâlde dizi olduğu gibi `redactSensitive`e bırakılır (fazla redaksiyon
// güvenli yöndür: tarihin hemen yanına yazılmış telefon tarihi de götürür).
// ⚠️ 4 haneli kodlar ve harf-rakam karışık kodlar `redactSensitive` tarafından redakte EDİLMEZ — bu
// katman onları "redakte" diye belgelemez (işleyen aynı: cevap istemi bu içeriği zaten taşıyor).
// ---------------------------------------------------------------------------

/** Yer tutucu işareti (görünmez ayırıcı). Girdideki aynı karakter önce silinir: taklit edilemez. */
const MARK = "⁣";
const MARK_RE = new RegExp(MARK, "g");
const PLACEHOLDER_RE = new RegExp(`${MARK}KEEP(\\d+)${MARK}`, "g");

/**
 * Anlam katmanına giden metin: ad YALNIZ kimlik konumunda maskelenir (kurucu kararı 09-30, `guest-identity-mask.ts` — "Deniz
 * manzarası" / "15 Nisan" artık silinmez), tarih / saat korunur, telefon / e-posta / uzun kod redakte edilir. `author` = metnin
 * yazarı: misafir (varsayılan) ya da biz (taslak, ev sahibi teklifi, giden geçmiş satırı).
 */
export function redactForSemanticModel(text: string, names: readonly string[], author: TextAuthor = "guest"): string {
  const kept: string[] = [];
  const masked = maskGuestIdentity(text.replace(MARK_RE, ""), names, author).replace(new RegExp(NUMERIC_RUN_SOURCE, "g"), (run) => {
    if (!isProtectedNumericRun(run)) return run;
    kept.push(run);
    return `${MARK}KEEP${kept.length - 1}${MARK}`;
  });
  return redactSensitive(masked).replace(PLACEHOLDER_RE, (_, i: string) => kept[Number(i)] ?? "");
}
