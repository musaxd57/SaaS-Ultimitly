import "server-only";

import { redactSensitive } from "@/lib/report-error";
import { redactNameFromBody } from "@/lib/data-retention";

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

/** Rakamla başlayıp rakamla biten, arada yalnız rakam/boşluk/ayraç taşıyan dizi (telefon kalıbının üst kümesi). */
const NUMERIC_RUN = /\+?\d[\d\s().:/-]*\d/g;
const DATE_YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const DATE_DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/;
const TIME = /^(\d{1,2})[:.](\d{2})$/;

function between(n: number, lo: number, hi: number): boolean {
  return n >= lo && n <= hi;
}

/** Tek parça geçerli bir tarih ya da saat mi (alan aralıkları dahil — "56.78" saat DEĞİL). */
export function isDateOrTimeToken(part: string): boolean {
  let m = DATE_YMD.exec(part);
  if (m) return between(+m[2], 1, 12) && between(+m[3], 1, 31);
  m = DATE_DMY.exec(part);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // Gün.ay ya da ay/gün (ABD) — ikisinden biri ay olabilmeli.
    return between(a, 1, 31) && between(b, 1, 31) && (a <= 12 || b <= 12);
  }
  m = TIME.exec(part);
  if (m) return +m[1] <= 24 && +m[2] <= 59;
  return false;
}

/**
 * BİTİŞİK ARALIK: tek bir "-" ya da "/" ile birleşmiş İKİ geçerli tarih/saat ("10.00-12.00", "14.10-16.10",
 * "12.10.2026-14.10.2026", "2026-10-14/2026-10-16"). Son denetim (09-24): dizi bazlı koruma bunları tek parça
 * görüp `[PHONE]` yapıyordu — tam da bu katmanın anlaması gereken "şu saatler arası / şu tarihler arası".
 * Tam olarak iki taraf şart: "0171-12-34-56" · "12-34-56-78-90" · "12.34-56.78" (56 saat değil) yine korunmaz.
 */
function isCompactRange(part: string): boolean {
  for (const sep of ["-", "/"]) {
    const sides = part.split(sep);
    if (sides.length === 2 && sides.every(isDateOrTimeToken)) return true;
  }
  return false;
}

/**
 * Dizi korunur mu: boşlukla ayrılan rakamlı parçaların HEPSİ tarih/saat (ya da bitişik tarih/saat aralığı) ya da
 * (en fazla BİR tane) 1–3 haneli yalın sayı; en az bir tarih/saat. Başka her şey (4+ haneli grup, "+33", çok
 * parçalı noktalı dizi) → hayır.
 */
export function isProtectedNumericRun(run: string): boolean {
  let dateTime = 0;
  let small = 0;
  for (const part of run.split(/\s+/)) {
    if (!/\d/.test(part)) continue; // yalnız ayraç ("-") olan parça: tarih aralığı "12.10.2026 - 14.10.2026"
    if (isDateOrTimeToken(part) || isCompactRange(part)) dateTime += 1;
    else if (/^\d{1,3}$/.test(part)) small += 1;
    else return false;
  }
  return dateTime > 0 && small <= 1;
}

export function redactForSemanticModel(text: string, names: readonly string[]): string {
  const kept: string[] = [];
  const masked = redactNameFromBody(text.replace(MARK_RE, ""), [...names]).replace(NUMERIC_RUN, (run) => {
    if (!isProtectedNumericRun(run)) return run;
    kept.push(run);
    return `${MARK}KEEP${kept.length - 1}${MARK}`;
  });
  return redactSensitive(masked).replace(PLACEHOLDER_RE, (_, i: string) => kept[Number(i)] ?? "");
}
