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
  // 🚨 İKİ KATLAMA (inceleme turu 6, ÖLÇÜLDÜ): tek `toLocaleLowerCase("tr")` ASCII yazımı
  // kaçırıyordu — "MISAFIR" → tr katlamada "mısafır", eşleşmiyor, misafire "Merhaba MISAFIR,"
  // gidiyordu. Dosyanın kendi kuralı (keyKind/foldedForms/etiket dalı) zaten tr + standart çifti.
  const folded = [first.toLocaleLowerCase("tr"), first.toLowerCase()];
  if (folded.some((f) => f === "rezervasyon" || f === "misafir")) return null;
  return first;
}

/**
 * Etiket eşleşmesi — KELİME BAŞINDA olmalı.
 *
 * 🚨 `/i` YETMİYORDU, İKİ AYRI KUSUR (inceleme 09-11, ölçüldü):
 * (a) `/i` Türkçe noktalı İ'yi KATLAMAZ → "DAİRE 5 - 2 Yatak Odalı" etiket dalına HİÇ
 *     girmiyordu ve iki sayılı ada düşüp `null` dönüyordu (host açıkça "DAİRE 5" yazmışken).
 *     Çözüm `keyKind`teki İKİ KATLAMA kuralının aynısı (tr + standart).
 * (b) Etiketler kelime sınırsızdı → "no" BAŞKA kelimenin içinde yakalanıyordu:
 *     "Milano 12 | Daire 3" → **"12"** (doğrusu 3). Öndeki sınır şartı bunu eler.
 * Not: sondaki sınır BİLİNÇLİ YOK — "Daire 5A" gibi adlarda "5" dönmeye devam eder.
 */
const APARTMENT_STRONG_LABEL = /(?<![\p{L}\p{N}])(?:daire|apart?ment|apartman|apt|d(?=\s*[:.]))\s*[:.]?\s*(\d+)/u;
/**
 * ZAYIF etiketler — "no"/"#" bir BİNA numarasını da gösterebilir. 🚨 ÖNCELİK ŞART
 * (inceleme turu 5, ölçüldü): "No:12 D:5" → eski tek regex ilk eşleşmeyi alıp **"12"**
 * (bina) diyordu; doğrusu "5". Güçlü etiket önce denenir. "d" YALNIZ iki nokta/nokta ile
 * ("D:5") — çıplak "d 5" bir kısaltma değil, rastgele harftir.
 */
const APARTMENT_WEAK_LABEL = /(?<![\p{L}\p{N}])(?:no|#)\s*[:.]?\s*(\d+)/u;

/**
 * Sayıdan SONRA gelen SAYAÇ sözcükleri — o sayı daire numarası DEĞİL, kapasite/ölçüdür.
 * Yalnız ölçülen sınıf (kişi/yatak/oda/kat/banyo/metre); liste dar tutulur, her girdi pinli.
 */
// ⚠️ "m2" girdisi ÇIKARILDI: yakalama grubu `(\p{L}+)` yalnız HARF alır, yani `has("m2")`
// hiçbir girdide true olamazdı (ölçüldü, ölü kod). "m" tek harfi bilinçli EKLENMEDİ (çok geniş).
// 🚨 İNGİLİZCE EKSİKTİ (inceleme turu 6, ÖLÇÜLDÜ): etiket dalı `apart?ment|apt` ile İngilizceyi
// kabul ediyordu ama sayaç listesi TR-only'ydi → "Luxury 2 Bedroom Flat" misafire "Daireniz 2"
// diyordu (15 gerçekçi İngilizce adın 15'i yanlış numara üretti).
const COUNTER_AFTER_NUMBER = new Set([
  "kişilik", "kisilik", "kişi", "kisi", "misafir", "yatak", "yataklı", "yatakli",
  "odalı", "odali", "oda", "kat", "katlı", "katli", "banyolu", "banyo",
  "metre", "metrekare", "dönüm", "donum", "adet", "gece",
  // İngilizce ilan sözcükleri
  "bedroom", "bedrooms", "bed", "beds", "bath", "baths", "bathroom", "bathrooms",
  "guest", "guests", "person", "people", "sleeps", "room", "rooms", "floor",
  "sqm", "night", "nights",
]);

/** Mülk adının iki katlanmış biçimi (`keyKind` ile aynı sözleşme; yalnız EŞLEŞME EKLER). */
function foldedForms(s: string): string[] {
  const tr = s.toLocaleLowerCase("tr");
  const std = s.toLowerCase();
  return tr === std ? [tr] : [tr, std];
}

/**
 * Misafire görünen daire numarası.
 *
 * SIRA: (1) GÜÇLÜ etiketten ("daire/apartment/apt/D:") sonraki sayı → (2) ZAYIF etiketten
 * ("no/#") sonraki sayı — host niyetini AÇIKÇA yazmıştır; (3) mülk adında TEK sayı varsa o;
 * (4) birden çok sayı varsa İKAME YAPILMAZ (belirteç görünür kalır).
 *
 * 🚨 SAYI YOKSA `null` (inceleme turu 5 — eskiden MÜLK ADININ TAMAMI dönüyordu ve ikame
 * doğrudan yapılıyordu): "Cozy Seaside Flat" adlı bir mülkte KB'deki "Kapı kodu: {daire}"
 * satırı misafire **"Kapı kodu: Cozy Seaside Flat"** olarak gidiyordu. Belirtecin görünür
 * kalması, anlamsız bir ikameden iyidir (modülün kendi kuralı).
 *
 * 🚨 "SON SAYI" KURALI YANLIŞ CEVAP ÜRETİYORDU (inceleme 09-10, ölçüldü): Türkiye ilan
 * adlarında "2+1", "3+1", "2. kat" normdur → "Nuve 3 | 2+1 Deniz Manzaralı" → **"1"**,
 * "Daire 5 - 2 Yatak Odalı" → **"2"**, "Nuve 12 (2. kat)" → **"2"**. Misafire YANLIŞ
 * daire numarası söyleniyor ve hiçbir sinyal üretilmiyordu. Belirsizde susmak, uydurmaktan
 * iyidir (`null` → çağıran belirteci dokunulmadan bırakır).
 *
 * 🚨 TEK SAYI DA TEK BAŞINA YETMİYOR (inceleme 09-11, ölçüldü): "Trabzon 4 Kişilik Daire"
 * → **"4"** (kapasite) ve "2024 Yılı Dairesi" → **"2024"** (yıl) misafire UYDURMA daire
 * numarası söylüyordu. İki dar kural: sayıyı bir SAYAÇ sözcüğü izliyorsa ve sayı 3 haneden
 * uzunsa (yıl/metrekare sınıfı; Türkiye'de daire numarası pratikte ≤3 hane) İKAME YAPILMAZ.
 * Bedeli açık ve GÜVENLİ YÖNDE: gerçekten 4 haneli bir daire numarası varsa belirteç
 * görünür kalır — yanlış numara söylemekten iyidir.
 */
/**
 * Sayıyı HEMEN izleyen sözcük bir SAYAÇ mı? (araya başka RAKAM girerse BAKILMAZ)
 *
 * 🚨 ÇAPA ŞART (inceleme turu 6): "Daire 5 - 2 Yatak Odalı"da "5" doğru cevaptır; çapasız
 * arama ("5"ten sonraki ilk harf öbeği) "yatak"ı bulup satırı düşürürdü. `[^\p{L}\p{N}]*`
 * yalnız harf-olmayan VE rakam-olmayan karakterleri yutar → araya "2" girince eşleşme yok.
 */
function followedByCounter(form: string, from: number): boolean {
  const m = /^[^\p{L}\p{N}]*(\p{L}+)/u.exec(form.slice(from));
  return !!m && COUNTER_AFTER_NUMBER.has(m[1]);
}

export function apartmentNumberOf(propertyName: string): string | null {
  // 🚨 SAYAÇ ve HANE kuralları ETİKETLİ yolda da çalışır (inceleme turu 6, ÖLÇÜLDÜ): eskiden
  // etiket eşleşince ANINDA dönülüyordu, yani "Sahilde Daire 6 Kişilik" → "6" (kapasite) ve
  // "Nuve Rezidans No 2024" → "2024" (yıl) misafire UYDURMA numara olarak gidiyordu. Aynı adın
  // etiketsiz hâli doğru davranıyordu — ölçülen asimetri. Hane sınırı yalnız ZAYIF etikette
  // ("no/#" bina numarası da olabilir); GÜÇLÜ etikette ("Daire 1203") host niyeti açıktır.
  for (const [label, weak] of [[APARTMENT_STRONG_LABEL, false], [APARTMENT_WEAK_LABEL, true]] as const) {
    for (const form of foldedForms(propertyName)) {
      const labelled = label.exec(form);
      if (!labelled) continue;
      const num = labelled[1];
      if (weak && num.length > 3) return null;
      if (followedByCounter(form, labelled.index + labelled[0].length)) return null;
      return num;
    }
  }
  const nums = propertyName.match(/\d+/g);
  if (!nums) return null;
  if (nums.length !== 1) return null;
  const only = nums[0];
  if (only.length > 3) return null;
  for (const form of foldedForms(propertyName)) {
    const at = form.indexOf(only);
    if (at >= 0 && followedByCounter(form, at + only.length)) return null;
  }
  return only;
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
/**
 * 🚨 BAŞLIK da çözülür (inceleme turu 6, ÖLÇÜLDÜ): `packKnowledgeBase` isteme
 * `- [KATEGORİ] ${title}: ${content}` yazıyor, yani başlık MODELE gidiyor. Yalnız `content`
 * çözülünce host'un "Hoş geldiniz {isim}" başlığı ham belirteçle modele ulaşıyordu — 09-10'da
 * `content` için kapatılan sınıfın ta kendisi, başlıkta açık kalmıştı.
 */
export function fillGuestPlaceholdersInItems<T extends { title?: string; content: string }>(
  items: T[],
  values: GuestPlaceholderValues,
): T[] {
  return items.map((k) => ({
    ...k,
    ...(typeof k.title === "string" ? { title: fillGuestPlaceholders(k.title, values) } : {}),
    content: fillGuestPlaceholders(k.content, values),
  }));
}
