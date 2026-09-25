// ---------------------------------------------------------------------------
// DİL SİNYALİ — YALNIZ EMİNKEN (09-25, kurucu: "5.1'in zayıf noktasını düzelt"). SAF: DB/ağ/model yok.
//
// Ölçüldü (cevap kıyası, 135 senaryo): gpt-5.1 İngilizce yazan misafirlerin 7/59'una TÜRKÇE cevap verdi — bilgi
// tabanında olmayan soruda ("EV charger?"), enjeksiyon reddinde ve İngilizce geçen bir sohbette Wi-Fi şifresini
// sorana (bu sonuncusu kapıdan geçip OTOMATİK gidiyordu). Sebep: istem kuralları, bilgi tabanı ve devir/şikâyet
// örnekleri Türkçe + istemdeki "(Sistem tercih dili: tr)". Düzeltme iki katman, ikisi de bu fonksiyonu kullanır:
//   1) istem: misafirin dili KODLA tespit edildiyse modele açıkça söylenir (`prompts.ts`);
//   2) kapı: misafirin dili ile cevabın dili EMİNCE farklıysa cevap otomatik GİTMEZ (`reply_language_mismatch`).
//
// 🚨 "EMİN DEĞİLSEN null" sözleşmesi: yanlış bir kesin hüküm (Portekizceye "es", kısa "ok"a "en") ya modele yanlış
// dil dayatır ya da doğru cevabı tutar. Bu yüzden: dillere ORTAK sözcükler listede YOK ("de", "la", "que", "size",
// "was", "will", "in", "an", "on", "du", "des", "ev", "ben", "ne", "mi", "su", "es", "y" …), en yüksek puan ≥ 2 ve ikincinin en az 2 katı olmalı;
// Kiril / Arap yazısı harf payıyla. Özel ad ("Havaş", "Gül Sokak") tek başına dili değiştirmez: harf kanıtı yalnız
// listede OLMAYAN sözcükte ve yarım ağırlıkla sayılır.
// ---------------------------------------------------------------------------

export type ConfidentLanguage = "tr" | "en" | "de" | "fr" | "es" | "ru" | "ar";
type LatinLanguage = Exclude<ConfidentLanguage, "ru" | "ar">;

const LANGUAGE_NAMES: Record<ConfidentLanguage, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  ru: "Rusça",
  ar: "Arapça",
};

/** İstemde gösterilecek ad ("İngilizce (en)"). */
export function languageLabel(lang: ConfidentLanguage): string {
  return `${LANGUAGE_NAMES[lang]} (${lang})`;
}

// Yalnız o dile ÖZGÜ (ya da çarpışması ölçülmüş) sık sözcükler. Küçük harf; Türkçe hem işaretli hem ASCII biçim.
const WORDS: Record<LatinLanguage, ReadonlySet<string>> = {
  tr: new Set(
    [
      "ve", "bir", "bu", "şu", "için", "icin", "ile", "mı", "mu", "mü", "var", "yok", "nasıl", "nasil", "nerede",
      "nerde", "lütfen", "lutfen", "merhaba", "selam", "günaydın", "gunaydin", "teşekkürler", "tesekkurler",
      "teşekkür", "tesekkur", "sağol", "sagol", "rica", "ederim", "ederiz", "siz", "sizin", "biz", "bize",
      "bana", "benim", "olarak", "daha", "kadar", "göre", "gore", "ama", "fakat", "çok", "cok", "evet", "hayır",
      "hayir", "tamam", "iyi", "acaba", "şifre", "şifresi", "sifre", "sifresi", "nedir", "neydi", "kaçta", "kacta",
      "saat", "daire", "oda", "sahibiniz", "sahibinize", "mesajınız", "mesajınızı", "kaydedildi", "bilgi",
      "bilgiyi", "yardımcı", "yardimci", "olabilir", "olur", "lazım", "lazim", "gerek", "istiyoruz", "istiyorum",
      "miyiz", "miyim", "misiniz", "mısınız", "musunuz", "değil", "degil", "şimdi", "simdi", "burada", "orada",
      // Genel sık sözcükler (09-25 ikinci tur; alan sözcüğü değil, diğer dillerle çakışma denetlendi).
      "bugün", "sabah", "hangi", "neden", "niye", "tabii", "peki", "hemen", "biraz", "sonra", "önce", "bunu", "onu",
      "gibi", "yine", "artık", "bizim", "sizde", "bende", "geldik", "geliyoruz", "yarın", "akşam", "gece", "ayrıca",
      "herhangi", "olmuş", "oldu",
    ],
  ),
  en: new Set(
    [
      "the", "and", "is", "are", "were", "you", "your", "we", "our", "us", "to", "of", "for", "it", "its", "this",
      "that", "these", "those", "can", "could", "would", "should", "please", "thanks", "thank", "with", "have",
      "has", "had", "be", "been", "at", "there", "here", "what", "how", "where", "when", "which", "who", "why",
      "i", "my", "do", "does", "did", "not", "yes", "from", "if", "or", "any", "about", "just", "get", "got",
      "still", "also", "again", "very", "much", "many", "some", "there's", "it's", "i'm", "we're", "you're",
      "don't", "can't", "didn't", "i've", "i'll", "let", "know", "need", "want", "hi", "hello", "hey", "dear",
      "they", "them", "their", "shall", "into", "than", "then", "only",
      // Genel sık sözcükler (09-25 ikinci tur; alan sözcüğü değil, diğer dillerle çakışma denetlendi).
      "where's", "what's", "that's", "let's", "i'd", "you'll", "we'll", "we've", "they're", "isn't", "aren't",
      "won't", "wasn't", "couldn't", "wouldn't", "doesn't", "hope", "today", "tonight", "tomorrow", "something",
      "anything", "everything", "because", "before", "after", "being", "yours", "out", "up", "over", "other", "more",
    ],
  ),
  de: new Set(
    [
      "der", "die", "das", "und", "ist", "nicht", "ich", "sie", "wir", "ein", "eine", "einen", "einem", "einer",
      "mit", "für", "fur", "auf", "zu", "bitte", "danke", "gibt", "wie", "wo", "wann", "warum", "haben", "habe",
      "kann", "können", "konnen", "sind", "dem", "den", "auch", "noch", "uns", "unser", "unsere", "hallo", "guten",
      "vielen", "dank", "wohnung", "schlüssel", "wlan", "passwort", "zimmer", "ihr", "ihre", "ihnen", "gerne",
      // Genel sık sözcükler (09-25 ikinci tur; alan sözcüğü değil, diğer dillerle çakışma denetlendi).
      "mein", "meine", "meinen", "meinem", "beim", "bei", "nach", "oder", "aber", "wenn", "dass", "mich", "mir",
      "sehr", "heute", "wird", "werden", "schon", "jetzt", "möchte", "möchten", "würde", "würden", "soll", "sollen",
      "muss", "müssen", "darf", "hätte", "sein", "seine", "euch", "unserer", "keine", "kein", "nichts", "etwas",
      "alles", "wieder", "morgen", "abend", "gestern", "vielleicht", "leider", "gerade",
    ],
  ),
  fr: new Set(
    [
      "les", "et", "est", "je", "vous", "nous", "une", "pour", "avec", "pas", "qui", "bonjour", "merci", "dans",
      "sur", "il", "elle", "ce", "cette", "mon", "votre", "notre", "aux", "où", "très", "bien",
      "appartement", "clé", "voiture", "mot", "c'est", "j'ai", "n'est", "s'il", "plaît",
      // Genel sık sözcükler (09-25 ikinci tur; alan sözcüğü değil, diğer dillerle çakışma denetlendi).
      "bonsoir", "voudrais", "voudrions", "pouvez", "pourriez", "pouvons", "sommes", "avons", "avez", "êtes",
      "quand", "demain", "aujourd'hui", "beaucoup", "leur", "peut", "faut", "déjà", "toujours", "aussi",
      "parce", "chez", "rien", "moins", "nuit",
    ],
  ),
  es: new Set(
    [
      "el", "los", "las", "del", "por", "para", "con", "hola", "gracias", "está", "hay", "cuánto", "cuanto",
      "dónde", "donde", "cómo", "puedo", "podemos", "nuestro", "nuestra", "usted", "ustedes", "también", "muy",
      "pero", "bueno", "buenos", "días", "contraseña", "apartamento", "aparcamiento", "llave", "coche", "estamos",
      "tenemos", "hasta", "quiero", "queremos",
      // Genel sık sözcükler (09-25 ikinci tur; alan sözcüğü değil, diğer dillerle çakışma denetlendi).
      "qué", "cuándo", "porque", "estoy", "están", "tengo", "tiene", "necesito", "necesitamos", "podría",
      "podríamos", "mañana", "aquí", "ahora", "hacer", "gustaría", "sí", "cuesta", "noche", "llegamos", "somos",
      "eres", "hoy", "ayer", "mucho", "muchas",
    ],
  ),
};

// Harf kanıtı (yalnız listede OLMAYAN sözcükte, yarım ağırlık). Dillere ortak harfler (ç ö ü é) BİLİNÇLİ yok.
const LETTERS: Record<LatinLanguage, RegExp | null> = {
  tr: /[ğış]/u,
  en: null,
  de: /[äß]/u,
  fr: /[àâèêëîïôûùœ]/u,
  es: /[ñáíóú]/u,
};
// Ters soru / ünlem işareti yalnız İspanyolcada: metinde varsa bir kez +1 (belirteçlere girmez — harf değil).
const SPANISH_MARKS = /[¿¡]/u;

const LATIN: readonly LatinLanguage[] = ["tr", "en", "de", "fr", "es"];

// ── DESTEKLENMEYEN DİLLER (inceleme 09-25, P1): kesin ama YANLIŞ etiket istemde modele yanlış dili DAYATIR ─────────
// Ölçüldü: Farsça/Urduca/Kürtçe → "ar", Ukraynaca/Bulgarca/Sırpça/Kazakça → "ru", İtalyanca → "fr", Portekizce → "es",
// Felemenkçe → "en", İsveççe → "de", Azerice → "tr" (37 mesajın 23'ü). Bu işaretler görülünce hüküm YOK.
/** Rusçada olmayan Kiril harfleri (uk/be/sr/mk/kk). */
const CYRILLIC_NON_RUSSIAN = /[іїєґўјљњћђџәғқңөұүһ]/iu;
/** Bulgarca sık sözcükler (Rusçadan harfle ayrılmaz). */
const BULGARIAN_WORDS: ReadonlySet<string> = new Set(["ще", "има", "къде", "сте", "съм", "няма", "каква", "какво", "здравейте"]);
/** Arapçada olmayan Arap yazısı harfleri + Farsça/Urduca rakamlar (fa/ur/ckb/ps). */
const PERSO_ARABIC = /[پچژگکیٹڈڑںےھہۃڵۆێەڕټډړږښځڅېۍ۰-۹]/u;
/** Desteklenmeyen Latin dillerinin harfleri (pt/ro/pl/cs/sk/hr/sl/sv/da/no/hu/az/tk). Beş dilin yazımıyla çakışmaz. */
const FOREIGN_LETTERS = /[ãõășțąęłńśźżćřěůåøæőűəýňžšđčďťľ]/u;
/** Desteklenmeyen Latin dillerinin sık sözcükleri (it/pt/nl/sv/da/no/ro/pl/hr/hu/sq/ca/id). Beş dilin listesiyle KESİŞMEZ (pinli). */
const FOREIGN_WORDS: ReadonlySet<string> = new Set([
  // it
  "è", "sono", "siamo", "abbiamo", "avete", "vorrei", "vorremmo", "buongiorno", "buonasera", "salve",
  "della", "delle", "degli", "dello", "nella", "nel", "alla", "dalla", "questo", "questa", "anche", "perché",
  "tutto", "tutti", "posso", "possiamo", "arriviamo", "chiave", "possibile", "gli", "che", "più", "già", "c'è",
  "l'appartamento", "ho", "molto", "quando",
  // pt
  "não", "você", "vocês", "obrigado", "obrigada", "bom", "boa", "tem", "temos", "muito", "muita", "onde", "uma", "isso",
  "esse", "essa", "perto", "chegando", "chegamos", "olá", "oi", "estou", "também", "pela",
  "agora", "então", "senha", "chave", "porta", "qual", "cedo", "disponível", "estacionamento",
  // nl
  "het", "een", "ik", "jij", "wij", "zijn", "niet", "wat", "waar", "hoe", "hebben", "kunnen", "graag", "bedankt", "voor",
  "naar", "maar", "ook", "nog", "jullie", "komen", "sleutel", "wachtwoord", "goedemiddag", "goedemorgen", "goedenavond",
  "hoi", "bijna", "mogelijk", "kluis", "vinden", "aan", "op", "om", "dat",
  // sv / da / no
  "och", "är", "jag", "det", "att", "inte", "på", "för", "hej", "när", "vad", "nyckeln", "också",
  "väg", "möjligt", "hvad", "hvor", "jeg", "ikke", "hei", "koden",
  // ro
  "și", "în", "pentru", "bună", "mulțumesc", "mulțumim", "unde", "suntem", "avem", "aveți", "vă", "noi",
  "ziua", "seara", "spre", "vedem", "curând",
  // pl
  "jest", "się", "czy", "dziękuję", "gdzie", "proszę", "dzień", "dobry", "mamy", "możemy", "który", "również",
  "kiedy", "przy", "około", "cześć",
  // hr / sr (Latin) · hu · sq · ca · id
  "hvala", "koja", "lozinka", "pozdrav", "jó", "napot", "mikor", "lehet", "përshëndetje", "faleminderit", "është",
  "cili", "és", "quina", "apakah", "terima", "kasih", "tidak", "saya", "kami", "bisa",
]);

/**
 * Dil kanıtı OLMAYANLAR ayıklanır: bağlantı, e-posta, rakam içeren belirteç (kod, saat, şifre: "Lale2025", "15:00") ve
 * çift tırnak içindeki alıntı (Wi-Fi adı / şifre, tabela metni: `Network: "Işıklı Ev"`). Tek tırnak kesme işaretidir
 * ("it's", "15:00'te") — ayıklanmaz.
 */
function strip(text: string): string {
  return stripQuoted(text)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\S*\d\S*/g, " ");
}

/**
 * KISA alıntılar (≤ 60 karakter: Wi-Fi adı / şifre, tabela) ayıklanır. Uzun alıntı AYIKLANMAZ: tüm Türkçe cevabı
 * tırnağa almak kapıdan kaçmanın yolu olmasın (inceleme 09-25). Kıvrık tek tırnak ‘…’ alıntıdır; düz ' ve ’ kesme işareti.
 */
function stripQuoted(text: string): string {
  return text.replace(/"[^"\n]{0,60}"|“[^”\n]{0,60}”|«[^»\n]{0,60}»|„[^“”\n]{0,60}[“”]|‘[^’\n]{0,60}’/gu, " ");
}

/**
 * Belirteç metnin başında ya da cümle sonu işaretinden / satır sonundan hemen sonra mı (araya yalnız boşluk / tırnak /
 * ayraç)? Yalnız önceki 12 karakter okunur (uzun metinde belirteç başına sabit iş).
 */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 12), index);
  if (index <= 12 && /^[\s"'“”‘’«»„(¿¡]*$/u.test(before)) return true;
  return /[.!?…;\n][\s"'“”‘’«»„(¿¡]*$/u.test(before);
}

/**
 * Metnin dili — YALNIZ EMİNKEN; aksi `null`. Kısa/ belirsiz / karma metin ("ok", "👍", "Thanks!") `null` döner.
 */
export function confidentLanguage(text: string | null | undefined): ConfidentLanguage | null {
  if (!text) return null;
  const clean = strip(text);
  const letters = clean.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return null;
  const cyr = (clean.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const arab = (clean.match(/\p{Script=Arabic}/gu) ?? []).length;
  if (cyr >= 3 && cyr / letters.length > 0.5) {
    const bulgarian = (clean.toLowerCase().match(/\p{L}+/gu) ?? []).some((w) => BULGARIAN_WORDS.has(w));
    return CYRILLIC_NON_RUSSIAN.test(clean) || bulgarian ? null : "ru";
  }
  if (arab >= 3 && arab / letters.length > 0.5) return PERSO_ARABIC.test(clean) ? null : "ar";
  // Karma yazı (Kiril/Arap + Latin, ör. Rusça cümle + Türkçe adres): Latin sözcüklerle hüküm VERİLMEZ.
  if (cyr + arab >= 3 && (cyr + arab) / letters.length >= 0.2) return null;

  const score: Record<LatinLanguage, number> = { tr: 0, en: 0, de: 0, fr: 0, es: 0 };
  let foreign = 0;
  for (const match of clean.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu)) {
    const raw = match[0];
    const tok = raw.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().replace(/’/g, "'");
    if (FOREIGN_WORDS.has(tok)) {
      foreign += 1;
      continue;
    }
    let listed = false;
    for (const lang of LATIN) {
      if (WORDS[lang].has(tok)) {
        score[lang] += 1;
        listed = true;
      }
    }
    // Cümle İÇİNDE büyük harfle başlayan sözcük çoğu zaman ÖZEL AD ("Bağdat Caddesi", "Kadıköy", "São Paulo"): harf kanıtı
    // sayılmaz (inceleme 09-25, P2: Türkçe adres veren İngilizce/Rusça cevap Türkçe sanılıyordu). Cümle BAŞINDAKİ sözcük
    // sayılır ("Çıkış saati 11:00" kısa Türkçe cevabı yakalanmaya devam etsin — ikinci inceleme).
    if (listed || (/^\p{Lu}/u.test(raw) && !atSentenceStart(clean, match.index ?? 0))) continue;
    if (FOREIGN_LETTERS.test(tok)) {
      foreign += 1;
      continue;
    }
    for (const lang of LATIN) {
      const re = LETTERS[lang];
      if (re && re.test(tok)) score[lang] += 0.5;
    }
  }
  if (SPANISH_MARKS.test(clean)) score.es += 1;
  const ranked = LATIN.map((l) => [l, score[l]] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (best[1] < 2) return null;
  if (second[1] > 0 && best[1] < 2 * second[1]) return null;
  // Desteklenmeyen bir dilin kanıtı da ikinci aday gibi sayılır (İtalyanca "il" Fransızca listesinde, vb.).
  if (foreign > 0 && best[1] < 2 * foreign) return null;
  return best[0];
}

/**
 * Misafirin bu turdaki dili: SON mesaj eminse o; değilse cevapsız misafir mesajlarının TAMAMI birlikte. Hiçbiri
 * emin değilse `null` (istem eski kuralına döner: belirsizde İngilizce).
 */
export function guestTurnLanguage(latest: string, pending: readonly string[] = []): ConfidentLanguage | null {
  // Emin olunan son mesaj HER ZAMAN kazanır ("Sorry, I don't speak Turkish. Where is the key?" → en; ikinci inceleme:
  // dil adı yüzünden hüküm düşünce Türkçe cevap kapıdan geçiyordu). Belirsiz son mesaj bir DİL İSTİYORSA ("In English
  // please 🙏", "Türkçe bilmiyorum, İngilizce yazar mısınız?") önceki cevapsız mesajların diline DÖNÜLMEZ (ilk inceleme P3).
  const direct = confidentLanguage(latest);
  if (direct) return direct;
  if (pending.length === 0 || mentionsLanguageName(latest)) return null;
  return confidentLanguage([...pending, latest].join("\n"));
}

/**
 * Açık dil isteği — "In English please", "Could you answer in Turkish?", "auf Deutsch", "Türkçe yazar mısınız?".
 * ⚠️ Dil ADININ geçmesi yetmez: "Turkish breakfast / Turkish bath / a Turkish SIM card" Türkiye'deki misafir mesajlarında
 * çok sık ve dil isteği DEĞİL — o mesajlarda yönergeyi ve kapıyı düşürmek, Türkçeye kaymayı tam da engellenmesi gereken
 * yerde serbest bırakırdı. Bu yüzden iki sınıf: dilin KENDİ adı (Türkçe "-ce/-ca" adları, "Deutsch", Rusça "-ском"
 * biçimleri, Arapça "بال…") her geçişte; sıfat da olabilen adlar (English/Turkish/anglais/inglés…) yalnız istek
 * kalıbında ("in/en X", "speak/write/answer… (in) X", "X please").
 */
const LANGUAGE_NAME_ALWAYS: ReadonlySet<string> = new Set([
  "ingilizce", "türkçe", "turkce", "almanca", "fransızca", "fransizca", "ispanyolca", "rusça", "rusca", "arapça", "arapca",
  "deutsch", "englisch", "türkisch", "französisch", "spanisch", "russisch", "arabisch",
  "английском", "английски", "турецком", "немецком", "французском", "испанском", "русском", "русски", "арабском",
  "بالعربية", "بالعربي", "بالإنجليزية", "بالانجليزية", "بالانجليزي", "بالتركية", "بالفرنسية", "بالألمانية", "بالروسية",
]);
const LANGUAGE_NAME_IN_CONTEXT: ReadonlySet<string> = new Set([
  "english", "turkish", "german", "french", "spanish", "russian", "arabic",
  "anglais", "turc", "allemand", "français", "francais", "espagnol", "russe", "arabe",
  "inglés", "ingles", "turco", "alemán", "aleman", "francés", "frances", "español", "espanol", "ruso", "árabe",
]);
const LANGUAGE_REQUEST_BEFORE: ReadonlySet<string> = new Set([
  "in", "en", "speak", "speaks", "write", "reply", "answer", "respond", "talk", "text", "message", "parlez", "parler",
  "parles", "écrire", "ecrire", "répondre", "repondre", "habla", "hablas", "hablar", "escribir", "responder",
]);
const LANGUAGE_REQUEST_AFTER: ReadonlySet<string> = new Set(["please", "pls", "plz", "por", "s'il", "svp"]);

function mentionsLanguageName(text: string): boolean {
  const words = text.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
  return words.some((w, i) => {
    if (LANGUAGE_NAME_ALWAYS.has(w)) return true;
    if (!LANGUAGE_NAME_IN_CONTEXT.has(w)) return false;
    return LANGUAGE_REQUEST_BEFORE.has(words[i - 1] ?? "") || LANGUAGE_REQUEST_AFTER.has(words[i + 1] ?? "");
  });
}

/**
 * Cevapsız misafir mesajları = son GİDEN mesajdan sonraki gelen mesajlar (kanal kapısının `pendingGuestMessages`
 * kuralı). İstem bunu konuşma geçmişinden türetir; son giden mesajdan ÖNCEKİ misafir mesajları dili belirlemez.
 * Geçmiş güncel mesajla bitiyorsa (kanal / gelen kutusu yolları) o satır ÇIKARILIR — güncel mesaj ayrıca verilir ve
 * iki kez sayılırsa belirsiz bir "thanks" kesin hükme dönerdi (kapı `pendingGuestMessages`ta onu zaten saymaz).
 */
export function unansweredGuestTexts(
  history: readonly { direction: "inbound" | "outbound"; body: string }[],
  latest?: string,
): string[] {
  const lastOutbound = history.map((m) => m.direction).lastIndexOf("outbound");
  const texts = history.slice(lastOutbound + 1).filter((m) => m.direction === "inbound").map((m) => m.body);
  if (latest !== undefined && texts.length > 0 && texts[texts.length - 1] === latest) texts.pop();
  return texts;
}

/** Cümleler: nokta / soru / ünlem / noktalı virgülden SONRA boşluk ya da satır sonu ("3.5", "15:00" bölünmez). */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?؟;])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Kapı yüklemi: misafirin dili eminken cevabın TAMAMI ya da tek bir CÜMLESİ emince başka dildeyse `true` (cevap
 * otomatik gitmez). Cümle kuralı ölçülmüş kısmi kaymayı yakalar: 5.1 Almanca acil durum cevabının sonuna sistem
 * istemindeki Türkçe devir kalıbını ("Mesajınız kaydedildi; ev sahibiniz görebilir.") aynen yapıştırdı (09-25; kayıtlı
 * ~1.150 cevapta yanlış alarm 0). Misafir ya da cevap belirsizse `false` — yalnız SIKILAŞTIRIR, belirsizlik bir engel
 * sebebi değildir (cevap kalitesi, güvenlik değil).
 */
export function replyLanguageMismatch(guestLanguage: ConfidentLanguage | null, reply: string | null | undefined): boolean {
  if (!guestLanguage || !reply) return false;
  const whole = confidentLanguage(reply);
  if (whole !== null && whole !== guestLanguage) return true;
  // Kısa alıntı cümlelere bölmeden ÖNCE ayıklanır (iki cümlelik tabela alıntısı bölünüp yargılanmasın).
  return sentencesOf(stripQuoted(reply)).some((sentence) => {
    const lang = confidentLanguage(sentence);
    return lang !== null && lang !== guestLanguage;
  });
}
