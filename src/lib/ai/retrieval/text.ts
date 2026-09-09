import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// RETRIEVAL METİN KATMANI — LLM'siz, deterministik, Türkçe-öncelikli (RAG dilim 1, 09-09).
//
// Neden ayrı: kelime ağları (`fallback.ts`) KISITLAYICI dedektörlerdir ve "yalnız
// eşleşme ekler" kuralıyla yaşar. Retrieval ise bir SIRALAMA problemidir: aynı
// kavramın Türkçe/İngilizce ve ekli/eksiz biçimlerini aynı anahtara indirmek
// gerekir. Buradaki katlama HER İKİ TARAFA (sorgu VE bilgi tabanı) simetrik
// uygulanır; dolayısıyla aşırı kök alma "yanlış birleştirme" üretebilir ama
// "kaçırma" üretmez — BM25'in IDF'i nadir yanlış birleştirmeleri zaten cezalandırır.
//
// Güvenlik sınırı: bu modül METNİ DEĞİŞTİRMEZ, yalnız anahtar üretir. Modele
// giden içerik her zaman orijinal kalem metnidir (chunker olduğu gibi keser).
// Sır elemesi ve yetki filtresi bu modülün ÖNÜNDE kalır (select.ts pin).
// ---------------------------------------------------------------------------

/**
 * En kısa kök (harf). Altına inen bir ek asla sökülmez. Türkçede iki harfli
 * fiil/isim kökleri yaygındır ("ak-", "ev", "su") → 2; İngilizce ekler ("s",
 * "es", "ed", "ing") için 3 — "bus" → "bu" (durak kelime!) olmasın.
 */
export const MIN_STEM = 2;
export const MIN_STEM_EN = 3;

const APOSTROPHES = /['’‘´`]/g;

/**
 * Tire/boşlukla yazılan bileşikler tek anahtara iner ("wi-fi", "check in").
 * ÇEVİRİ DEĞİL, yalnız yazım varyantı — eşanlamlar `lexicon.ts`te.
 */
const COMPOUNDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwi[\s-]?fi\b/g, "wifi"],
  [/\bcheck[\s-]?in\b/g, "checkin"],
  [/\bcheck[\s-]?out\b/g, "checkout"],
  [/\bself[\s-]?check[\s-]?in\b/g, "checkin"],
];

/**
 * Görünmez karakter sınıfı `fallback.ts` ile AYNI (CLAUDE.md: liste değil özellik):
 * `\p{Default_Ignorable_Code_Point}` + U+2800. NFKC önce (tam genişlik/matematiksel
 * harfler). Sonra ASCII-kanonik Türkçe katlama (I/ı/İ/i tek harfe iner) ve kesme
 * işareti kelime sınırı sayılır (CLAUDE.md kuralı: `'` ve `’` sınırdır).
 */
export function normalizeForRetrieval(s: string): string {
  const base = s.normalize("NFKC").replace(/[\p{Default_Ignorable_Code_Point}\u2800]/gu, "");
  let out = foldTurkishAscii(base).replace(APOSTROPHES, " ");
  for (const [re, rep] of COMPOUNDS) out = out.replace(re, rep);
  return out;
}

const TOKEN_RE = /\d{1,2}[:.]\d{2}|[\p{L}\p{N}]+/gu;

/** Ham belirteçler (katlanmış, kök alınmamış). Saat belirteçleri "SS:DD"ye normalize edilir. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const m of normalizeForRetrieval(s).matchAll(TOKEN_RE)) {
    const t = m[0];
    const time = /^(\d{1,2})[:.](\d{2})$/.exec(t);
    out.push(time ? `${time[1].padStart(2, "0")}:${time[2]}` : t);
  }
  return out;
}

/**
 * Durak kelimeler — ASCII-katlanmış biçimde. "var"/"yok" BİLİNÇLİ OLARAK DURAK
 * DEĞİL: "sıcak su yok" bilgi taşır; "var mı" kalıbının IDF'i zaten düşüktür.
 * "şu" da YOK: ASCII katlamada "su" (SU) ile çakışır — su kesintisi/sıcak su
 * sorguları kör kalırdı (ölçüldü).
 * Soru zarfları (nerede/kaçta/how) durak: nesne adı bilgiyi taşır, zarf taşımaz.
 */
const STOPWORDS = new Set<string>(
  (
    "mi mu ve ile bir bu o de da ki ama fakat cok daha en gibi icin kadar sonra once ise hem ya veya " +
    "ben sen biz siz bana bize size sana beni bizi sizi seni benim bizim sizin senin onu ona onun " +
    "nasil ne neden hangi acaba lutfen rica merhaba selam tesekkur tesekkurler sagolun sagol iyi gunler aksamlar " +
    "ederim misiniz misin olur olabilir mumkun evet hayir peki tamam simdi biraz hic hemen yine artik bile " +
    "ayrica hakkinda ait olan olarak oldu olacak nerede nereye nereden kacta kac zaman saatte zamanda " +
    "the a an is are was were be do does did can could would should i we you my our your me us there it its " +
    "of to in on at for and or please hello hi hey thanks thank what where when how which any some this that " +
    "these those with from by about if will have has had not no yes ok okay"
  ).split(/\s+/),
);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Türkçe ek listesi (ASCII-katlanmış). EN UZUN eşleşen ek sökülür, en fazla
 * `STEM_PASSES` tur. Liste bilinçli olarak DAR: iyelik/hâl/çoğul + en yaygın
 * fiil ekleri. "sin/sun" (2. tekil) YOK — "otobusun" → "otobu" olurdu; "ki"
 * YOK — "otoparki" → "otopar" olurdu (ölçüldü).
 * İngilizce ekler ("ing/ed/es/s") aynı turda yarışır; iki dil de aynı
 * anahtarlara iner ("parking" → "park", "otoparki" → "otopark").
 */
const SUFFIXES: readonly string[] = [
  "lardan", "lerden", "larimiz", "lerimiz", "lariniz", "leriniz",
  "larda", "lerde", "larin", "lerin", "lari", "leri", "lara", "lere",
  "imiz", "umuz", "iniz", "unuz", "iyor", "uyor", "miyor", "muyor",
  "ecek", "acak", "ebilir", "abilir", "meli", "mali", "ayim", "eyim", "alim", "elim",
  "erek", "arak", "ince", "unca", "inca", "dir", "dur", "tir", "tur",
  "lar", "ler", "dan", "den", "tan", "ten", "nin", "nun", "yla", "yle",
  "mis", "mus", "mek", "mak", "ken", "yor", "siz", "suz", "ing",
  "in", "un", "im", "um", "da", "de", "ta", "te", "ya", "ye", "na", "ne",
  "yi", "yu", "si", "su", "la", "le", "li", "lu", "di", "du", "ti", "tu", "ed", "es",
  "i", "u", "a", "e", "s",
];
/** İngilizce ekler daha yüksek kök tabanı ister (↑MIN_STEM_EN). */
const EN_SUFFIXES = new Set(["ing", "ed", "es", "s"]);
const SUFFIXES_LONGEST_FIRST = [...SUFFIXES].sort((x, y) => y.length - x.length);
const STEM_PASSES = 3;

/** Rakam/saat belirteçleri kök alınmaz. */
const HAS_DIGIT = /\d/;

export function stem(token: string): string {
  if (HAS_DIGIT.test(token)) return token;
  let cur = token;
  for (let pass = 0; pass < STEM_PASSES; pass++) {
    let stripped = false;
    for (const suf of SUFFIXES_LONGEST_FIRST) {
      const floor = EN_SUFFIXES.has(suf) ? MIN_STEM_EN : MIN_STEM;
      if (cur.length - suf.length >= floor && cur.endsWith(suf)) {
        cur = cur.slice(0, -suf.length);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  return cur;
}

/**
 * İçerik kökleri: durak kelimeler (ham ya da kök hâli) elenir, tek harfli
 * belirteçler atılır. Sıra korunur (bigram/kalıp bonusu için), tekrar korunur
 * (BM25 tf için).
 */
export function contentStems(s: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(s)) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    const st = stem(t);
    if (st.length < 2 || STOPWORDS.has(st)) continue;
    out.push(st);
  }
  return out;
}

/** Karakter bigram Dice benzerliği (yazım hatası toleransı için). */
export function diceBigram(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
