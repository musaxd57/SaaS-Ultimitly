import "server-only";

import { redactSensitive } from "@/lib/report-error";
import { redactNameFromBody } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// ANLAM KATMANI REDAKSİYONU — tarih ve saati KORUYAN sarmal (inceleme 09-24).
//
// `redactSensitive` telefon kalıbıyla "12.10.2026" / "2026-10-12" gibi TARİHLERİ de `[PHONE]` yapıyor
// (ölçüldü) → "o tarih boş mu?" sorusu bekçi ve anlama katmanı için okunmaz oluyordu; oysa bu katmanın
// işi tam olarak tarih/saat anlamaktır. Tarih ve saat biçimleri redaksiyondan ÖNCE yer tutucuya alınır,
// sonra geri konur. Telefon/e-posta/uzun kod yine redakte edilir; bilinen adlar önce silinir.
// ⚠️ 4 haneli kodlar ve harf-rakam karışık kodlar `redactSensitive` tarafından redakte EDİLMEZ — bu
// katman onları "redakte" diye belgelemez (işleyen aynı: cevap istemi bu içeriği zaten taşıyor).
// ---------------------------------------------------------------------------

/** Korunacak biçimler: ISO tarih, gün.ay.yıl, gün/ay/yıl, gün-ay-yıl, saat (HH:MM / H.MM). */
const PROTECT = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}[:.]\d{2}\b/g;

export function redactForSemanticModel(text: string, names: readonly string[]): string {
  const kept: string[] = [];
  const masked = redactNameFromBody(text, [...names]).replace(PROTECT, (m) => {
    kept.push(m);
    return `⁣KEEP${kept.length - 1}⁣`;
  });
  return redactSensitive(masked).replace(/⁣KEEP(\d+)⁣/g, (_, i: string) => kept[Number(i)] ?? "");
}
