// ---------------------------------------------------------------------------
// HOST ŞABLONU YER TUTUCULARI — TEK KAYNAK (09-10). Saf, DB'siz, yan etkisiz.
//
// Host bilgi tabanına / karşılama şablonuna `{isim}` ve `{daire}` yazabilir
// (Ayarlar ekranı bunu açıkça öneriyor). Bu belirteçler modele GİRMEDEN ÖNCE
// çözülür; çözülmezse misafire ham "{isim}" gider.
//
// 🚨 NEDEN TEK MODÜL: aynı ikame ÜÇ yerde ayrı ayrı yazılmıştı (oto-yanıt
// göndericisi, inbox `ai-suggest` rotası, Gönderilenler önizlemesi) ve
// DÖRDÜNCÜ yüzeyde — halka açık QR asistanında — HİÇ YOKTU (ölçüldü, 09-10).
// Kopya kural üç yerde güncellenip dördüncüde unutulan kuraldır.
//
// 🚨 QR'DA GERÇEK MİSAFİR ADI KULLANILMAZ: QR bağlantısı dairenin içinde asılıdır
// ve cihaz bağlaması konaklama başınadır — sohbeti açan kişi rezervasyon sahibi
// OLMAYABİLİR (eş, arkadaş, temizlik görevlisi). Rezervasyon sahibinin adını ona
// göstermek hem yanlış hitap hem PII sızıntısıdır → `GUEST_NAME_FALLBACK`.
// (Inbox/oto-yanıt yolunda muhatap KANITLI olarak rezervasyon sahibidir; orada
// gerçek ad kullanılır ve bu ayrım BİLİNÇLİDİR.)
//
// 🚨 YER TUTUCU GERÇEĞE DÖNÜŞMEZ: bu modül YALNIZ `{…}` ad/daire sınıfını çözer.
// `[ŞİFRE]` / `<adres>` / `___` sınıfı DOLDURULMAMIŞ ALANDIR ve `prompts.ts`
// `kbPlaceholderTokens` onu koddan "[NOT] DOLDURULMAMIŞ YER TUTUCU" diye
// işaretler — buraya EKLENMEZ (uydurma değer üretmek yasak).
// ---------------------------------------------------------------------------

/** Muhatabın rezervasyon sahibi olduğu KANITLI olmadığında kullanılan nötr hitap. */
export const GUEST_NAME_FALLBACK = "misafirimiz";

/**
 * Süslü parantezli TEK belirteç. Anahtar ADI ayrıca katlanır — `/i` bayrağı
 * Türkçe noktalı İ'yi katlamaz (ölçüldü: `{İSİM}` eski regex'te EŞLEŞMİYORDU) ve
 * tek bir katlama da yetmez: `toLocaleLowerCase("tr")` "İSİM"→"isim" verir ama
 * "ISIM"→"ısım"; standart katlama tersini yapar. `fallback.ts`teki İKİ KATLAMA
 * kuralının aynısı — yalnızca EŞLEŞME EKLER.
 */
const TOKEN = /\{\s*(\p{L}+)\s*\}/gu;
const NAME_KEYS = new Set(["isim", "ad", "name"]);
const APARTMENT_KEYS = new Set(["daire", "apartment", "apt"]);

function keyKind(raw: string): "name" | "apartment" | null {
  const forms = [raw.toLocaleLowerCase("tr"), raw.toLowerCase()];
  if (forms.some((f) => NAME_KEYS.has(f))) return "name";
  if (forms.some((f) => APARTMENT_KEYS.has(f))) return "apartment";
  return null;
}

/**
 * Selamlama için ilk ad — yer tutucu adlarda (`null`) gerçek ad YOKTUR.
 * Sağlayıcı, adı olmayan rezervasyonu "Rezervasyon 12345" / "Misafir" diye
 * verir; bunları ad sanmak misafire "Merhaba Rezervasyon," yazdırır.
 */
export function guestFirstNameOf(guestIdentifier: string | null | undefined): string | null {
  const first = (guestIdentifier ?? "").trim().split(/\s+/)[0];
  if (!first) return null;
  // ⚠️ BÜYÜK/KÜÇÜK HARFE DUYARLI DEĞİL (inceleme 09-10): sağlayıcı "rezervasyon 12345" (küçük)
  // yazdığında eski kontrol kaçırıyor ve misafire "Merhaba rezervasyon," gidiyordu. Türkçe
  // katlama şart: "MİSAFİR" → `toLowerCase()` ile "mi̇safir" olur, `toLocaleLowerCase("tr")` ile
  // "misafir". ⚠️ Yalnız TAM eşleşme: "Misafir Ahmet" gerçek bir addır ve KORUNUR.
  const folded = first.toLocaleLowerCase("tr");
  if (folded === "rezervasyon" || folded === "misafir") return null;
  return first;
}

/**
 * Misafire görünen daire numarası.
 *
 * SIRA: (1) "daire/no/apt/#" etiketinden SONRAKİ sayı — host niyetini AÇIKÇA yazmıştır;
 * (2) mülk adında TEK sayı varsa o; (3) birden çok sayı varsa İKAME YAPILMAZ (belirteç
 * görünür kalır). Sayı yoksa mülk adının kendisi döner.
 *
 * 🚨 "SON SAYI" KURALI YANLIŞ CEVAP ÜRETİYORDU (inceleme 09-10, ölçüldü): Türkiye ilan
 * adlarında "2+1", "3+1", "2. kat" normdur → "Nuve 3 | 2+1 Deniz Manzaralı" → **"1"**,
 * "Daire 5 - 2 Yatak Odalı" → **"2"**, "Nuve 12 (2. kat)" → **"2"**. Misafire YANLIŞ
 * daire numarası söyleniyor ve hiçbir sinyal üretilmiyordu. Belirsizde susmak, uydurmaktan
 * iyidir (`null` → çağıran belirteci dokunulmadan bırakır).
 */
export function apartmentNumberOf(propertyName: string): string | null {
  const labelled = /(?:daire|apart?ment|apt|no|#)\s*[:.]?\s*(\d+)/i.exec(propertyName);
  if (labelled) return labelled[1];
  const nums = propertyName.match(/\d+/g);
  if (!nums) return propertyName;
  return nums.length === 1 ? nums[0] : null;
}

/** Metinde ad yer tutucusu var mı (host kendi selamlamasını yazmış mı)? */
export function hasNamePlaceholder(text: string): boolean {
  // Taze regex (global bayrak PAYLAŞILMAZ) → `lastIndex` tuzağı yok.
  for (const m of text.matchAll(new RegExp(TOKEN.source, "gu"))) {
    if (keyKind(m[1]) === "name") return true;
  }
  return false;
}

export interface GuestPlaceholderValues {
  /** Çözülmüş ad (QR'da `GUEST_NAME_FALLBACK`). Verilmezse `{isim}` DOKUNULMAZ. */
  guestFirstName?: string;
  /** Mülk adı; `{daire}` bundan türetilir. Verilmezse `{daire}` DOKUNULMAZ. */
  propertyName?: string;
}

/**
 * `{isim}`/`{ad}`/`{name}` → ad, `{daire}`/`{apartment}`/`{apt}` → daire numarası.
 *
 * 🚨 İKAME CALLBACK İLE (CLAUDE.md kuralı: "TEK GEÇİŞ `replace` + callback"):
 * düz string ikamesinde değerdeki `$&`/`$1`/`` $` ``/`$$` kalıpları ÖZEL anlam
 * kazanır ve misafirin kendi metnini bozar. Değer verilmeyen sınıf DOKUNULMAZ:
 * yanlış bir değer uydurmaktansa belirteç görünür kalsın.
 */
export function fillGuestPlaceholders(text: string, values: GuestPlaceholderValues): string {
  const { guestFirstName, propertyName } = values;
  if (guestFirstName === undefined && propertyName === undefined) return text;
  const apt = propertyName === undefined ? null : apartmentNumberOf(propertyName);
  return text.replace(new RegExp(TOKEN.source, "gu"), (whole, key: string) => {
    const kind = keyKind(key);
    if (kind === "name" && guestFirstName !== undefined) return guestFirstName;
    if (kind === "apartment" && apt !== null) return apt;
    // Tanınmayan belirteç ("{kod}"), değeri verilmeyen sınıf VE belirsiz daire numarası
    // (mülk adında birden çok sayı) DOKUNULMAZ — yanlış numara söylemektense belirteç kalsın.
    return whole;
  });
}

/** Bir KB kalemi listesinin içeriğini toplu çözer (kalemin diğer alanları AYNEN kalır). */
export function fillGuestPlaceholdersInItems<T extends { content: string }>(
  items: T[],
  values: GuestPlaceholderValues,
): T[] {
  return items.map((k) => ({ ...k, content: fillGuestPlaceholders(k.content, values) }));
}
