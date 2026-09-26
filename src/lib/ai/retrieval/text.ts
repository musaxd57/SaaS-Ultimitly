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
 * Türkçe ek listesi (ASCII-katlanmış). EN UZUN eşleşen ek sökülür; ek kalmayana
 * dek (SABİT NOKTA, en fazla `STEM_PASSES_MAX` tur). Liste bilinçli olarak DAR:
 * iyelik/hâl/çoğul + en yaygın fiil ekleri. "sin/sun" (2. tekil) YOK —
 * "otobusun" → "otobu" olurdu; "ki" YOK — "otoparki" → "otopar" olurdu (ölçüldü).
 * İngilizce ekler ("ing/ed/es/s") aynı turda yarışır; iki dil de aynı
 * anahtarlara iner ("parking" → "park", "otoparki" → "otopark").
 *
 * ÜNLÜ-SONU İYELİK (-mız/-miz/-muz/-müz, -nız/-niz/-nuz/-nüz; 09-10): "ısıtmanız",
 * "metronuz", "kargomuz", "mikrodalganız" listede yoktu (yalnız ünsüz-sonu
 * "imiz/iniz/umuz/unuz" vardı) → kelime kendi konusunun köküne inmiyordu ve fuzzy
 * eşleşme (uzunluk farkı 3 > 2) de kördü; ölçek harness'ında morph kaçaklarının
 * yarısı buydu. Bu dördü için kök tabanı 3 (`MIN_STEM_AFTER_VOWEL`, ↓).
 */
const SUFFIXES: readonly string[] = [
  "lardan", "lerden", "larimiz", "lerimiz", "lariniz", "leriniz",
  "larda", "lerde", "larin", "lerin", "lari", "leri", "lara", "lere",
  "imiz", "umuz", "iniz", "unuz", "iyor", "uyor", "miyor", "muyor",
  "miz", "muz", "niz", "nuz",
  "ebilecegim", "abilecegim", "ecegim", "acagim", "ecegiz", "acagiz", "yebilir", "yabilir",
  "ecek", "acak", "yecek", "yacak", "ebilir", "abilir", "meli", "mali", "ayim", "eyim", "alim", "elim",
  "yerek", "yarak", "mam", "mem",
  "erek", "arak", "ince", "unca", "inca", "dir", "dur", "tir", "tur",
  "lar", "ler", "dan", "den", "tan", "ten", "nin", "nun", "yla", "yle",
  "mis", "mus", "mek", "mak", "ken", "yor", "siz", "suz", "ing",
  "in", "un", "im", "um", "da", "de", "ta", "te", "ya", "ye", "na", "ne",
  "yi", "yu", "si", "su", "la", "le", "li", "lu", "di", "du", "ti", "tu", "ed", "es",
  "i", "u", "a", "e", "s",
];
/** İngilizce ekler daha yüksek kök tabanı ister (↑MIN_STEM_EN). */
const EN_SUFFIXES = new Set(["ing", "ed", "es", "s"]);
/**
 * KÖK TABANI 3 İSTEYEN EKLER (09-10) — üç sınıf, tek kural (`MIN_STEM_AFTER_VOWEL`):
 *  · Ünlü-sonu iyelik (-mız/-miz/-muz/-nız/-niz/-nuz): "deniz", "omuz", "domuz" sökülmez.
 *  · Kaynaştırma "y"li ekler: "y" yalnız ÜNLÜ-sonu köke gelir; kök 2 harfe inecekse
 *    "y" kökün kendisidir ("çayı" → ca ✗ / cay ✓, "suyu" → su, "koyabilirim" → koy).
 *  · Ünsüz-sonu 3. tekil iyelik / geçmiş zaman (-sı/-su, -dı/-du/-tı/-tu): kök 2 harfe
 *    inecekse ek değil kökün sonudur ("kodu" → ko ✗ / kod ✓, "duşu" → du ✗ / duş ✓);
 *    "geldi/buldu/gitti/kapısı/odası" (kök ≥3) etkilenmez.
 * Sökülmeyince bir sonraki tur tek harfli eki ("ı/u/a/e") söker.
 */
const MIN_STEM_3_SUFFIXES = new Set([
  "miz", "muz", "niz", "nuz",
  "yi", "yu", "ya", "ye", "yla", "yle", "yecek", "yacak", "yebilir", "yabilir", "yerek", "yarak",
  "si", "su", "di", "du", "ti", "tu",
]);
export const MIN_STEM_AFTER_VOWEL = 3;
/** Tek düzensiz kök: "su" → suyu/suyun/suyumuz/suyunuz/suya → "suy" (başka kelime "suy"a inmez). */
const IRREGULAR_STEMS: Readonly<Record<string, string>> = { suy: "su" };
/**
 * SÖKÜLMEYEN KÖKLER (09-26, kurucu onayı — sözlük tipli eşleştirici turu): İngilizce bileşik "checkin" Türkçe
 * tamlayan "-in" sanılıp "check"e iniyordu → çıplak "check" ("Can you check the AC?") GİRİŞ kavramını
 * tetikliyordu. Sökme bu köke ulaşınca DURUR ("checkinler" → "checkin"). Simetrik: bilgi tabanındaki
 * "check-in" / "check in" (bileşik birleştirme) da "checkin" kalır.
 */
const PROTECTED_STEMS: ReadonlySet<string> = new Set(["checkin"]);
const SUFFIXES_LONGEST_FIRST = [...SUFFIXES].sort((x, y) => y.length - x.length);
/**
 * SABİT NOKTA (09-10): eski tur tavanı (3) çekimli biçim ile yalın biçimi FARKLI
 * derinlikte bırakıyordu — "çıkışımızı" → ciki (i · imiz · s = 3 tur, durdu) ama
 * "çıkış" → cik (s · i = 2 tur). Dosya başındaki "aşırı kök alma kaçırma üretmez"
 * varsayımı yalnız SİMETRİK sökümde doğrudur; tavan simetriyi bozuyordu (ölçüldü:
 * çıkış/giriş/kesinti sınıfı kaçakları + `no_lexical_hits` geri çekilmesi). Artık ek
 * kalmayana dek sökülür; tavan yalnız patolojik belirteç ("aaaa…") için sigortadır.
 */
const STEM_PASSES_MAX = 8;

/**
 * 🚨 SABİT NOKTANIN FRENİ — TAMLAYAN EKİ YALNIZ İLK TURDA (inceleme turu 09-10, ölçümle).
 *
 * Tur tavanı kalkınca kısa ekler ARDIŞIK sökülüp gerçek gövdeyi yiyordu. Ölçülen zarar:
 * "havalimanından / havalimanında / havalimanını" → `-dan -nin -a -alim` → **hav** = "havlu"/"hava"
 * kovası; transfer sorusunda misafire giden bloğun İLK parçası HAVLU kalemi oluyordu (eski tur
 * tavanı bunu KAZARA engelliyordu).
 *
 * Kural DİLBİLGİSEL, keyfi değil: tamlayan (-nin/-nun) yüzey kelimesinde SONDADIR, yani sağdan
 * soyarken İLK sökülen olmalıdır ("makinesinin" → -nin ilk turda, doğru). Bir HÂL eki söküldükten
 * SONRA görünen "…nin" gerçek tamlayan değil, gövdenin parçasıdır: "havalimanı+n+dan" → `-dan`
 * sonrasında kalan "havalimanin" içindeki "nin" KAYNAŞTIRMA n'sidir. Tek kural sınıfı tam
 * simetriye oturtuyor: havalimanından/‑nda/‑nı → `havaliman` = havalimanı; havaalanından →
 * `havaalan` = havaalanı. Yalnız AŞIRI kök almayı keser; çekimli↔yalın eşleşmeleri bozmaz.
 *
 * ⚠️ İKİ FREN DAHA DENENDİ ve ÖLÇÜMLE GEREKSİZ ÇIKTI (tekrar eklenmesin): optatif ekleri
 * (-alım/-elim) ilk-tura kısıtlamak ve aynı ekin üst üste sökülmesini engellemek. Tamlayan freni
 * zinciri zaten daha erken kestiği için ikisi de ULAŞILAMAZ hâle geliyor — mutasyon turunda
 * ikisini de kaldıran mutantlar HAYATTA KALDI (yani hiçbir davranışı korumuyorlardı) ve
 * pinlenemeyen kod tutulmaz.
 */
const FIRST_PASS_ONLY_SUFFIXES = new Set(["nin", "nun"]);

/** Rakam/saat belirteçleri kök alınmaz. */
const HAS_DIGIT = /\d/;

/**
 * Ünsüz yumuşaması geri alınır — YALNIZ bir ek söküldüyse: "uçağa"→"ucag"→"ucak",
 * "köpeğimi"→"kopeg"→"kopek", "kitabı"→"kitab"→"kitap". Ek sökülmemiş kelimeye
 * dokunulmaz ("blog" → "blog"). d→t BİLİNÇLİ YOK: "adı"→"ad"→"at" simetriyi bozar.
 */
const UNSOFTEN: Record<string, string> = { g: "k", b: "p" };

export function stem(token: string): string {
  if (HAS_DIGIT.test(token)) return token;
  let cur = token;
  let strippedAny = false;
  for (let pass = 0; pass < STEM_PASSES_MAX; pass++) {
    if (PROTECTED_STEMS.has(cur)) break;
    let stripped = false;
    for (const suf of SUFFIXES_LONGEST_FIRST) {
      if (pass > 0 && FIRST_PASS_ONLY_SUFFIXES.has(suf)) continue; // ↑tamlayan freni
      const floor = EN_SUFFIXES.has(suf) ? MIN_STEM_EN : MIN_STEM_3_SUFFIXES.has(suf) ? MIN_STEM_AFTER_VOWEL : MIN_STEM;
      if (cur.length - suf.length >= floor && cur.endsWith(suf)) {
        cur = cur.slice(0, -suf.length);
        stripped = true;
        strippedAny = true;
        break;
      }
    }
    if (!stripped) break;
  }
  if (strippedAny && cur.length >= 3) {
    const last = cur[cur.length - 1];
    if (UNSOFTEN[last]) cur = cur.slice(0, -1) + UNSOFTEN[last];
  }
  return IRREGULAR_STEMS[cur] ?? cur;
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

/**
 * KALIP BİRİMLERİ (09-26, tipli sözlük eşleştiricisi): durak sözcükler OLDUĞU GİBİ kalır ("çok", "no", "how",
 * "to"), içerik sözcükleri kök alınır. `contentStems` durak sözcükleri attığı için "çok sıcak" → [sıcak],
 * "no water" → [water] olup kalıp TEK kelime tetikleyicisine iniyordu (ölçüldü). Çekim korunur: "Oda çok
 * sıcaktı" → [od, cok, sicak]. Sıra korunur; kalıp eşleşmesi bitişik birimler üzerindendir.
 */
export function phraseUnits(s: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(s)) out.push(STOPWORDS.has(t) ? t : stem(t));
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
