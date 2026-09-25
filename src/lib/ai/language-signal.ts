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

/** Bağlantı, e-posta, rakam içeren belirteç (kod, saat, şifre: "Lale2025", "15:00") dil kanıtı değildir. */
function strip(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\S*\d\S*/g, " ");
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
  if (cyr >= 3 && cyr / letters.length > 0.5) return "ru";
  if (arab >= 3 && arab / letters.length > 0.5) return "ar";

  const tokens = clean.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
  const score: Record<LatinLanguage, number> = { tr: 0, en: 0, de: 0, fr: 0, es: 0 };
  for (const raw of tokens) {
    const tok = raw.replace(/’/g, "'");
    let listed = false;
    for (const lang of LATIN) {
      if (WORDS[lang].has(tok)) {
        score[lang] += 1;
        listed = true;
      }
    }
    if (listed) continue;
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
  return best[0];
}

/**
 * Misafirin bu turdaki dili: SON mesaj eminse o; değilse cevapsız misafir mesajlarının TAMAMI birlikte. Hiçbiri
 * emin değilse `null` (istem eski kuralına döner: belirsizde İngilizce).
 */
export function guestTurnLanguage(latest: string, pending: readonly string[] = []): ConfidentLanguage | null {
  return confidentLanguage(latest) ?? (pending.length > 0 ? confidentLanguage([...pending, latest].join("\n")) : null);
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
  return sentencesOf(reply).some((sentence) => {
    const lang = confidentLanguage(sentence);
    return lang !== null && lang !== guestLanguage;
  });
}
