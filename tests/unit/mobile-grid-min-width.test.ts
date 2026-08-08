import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// TELEFONDA YATAY KAYMA — `min-w-0` PİNİ
//
// SORUN (ÖLÇÜLDÜ, gerçek Chromium + KİLİTLİ layout viewport):
//   Grid çocukları varsayılan olarak `min-width: auto` alır → sütun, İÇERİĞİN
//   min-content genişliğinden DAHA DAR OLAMAZ. İçeride bölünemez tek parça bir
//   metin varsa (99 karakterlik iCal feed adresi, misafirin yapıştırdığı 114
//   karakterlik Airbnb linki) sütun o genişliğe kilitlenir ve TÜM SAYFA yatay
//   kayar. Ölçüm (390 px):
//       /properties/<id>  scrollWidth 757  (taşma +367)
//       /inbox/<id>       scrollWidth 560  (taşma +170)
//       /knowledge (360)  scrollWidth 376  (taşma +16)
//   `min-w-0` eklendikten sonra üçü de 360/390/414'te tam viewport genişliği.
//
// 🚨 İKİ YAYGIN YANILGI — BU YÜZDEN SINIF SİLİNMEMELİ:
//   1. "`truncate` zaten var, kısaltır" → HAYIR. `truncate` ancak kutu daralınca
//      devreye girer; sütun daralmayı reddettiği için hiç çalışmaz.
//   2. "Balonda `break-words` var, sarar" → HAYIR. `overflow-wrap: break-word`
//      satır kırma fırsatı ekler ama SPEC GEREĞİ min-content hesabına KATILMAZ
//      (katılan değer `anywhere`). Yani sütunun min-content'i yine tam URL
//      genişliğidir. `max-w-[90%]` de kurtarmaz: yüzdeler intrinsic
//      boyutlamada çözülmez.
//
// ⚠️ BU DOSYA BİR KAYNAK TARAMASIDIR — layout ÖLÇMEZ (jsdom düzen hesaplamaz).
//    Gerçek kanıt yukarıdaki tarayıcı ölçümüdür; burada yapılan iş, o ölçümü
//    üreten SINIFLARIN sessizce silinmesini engellemektir.
//
// 🚨 VACUOUS OLMAMA ÖNLEMİ — İKİ BAĞIMSIZ KATMAN. Hedef dosyaların yorumları
//    "min-w-0" kelimesini defalarca içeriyor; ham dosyada düz bir
//    `toContain("min-w-0")` araması KENDİ YORUMUYLA tatmin olurdu (font
//    pininde yaşanan hatanın aynısı).
//      1) ASIL koruma: iddia `className="..."` ÖZNİTELİĞİ üzerinden kurulur ve
//         sınıf kümesinde TAM eşleşme aranır. Yorum metni öznitelik olmadığı
//         için bu biçime hiç giremez. (ÖLÇÜLDÜ: eleyici bilerek devre dışı
//         bırakılıp sınıf silindiğinde test YİNE kırmızı kaldı.)
//      2) KUŞAK+ASKI: kaynak ayrıca yorumlardan arındırılır — ileride biri
//         iddiayı ham metne çevirirse tuzak yine kapalı kalsın.
//    Her ikisi de aşağıdaki "önkoşul" bloğunda ayrıca test ediliyor.
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Yorumları eler:
 *  - `/* ... *\/` blokları (JSX'teki `{/* ... *\/}` biçimi de budur),
 *  - satır başında `//` ile başlayan satırlar.
 *
 * ⚠️ `//` elemesi SATIR BAŞINA ÇAPALIDIR (`trimStart().startsWith("//")`).
 *    Serbest bir `/\/\/[^\n]*\/g` "https://…" içindeki `//`den itibaren her şeyi
 *    siler ve tam da aranan ipucunu yok eder (bu depoda bir kez yaşandı).
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** Kaynaktaki tüm `className="..."` düz-metin değerlerini döndürür. */
function classAttributes(src: string): string[] {
  return Array.from(stripComments(src).matchAll(/className="([^"]*)"/g)).map((m) => m[1]);
}

/**
 * Verilen sınıfların HEPSİNİ taşıyan (ve `forbidden` listesinden HİÇBİRİNİ
 * taşımayan) bir className özniteliği var mı?
 *
 * 🚨 `forbidden` KOZMETİK DEĞİL — mutasyon testinde bu yüzden eklendi.
 *    İlk yazımda mülk sayfasının YAN sütunu için yalnız ["min-w-0","space-y-4"]
 *    aranıyordu; aynı dosyadaki SOL sütun (`min-w-0 space-y-4 lg:col-span-2`)
 *    bu kümeyi zaten sağladığı için yan sütunun min-w-0'ı SİLİNDİĞİNDE test
 *    YEŞİL KALDI — yani asıl ölçülen suçlu hiç pinlenmiyordu. Kardeş öğeyi
 *    dışlamak, iddiayı doğru öğeye çapalar.
 */
function hasClassSet(src: string, required: string[], forbidden: string[] = []): boolean {
  return classAttributes(src).some((attr) => {
    const classes = new Set(attr.split(/\s+/).filter(Boolean));
    return required.every((c) => classes.has(c)) && forbidden.every((c) => !classes.has(c));
  });
}

// ---------------------------------------------------------------------------
// 0. Önkoşul — eleyici gerçekten çalışıyor mu?
//    Bu olmadan tüm dosya sessizce vacuous olabilir: yorum elemesi bozulursa
//    aşağıdaki iddialar yorum metnindeki "min-w-0"larla da geçerdi.
// ---------------------------------------------------------------------------
describe("önkoşul — yorum elemesi", () => {
  it("blok yorumu (JSX dahil) tamamen silinir", () => {
    const src = `{/* min-w-0 lg:col-span-2 diye ANLATAN yorum */}\n<div className="lg:col-span-2" />`;
    expect(stripComments(src)).not.toContain("min-w-0");
    // ...ama gerçek öznitelik korunur:
    expect(classAttributes(src)).toEqual(["lg:col-span-2"]);
  });

  it("`//` elemesi SATIR BAŞINA çapalı — URL içindeki `//` metni kesmez", () => {
    const src = `<code>https://www.lixusai.com/api/calendar/tok</code>\n  // min-w-0 yorumu`;
    const out = stripComments(src);
    expect(out).toContain("https://www.lixusai.com/api/calendar/tok");
    expect(out).not.toContain("min-w-0");
  });

  it("hasClassSet TAM sınıf eşleşmesi ister, alt-dize değil", () => {
    // `min-w-0` ile `min-w-04` karışmasın; ayrıca yalnız BİR sınıfın varlığı
    // yetmesin — istenen kümenin TAMAMI aynı öznitelikte olmalı.
    const src = `<div className="min-w-0" /><div className="lg:col-span-2" />`;
    expect(hasClassSet(src, ["min-w-0"])).toBe(true);
    expect(hasClassSet(src, ["min-w-0", "lg:col-span-2"])).toBe(false);
  });

  it("`forbidden` kardeş öğeyi gerçekten dışlar", () => {
    // Mutasyonla bulunan vacuity'nin birebir modeli: iki kardeşten YALNIZ
    // geniş olanında min-w-0 varsa, dar olanı için kurulan iddia GEÇMEMELİ.
    const src = `<div className="min-w-0 space-y-4 lg:col-span-2" /><div className="space-y-4" />`;
    expect(hasClassSet(src, ["min-w-0", "space-y-4"])).toBe(true); // naif biçim: yanıltıcı
    expect(hasClassSet(src, ["min-w-0", "space-y-4"], ["lg:col-span-2"])).toBe(false); // doğru biçim
  });
});

// ---------------------------------------------------------------------------
// 1. Ölçülmüş üç arıza — her birinin sütunu küçülebilir kalmalı.
// ---------------------------------------------------------------------------
const PROPERTY_PAGE = "src/app/(app)/properties/[id]/page.tsx";
const INBOX_PAGE = "src/app/(app)/inbox/[id]/page.tsx";
const KB_MANAGER = "src/components/knowledge/kb-manager.tsx";
const CALENDAR_FEED = "src/components/properties/calendar-feed.tsx";

describe("min-w-0 pini — ölçülmüş yatay kayma arızaları", () => {
  it("mülk sayfası: `lg:grid-cols-3` grid'inin İKİ çocuğu da min-w-0", () => {
    const src = read(PROPERTY_PAGE);
    // 99 karakterlik feed adresini taşıyan YAN sütun (ölçülmüş ASIL suçlu).
    // `lg:col-span-2` DIŞLANIR: yoksa iddia soldaki geniş sütunla tatmin olur
    // ve tam da pinlemek istediğimiz öğe pinsiz kalır (mutasyonla yakalandı).
    expect(
      hasClassSet(src, ["min-w-0", "space-y-4"], ["lg:col-span-2"]),
      "mülk sayfasındaki takvim sütunu min-w-0 kaybetti → 390 px'de scrollWidth 757",
    ).toBe(true);
    // Aynadaki sol sütun — simetri korunmazsa aynı hata form tarafında doğar:
    expect(
      hasClassSet(src, ["min-w-0", "space-y-4", "lg:col-span-2"]),
      "mülk sayfasındaki form sütunu min-w-0 kaybetti",
    ).toBe(true);
  });

  it("gelen kutusu: `lg:grid-cols-3` grid'inin İKİ çocuğu da min-w-0", () => {
    const src = read(INBOX_PAGE);
    expect(
      hasClassSet(src, ["min-w-0", "lg:col-span-2"]),
      "mesaj sütunu min-w-0 kaybetti → uzun misafir linki sayfayı kaydırır (ölçüldü: 560)",
    ).toBe(true);
    expect(
      hasClassSet(src, ["min-w-0", "space-y-4"], ["lg:col-span-2"]),
      "gelen kutusu yan sütunu min-w-0 kaybetti",
    ).toBe(true);
  });

  it("bilgi tabanı: grid çocukları VE satır başlık grubu min-w-0", () => {
    const src = read(KB_MANAGER);
    expect(
      hasClassSet(src, ["min-w-0", "space-y-4", "lg:col-span-2"]),
      "KB liste sütunu min-w-0 kaybetti → 360 px'de scrollWidth 376",
    ).toBe(true);
    expect(
      hasClassSet(src, ["min-w-0", "lg:col-span-1", "lg:self-start"]),
      "KB form kartı min-w-0 kaybetti",
    ).toBe(true);
    // Satır içindeki rozet+başlık grubu: sağdaki 4 aksiyon düğmesi
    // `min-w-[40px]` ile SABİT (~171 px). Bu grup küçülemezse düğmeler kartın
    // kenarından TAŞAR (ölçüldü: 31 px → min-w-0 ile 0).
    expect(
      hasClassSet(src, ["flex", "min-w-0", "items-center", "gap-2"]),
      "KB satırındaki başlık grubu min-w-0 kaybetti → düğmeler karttan taşar",
    ).toBe(true);
  });

  it("takvim adresi: kısaltılan `<code>` flex çocuğu min-w-0 + truncate", () => {
    const src = read(CALENDAR_FEED);
    expect(
      hasClassSet(src, ["min-w-0", "flex-1", "truncate"]),
      "feed adresi `<code>`u min-w-0 kaybetti → truncate hiç devreye giremez",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. İleriye dönük kapsama — aynı hata sınıfı yeniden doğmasın.
// ---------------------------------------------------------------------------
describe("aynı hata sınıfının yayılmasına karşı", () => {
  it("`flex-1` + `truncate` taşıyan HER className ayrıca min-w-0 taşır", () => {
    // Bu ikili, min-w-0 olmadan TANIM GEREĞİ çalışmaz: flex çocuğu kendi
    // min-content'inin altına inemediği için kısaltma hiç tetiklenmez.
    const files = [CALENDAR_FEED];
    let checked = 0;
    for (const rel of files) {
      for (const attr of classAttributes(read(rel))) {
        const classes = new Set(attr.split(/\s+/).filter(Boolean));
        if (!classes.has("flex-1") || !classes.has("truncate")) continue;
        checked += 1;
        expect(classes.has("min-w-0"), `${rel}: "${attr}" min-w-0 istiyor`).toBe(true);
      }
    }
    expect(checked, "sağlama: taranan hiç `flex-1 truncate` bulunamadı = test boş").toBeGreaterThan(0);
  });

  it("`grid gap-4 lg:grid-cols-3` kabı olan dosyalar bilinen listede", () => {
    // Yeni bir üç-sütunlu panel grid'i eklenirse bu liste kırmızıya döner ve
    // ekleyen kişi "çocuklarım küçülebiliyor mu?" sorusunu ORADA yanıtlar.
    const KNOWN = [PROPERTY_PAGE, INBOX_PAGE, KB_MANAGER, "src/app/(app)/reports/loading.tsx"];
    for (const rel of KNOWN) {
      expect(stripComments(read(rel)), `${rel}: beklenen grid kabı yok`).toContain(
        "grid gap-4 lg:grid-cols-3",
      );
    }
  });

  it("reports/loading.tsx GEREKÇELİ MUAF — yalnız sabit dar iskelet kutuları", () => {
    // Kod-doğrulandı: bu grid'in çocukları sadece `Bar` iskeletleri taşıyor ve
    // en geniş SABİT ölçü `w-40` (160 px) + kart dolgusu p-5 (40 px) = 200 px,
    // 360 px'lik ekranda kullanılabilir 328 px'in ALTINDA. Kalanlar `w-full`
    // (küçülebilir). Yani min-content taşması yapısal olarak imkânsız.
    // Buraya bir gün `w-96` gibi geniş bir sabit kutu girerse bu test kırmızı
    // olur ve muafiyet yeniden değerlendirilir.
    const src = stripComments(read("src/app/(app)/reports/loading.tsx"));
    // ⚠️ YALNIZ üç-sütunlu grid'in gövdesi taranır. İlk yazımda TÜM dosyayı
    // taradım ve test beni haklı olarak yakaladı: sayfa BAŞLIĞINDA `w-80`
    // (320 px) var — ama o grid'in ÇOCUĞU değil, dolayısıyla sütun min-content
    // tartışmasının parçası değil (360 px'de kullanılabilir 328 px'e sığar).
    // Kapsamı daraltmadan yapılan iddia YANLIŞ kapsamda ölçüyordu.
    const gridStart = src.indexOf("grid gap-4 lg:grid-cols-3");
    expect(gridStart, "grid kabı bulunamadı = test boş").toBeGreaterThan(-1);
    const gridBody = src.slice(gridStart);
    const widths = Array.from(gridBody.matchAll(/\bw-(\d+)\b/g)).map((m) => Number(m[1]));
    expect(widths.length, "sağlama: hiç sabit genişlik bulunamadı = test boş").toBeGreaterThan(0);
    expect(
      Math.max(...widths),
      "sabit iskelet kutusu genişledi — muafiyeti gözden geçir (w-40=160px, 360px'de sınır ~328px)",
    ).toBeLessThanOrEqual(40);
    // ...ve gerçekten yalnız iskelet: içeride serbest metin/veri yok.
    expect(gridBody).not.toContain("truncate");
  });
});
