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
  const clean = stripComments(src);
  const plain = Array.from(clean.matchAll(/className="([^"]*)"/g)).map((m) => m[1]);
  // 🚨 `className={cn("…", "…")}` BİÇİMİ DE OKUNUR (09-12).
  //
  // Eskiden yalnız düz `className="…"` taranıyordu. Tam ekran okuma sütunu
  // eklenirken yazma alanı `cn("shrink-0 space-y-2 p-4", readingColumnCn)`
  // oldu ve `shrink-0` pini KIRMIZI verdi — oysa sınıf YERİNDEYDİ. O pin
  // gerçek bir şeyi koruyor (yazma alanı ezilmesin), yani doğru hamle pini
  // GEVŞETMEK değil, ayıklayıcıya bu biçimi ÖĞRETMEK.
  //
  // Tek bir `cn(...)` çağrısının TÜM string literalleri TEK öznitelik gibi
  // birleştirilir: `forbidden` anlamı korunsun (ikinci literalde geçen yasak
  // bir sınıf da aynı öğeye aittir). Değişkenler (ör. `readingColumnCn`)
  // literal olmadıkları için doğal olarak DIŞARIDA kalır — koşullu sınıf
  // hakkında hüküm vermeyiz.
  const composed = Array.from(clean.matchAll(/className=\{cn\(([\s\S]*?)\)\}/g)).map((m) =>
    Array.from(m[1].matchAll(/"([^"]*)"/g))
      .map((x) => x[1])
      .join(" "),
  );
  return [...plain, ...composed];
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

  it("`className={cn(\"…\")}` biçimi de ayıklanır (09-12) ve TEK öznitelik sayılır", () => {
    const src = `<div className={cn("shrink-0 space-y-2 p-4", readingColumnCn)} />`;
    expect(classAttributes(src)).toEqual(["shrink-0 space-y-2 p-4"]);
    expect(hasClassSet(src, ["shrink-0", "p-4"])).toBe(true);
    // Değişken literal DEĞİL → hakkında hüküm verilmez.
    expect(hasClassSet(src, ["mx-auto"])).toBe(false);
    // İki literal AYNI öğeye ait → `forbidden` ikisini birden görmeli.
    const two = `<div className={cn("a b", "c")} />`;
    expect(hasClassSet(two, ["a"], ["c"]), "forbidden ikinci literali görmüyor").toBe(false);
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

  it("gelen kutusu: grid'in İKİ çocuğu da min-w-0 + parça `minmax(0,1fr)`", () => {
    // 09-11: kap `lg:grid-cols-3` → `lg:grid-cols-[minmax(0,1fr)_20rem]`
    // (yazma alanı geniş ekranda genişlesin). `minmax(0,1fr)` bu arızaya karşı
    // `min-w-0`dan DAHA GÜÇLÜ bir garantidir — küçülme sınırını PARÇA
    // düzeyinde 0 yapar, yani çocuk sınıfını unutsa bile sütun daralabilir.
    // Yine de İKİSİ birden aranır: parça yazımı bir gün `1fr`e dönerse
    // (varsayılan `minmax(auto,1fr)`) tek savunma çocuğun `min-w-0`ıdır.
    const src = read(INBOX_PAGE);
    expect(
      stripComments(src),
      "grid parçası daraldı/değişti — `1fr` tek başına `minmax(auto,1fr)` demektir ve arıza geri gelir",
    ).toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
    // 🚨 TAM ÖZNİTELİK EŞİTLİĞİ (inceleme ajanı 09-11): `hasClassSet(["min-w-0"],
    // forbidden ["space-y-4"])` biçimi ÖLÇÜLEBİLİR ŞEKİLDE ZAYIFTI — aynı dosyada
    // `min-w-0 flex-1` taşıyan ÜÇÜNCÜ bir öznitelik var ve iddiayı O tatmin
    // ediyordu, yani mesaj sütununun `min-w-0`ı silinse test YEŞİL kalırdı.
    // (Commit mesajımdaki "kapsam düşmedi" bu satır için YANLIŞTI.) Mesaj sütunu
    // TEK sınıf taşır; eşitlik onu tekil olarak belirler.
    // ⚠️ 09-11: sütuna `lg:min-h-0` eklendi (esnek doldurma zinciri) → beklenen
    // öznitelik de güncellendi. Eşitlik KORUNUYOR; gevşetilip `some(includes)`
    // hâline getirilmedi, yoksa yukarıda anlatılan vakum geri gelirdi.
    expect(
      classAttributes(src),
      "mesaj sütunu min-w-0 kaybetti → uzun misafir linki sayfayı kaydırır (ölçüldü: 560)",
    ).toContain("min-w-0 lg:min-h-0");
    expect(
      hasClassSet(src, ["min-w-0", "space-y-4"]),
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
    // ⚠️ INBOX_PAGE bu listeden 09-11'de ÇIKTI: kabı artık
    // `lg:grid-cols-[minmax(0,1fr)_20rem]`. Kapsam DÜŞMEDİ — o dosyanın yeni
    // kap yazımı kendi testinde (yukarıda) ayrıca pinli.
    const KNOWN = [PROPERTY_PAGE, KB_MANAGER, "src/app/(app)/reports/loading.tsx"];
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

// ---------------------------------------------------------------------------
// 3. KONUŞMA SAYFASI YÜKSEKLİK ZİNCİRİ (kurucu 09-11: "panel burada aşağı
//    gidemesin, mesajların göründüğü yerin uzunluğunu arttır").
//
// Kart görünür alana sabitlenir, mesaj listesi ARTAN alanı alır. Üç şey birden
// doğru olmazsa davranış sessizce eski hâline döner, o yüzden üçü de pinli.
// ⚠️ Bu da bir KAYNAK TARAMASIDIR — jsdom düzen hesaplamaz. Ölçülen şey,
//    davranışı üreten sınıfların sessizce silinmemesi.
// ---------------------------------------------------------------------------
const THREAD = "src/components/inbox/conversation-thread.tsx";
const SHELL = "src/components/shell/app-shell.tsx";
/** Kart ve sağ rayın PAYLAŞTIĞI yükseklik ifadesi — ayrışırsa satır zıplar. */
const VIEWPORT_H = "lg:h-full";

describe("konuşma sayfası — yükseklik zinciri", () => {
  it("kart ve sağ ray AYNI yükseklik ifadesini kullanır", () => {
    expect(stripComments(read(THREAD)), "kart görünür alana sabitlenmiyor").toContain(VIEWPORT_H);
    expect(stripComments(read(INBOX_PAGE)), "sağ ray kartla aynı yüksekliği kullanmıyor").toContain(VIEWPORT_H);
  });

  it("🚨 `100vh` ARİTMETİĞİ GERİ GELMEZ — yükseklik hesapla DEĞİL, esnek doldurmayla", () => {
    // ÖLÇÜLDÜ (09-11): `calc(100vh/0.95 - 11rem)` iki ayrı sebeple kırılgandı —
    // (a) `11rem` aradaki BANDLARI saymıyordu ("Otomatik yanıt beklemede" tek
    // başına `<main>`i 46 px, deneme bandıyla 109 px taşırıyordu; kurucu bunu
    // "panel aşağı kayıyor" diye iki kez bildirdi), (b) `zoom` × `vh` davranışı
    // tarayıcı sürümüne bağlı. Sabit geri konursa ikisi de geri gelir.
    for (const f of [THREAD, INBOX_PAGE]) {
      expect(stripComments(read(f)), `${f} yükseklik hesabına geri dönmüş`).not.toMatch(
        /calc\(100vh\s*\/\s*0\.95\s*-/u,
      );
    }
    // Zincirin ORTA HALKASI: grid artan alanı almazsa `lg:h-full` çözümsüz kalır
    // ve kart içeriği kadar uzar — yani bu satır olmadan üstteki pin vakumdur.
    expect(
      hasClassSet(read(INBOX_PAGE), ["lg:flex-1", "lg:min-h-0", "lg:grid-cols-[minmax(0,1fr)_20rem]"]),
      "grid artan alanı almıyor (lg:flex-1 / lg:min-h-0 kayıp)",
    ).toBe(true);
  });

  it("🚨 KABUK `lg`de TAM EKRANA SABİT — sayfa kaydırması kapalı (kurucu iki kez bildirdi)", () => {
    // Bu davranışın PİNİ YOKTU (09-11 incelemesi): kurucunun iki kez bildirdiği
    // kusur sessizce geri gelebilirdi. `fixed inset-0` zoom'dan BAĞIMSIZ olarak
    // tam viewport'tur ve `fixed` akıştan çıktığı için `body`de kaydıracak içerik
    // kalmaz. Mobil yol ETKİLENMEZ: kuralların hepsi `lg:` önekli.
    expect(
      hasClassSet(read(SHELL), ["lg:fixed", "lg:inset-0", "lg:grid", "lg:min-h-0"]),
      "kabuk görünür alana sabitlenmiyor",
    ).toBe(true);
    // Görünür alanı DOLDURAN yol tanımlı olmalı; olmazsa bandlar kartı yine taşırır.
    // ⚠️ Bu sınıflar bir `className="..."` özniteliğinde DEĞİL, `cn()` argümanında
    // yaşıyor (koşullu) — o yüzden `hasClassSet` değil, düz metin araması.
    const shell = stripComments(read(SHELL));
    expect(shell, "fillsViewport dalı kayıp").toContain("fillsViewport");
    expect(shell, "doldurma kapsayıcısı dikey flex kurmuyor").toContain(
      'fillsViewport && "lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-6 lg:space-y-0"',
    );
  });

  it("🚨 KARTIN ÜSTÜNDE EYLEM SATIRI YOK — düğmeler kart başlığında", () => {
    // Kurucu 09-11: "mesaj yeri en üste kadar uzasın". "← Mesajlar" ve "Sil"
    // kartın DIŞINDA ayrı bir satırdaydı ve kartı 3.5rem aşağı itiyordu
    // (buton 2rem + `gap-6` 1.5rem). Şimdi kartın başlık satırında, `headerActions`
    // slotunda. Geri konursa liste yine o 3.5rem'i kaybeder.
    const page = stripComments(read(INBOX_PAGE));
    expect(page, "eylem satırı kartın üstüne geri gelmiş").not.toContain(
      'className="flex flex-wrap items-center justify-end gap-2"',
    );
    expect(page, "düğmeler kart başlığına verilmiyor").toContain("headerActions={");
    expect(stripComments(read(THREAD)), "kart başlığı slotu çizmiyor").toContain("{headerActions}");
  });

  it("KAYDIRMA HİSSİ — mesaj listesi zincirlemez ve yumuşak akar", () => {
    // Kurucu 09-11: "aşağı doğru kaydırınca öküz gibi sert olmasın".
    // `overscroll-contain` listenin sonunda kaydırmanın SAYFAYA zincirlenmesini
    // keser (kart sabit olduğu için zincirleme "duvara toslama" hissi veriyordu).
    // ⚠️ Bunlar fare tekerleğine ATALET EKLEMEZ — CSS'te böyle bir şey yok;
    // iddia yalnız zincirleme + klavye/programatik akış.
    expect(
      hasClassSet(read(THREAD), ["overscroll-contain", "scroll-smooth", "overflow-y-auto"]),
      "mesaj listesi overscroll/scroll davranışını kaybetti",
    ).toBe(true);
  });

  it("🚨 mesaj listesi `lg:flex-1` VE `lg:min-h-0` taşır", () => {
    // `min-h-0` olmadan flex çocuğunun varsayılan `min-height:auto`su içeriğin
    // tamamı kadar büyür → `overflow-y` HİÇ devreye girmez, kart uzar ve yazma
    // kutusu ekrandan çıkar. İkisi birlikte olmadan kural yoktur.
    expect(
      hasClassSet(read(THREAD), ["lg:flex-1", "lg:min-h-0", "overflow-y-auto"]),
      "mesaj listesi artan alanı almıyor (ya flex-1 ya min-h-0 kayıp)",
    ).toBe(true);
  });

  it("MOBİLDE sabit tavan KORUNUR (orada sayfa kayar, kart yüksekliği dayatılmaz)", () => {
    // Telefonda `100vh` tarayıcı çubuklarıyla yalan söyler; yükseklik dayatmak
    // yazma kutusunu görünmez yapardı. Tavan o yüzden `lg:` ÖNEKSİZ kalır.
    expect(hasClassSet(read(THREAD), ["max-h-[52vh]", "lg:max-h-none"])).toBe(true);
  });

  it("başlık ve yazma alanı EZİLMEZ (`shrink-0`)", () => {
    // Aksi hâlde flex, artan alanı bulmak için önce onları sıkıştırır.
    const src = read(THREAD);
    expect(hasClassSet(src, ["shrink-0", "border-b", "border-border", "p-4"]), "başlık satırı shrink-0 değil").toBe(true);
    expect(hasClassSet(src, ["shrink-0", "space-y-2", "p-4"]), "yazma alanı shrink-0 değil").toBe(true);
  });
});
