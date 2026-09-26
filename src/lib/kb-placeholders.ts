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
  // "misafir". ⚠️ Yalnız TAM eşleşme — ve bu eşleşme İLK SÖZCÜĞE bakar: "Misafir Ahmet"
  // de `null` döner (7. tur incelemesi: eski yorum "…gerçek bir addır ve KORUNUR" diyordu,
  // KODLA ÇELİŞİYORDU ve dosyanın kendi testi tersini pinliyor). Yön güvenli: sağlayıcı
  // "Misafir" ön ekini yer tutucu olarak kullandığında hitap nötr kalır.
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
 * adlarında "2+1", "3+1", "2. kat" normdur → "Lale 3 | 2+1 Deniz Manzaralı" → **"1"**,
 * "Daire 5 - 2 Yatak Odalı" → **"2"**, "Lale 12 (2. kat)" → **"2"**. Misafire YANLIŞ
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
/**
 * Kendi sayısını ALABİLEN sayaçlar — KONUM etiketleri. "Daire 5 **Kat 2**"de "Kat" bir
 * modifikatör değil, KENDİ numarası olan ikinci bir etikettir; "5" doğru cevaptır.
 *
 * 🚨 LİSTE DAR TUTULUR — push öncesi inceleme ÖLÇTÜ: kaçış TÜM sayaçlara verilince
 * ardışık iki ölçü taşıyan adlarda KAPASİTE sayısı daire numarası olarak dönüyordu
 * ("Daire 4 **Kişilik 2** Odalı" → "4"): "Kişilik"in ardındaki 2, "Odalı"ya aittir,
 * yeni bir etiket DEĞİLDİR. 10 gerçekçi adın 10'unda misafire UYDURMA daire numarası
 * (ve "Kapı kodu: 4") söyleniyordu. KAPASİTE sayaçları bu kaçışı ALMAZ.
 */
const COUNTER_TAKING_OWN_NUMBER = new Set(["kat", "floor"]);

function followedByCounter(form: string, from: number): boolean {
  const m = /^[^\p{L}\p{N}]*(\p{L}+)([^\p{L}\p{N}]*)(\d)?/u.exec(form.slice(from));
  if (!m || !COUNTER_AFTER_NUMBER.has(m[1])) return false;
  // Sayaç KENDİ SAYISINI alıyorsa modifikatör değil YENİ ETİKETTİR — ama yalnız KONUM
  // etiketleri için (↑). 6. tur bu ayrımı yapmadan kaçışı taşıdı ve kanonik Türk adresini
  // yok etti ("No:12 D:5 Kat:3" → null, doğrusu 5); kaçışı tüm sayaçlara vermek ise
  // kapasite adlarında uydurma numara üretiyordu.
  if (m[3] === undefined) return true; // sayacın kendi sayısı yok → önündeki sayıyı niteler
  return !COUNTER_TAKING_OWN_NUMBER.has(m[1]); // kendi sayısı var: yalnız KONUM etiketi yeni etikettir
}

/**
 * Sayıdan ÖNCE gelen SAYAÇ sözcükleri — İngilizce ilan başlıklarında sayaç genellikle
 * sayının SOLUNDADIR ("Cozy Studio **Sleeps 4**", "Villa **for** 6") ve 6. turun
 * yalnız-sağa bakan kontrolü bu biçimi HİÇ görmüyordu (ölçüldü: kapasite sayısı
 * misafire "Daireniz 4" olarak gidiyordu). DAR liste: yalnız kapasite bildiren sözcükler.
 */
const COUNTER_BEFORE_NUMBER = new Set(["sleeps", "sleep", "for", "kapasite", "kapasitesi"]);

function precededByCounter(form: string, upto: number): boolean {
  const m = /(\p{L}+)[^\p{L}\p{N}]*$/u.exec(form.slice(0, upto));
  return !!m && COUNTER_BEFORE_NUMBER.has(m[1]);
}

export function apartmentNumberOf(propertyName: string): string | null {
  // 🚨 SAYAÇ ve HANE kuralları ETİKETLİ yolda da çalışır (inceleme turu 6, ÖLÇÜLDÜ): eskiden
  // etiket eşleşince ANINDA dönülüyordu, yani "Sahilde Daire 6 Kişilik" → "6" (kapasite) ve
  // "Lale Rezidans No 2024" → "2024" (yıl) misafire UYDURMA numara olarak gidiyordu. Aynı adın
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
    if (at < 0) continue;
    if (followedByCounter(form, at + only.length)) return null;
    if (precededByCounter(form, at)) return null;
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
  return text.replace(
    new RegExp(TOKEN.source, "gu"),
    (whole, key: string) => resolveGuestPlaceholder(key, values) ?? whole,
  );
}

/**
 * TEK bir `{…}` anahtarının karşılığı — çözülemiyorsa `null` (belirteç DOKUNULMAZ):
 * tanınmayan belirteç ("{kod}"), değeri verilmeyen sınıf VE belirsiz daire numarası
 * (mülk adında birden çok sayı). Yanlış numara söylemektense belirteç kalsın.
 *
 * 🚨 Neden AYRI export: inbox'ın şablon uygulama yolu `{{çiftParantez}}` sınıfını
 * KENDİ tek geçişinde çözmek ZORUNDA — ikame edilen metin bir daha TARANMAZ, çünkü
 * `{{guestName}}` değeri misafirin kontrolündedir (sağlayıcıdaki görünen ad) ve
 * ikinci bir tarama o değerin içinden YENİ belirteç uydurabilirdi. O yol bu modülün
 * `fillGuestPlaceholders`'ını ikinci bir geçiş olarak çağıramaz; anahtar çözümünü
 * buradan alır, geçişi kendi yapar. Kural yine TEK YERDE yaşar.
 */
export function resolveGuestPlaceholder(key: string, values: GuestPlaceholderValues): string | null {
  const { guestFirstName, propertyName } = values;
  const kind = keyKind(key);
  if (kind === "name" && guestFirstName !== undefined) return guestFirstName;
  if (kind === "apartment" && propertyName !== undefined) return apartmentNumberOf(propertyName);
  return null;
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

/* ---------------------------------------------------------------------------
 * DOLDURULMAMIŞ ALAN TESPİTİ.
 *
 * 🚨 `@/lib/ai/prompts` DEĞİL BURADA (09-11): o dosya `import "server-only"`
 * taşıyor, yani bir İSTEMCİ bileşeni onu import EDEMEZ. Bilgi Tabanı ekranı
 * (client) kaleme "Doldurulmamış alan" rozeti basabilmek için aynı yükleme
 * ihtiyaç duyuyor ve rozet ile GERÇEK gönderim davranışı ayrışmamalı → yüklem
 * saf modüle taşındı, üç tüketici de (istem notu · gönderici kapısı · rozet)
 * AYNI kaynaktan okur.
 * ------------------------------------------------------------------------- */

/**
 * `[ŞİFRE]`, `<adres>`, `____` sınıfı — host'un DOLDURMADIĞI alanlar.
 * `{isim}`/`{daire}` BİLEREK DIŞARIDA: onlar gönderim anında çözülür.
 * İçinde en az bir HARF şart: "[1]" madde imi yer tutucu değildir.
 *
 * 🚨 REGEX DEĞİL, DOĞRUSAL TARAYICI (09-23 denetimi, ölçüldü). Eski gerçekleme
 * `/\[[^\]\n]*\p{L}[^\]\n]*\]|<[^>\n]*\p{L}[^>\n]*>|_{3,}/gu` idi: iki sınırsız
 * olumsuz sınıf arasında ZORUNLU bir harf → kapanışsız her açılışta bütün bölünme
 * noktaları denenir, O(n³). "[ş" tekrarı 3.000 karakterde 8,1 sn; KB kalemi 20.000
 * karaktere kadar kabul edildiği için ~40 DAKİKA tek iş parçacığı donması — ve bu
 * yüklem halka açık QR yolunda (istem paketleme) koşuyor. Anlam BİREBİR aynı:
 *   · `[`/`<` açılışından İLK kapanışa (`]`/`>`) kadar; arada satır sonu varsa eşleşme yok
 *     (içte başka açılış serbest: "[ab[cd]" tek belirteç),
 *   · aralıkta en az bir harf (`\p{L}`, BMP dışı vekil çift dahil),
 *   · eşleşmeyen açılışta bir sonraki karakterden devam (regex'in soldan tarama sırası),
 *   · `_{3,}` ardışık alt çizgi koşusu.
 * Eşdeğerlik eski regex KÂHİN alınarak tohumlu rastgele testle pinli
 * (`tests/unit/kb-placeholder-redos.test.ts`). Her açılış için kapanış aramasını
 * yeniden yapmamak üzere tür başına "bilinen durak" ileri gider → toplam O(n).
 */
const LETTER = /\p{L}/u;
export function kbPlaceholderTokens(content: string): string[] {
  const n = content.length;
  // nextLetter[i] = i'den itibaren ilk harfin BAŞLADIĞI indeks (yoksa n). BMP dışı harf
  // vekil çiftin YÜKSEK yarısında işaretlenir (`codePointAt` orada çifti tek kod noktası
  // okur); düşük yarı tek başına harf değildir — aralık kontrolü çiftin tamamını kapsar.
  const nextLetter = new Int32Array(n + 1);
  nextLetter[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    nextLetter[i] = LETTER.test(String.fromCodePoint(content.codePointAt(i)!)) ? i : nextLetter[i + 1];
  }
  // Tür başına bilinen durak: son hesaplanan (kapanış | satır sonu | son) konumu.
  const stop = { "[": -1, "<": -1 } as Record<"[" | "<", number>;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    const c = content[i];
    if (c === "[" || c === "<") {
      const close = c === "[" ? "]" : ">";
      if (stop[c] <= i) {
        let j = i + 1;
        while (j < n && content[j] !== close && content[j] !== "\n") j++;
        stop[c] = j;
      }
      const j = stop[c];
      if (j < n && content[j] === close && nextLetter[i + 1] < j) {
        out.push(content.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "_") {
      let j = i;
      while (j < n && content[j] === "_") j++;
      if (j - i >= 3) out.push(content.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return out;
}
