// ---------------------------------------------------------------------------
// EVCİL HAYVAN / YARDIMCI HAYVAN — KOD KURALI (kurucu 10-23 akşam 4.4, seçenek A; aynen: "bedavaysa … hostta kabul ediyorsa gidebilir …
// ama emin olalım model sallamasın" · "yardımcı hayvanı sorusu ile normal evcil hayvan sorusu ayrışsın").
//
// Airbnb'de misafir ücret ödeyip evcil hayvanı rezervasyona ekleyebilir; ev sahibi ilanda evcil hayvanı kapatabilir. Hizmet / yardımcı hayvan
// ise Airbnb'nin erişilebilirlik politikasıyla reddedilemez ve evcil hayvan ücreti alınamaz (duygusal destek hayvanı yere göre değişir). Bu
// yüzden yapay zekâ evcil hayvan sorusunda YALNIZ bilgi tabanı açıkça "ücretsiz kabul" diyorsa ve koşul yazmıyorsa cevap verir ("Evet,
// getirebilirsiniz."); ücretli / koşullu / yasak / belirsiz → ev sahibine kalır. Yardımcı hayvan sorusu her zaman ev sahibine kalır ve ayrı
// işaretlenir. Bilgi tabanında "yasak" yazan kalem için ev sahibine uyarı (bilgi tabanı taraması).
//
// Saf, DB / ağ yok; karar bilgi tabanı METNİNDEN kodla verilir (model okumaz). Şüphede "bilinmiyor" (tut).
// ---------------------------------------------------------------------------

import { normalizeForRetrieval } from "@/lib/ai/retrieval/text";

/** Evcil hayvan anan sözcükler (katlanmış, harf sınırıyla). */
const PET_WORD =
  // "pet şişe" / "pet-bottle" (plastik şişe), "hot dog", İngilizce "chat" (Fransızca "chat" yalnız tanımlıkla), "hayvanat" (bahçesi), "кошмар",
  // "который" evcil hayvan değildir.
  /(?<![\p{L}\p{N}])(?:evcil|hayvan(?!at)\p{L}{0,8}|kedi\p{L}{0,6}|kopek\p{L}{0,6}|kopeg\p{L}{0,6}|pets?(?![)\s-]*(?:sise|bottle))|(?<!hot )dogs?|cats?|puppy|puppies|kitten|haustier\p{L}{0,3}|hunde?n?|hundes|katzen?|animaux|animal|chiens?|(?:les|le|mon|nos|des|un|votre|vos) chats?|mascotas?|perros?|gatos?|животн\p{L}{0,4}|собак\p{L}{0,3}|кошк\p{L}{0,2}|кошек|кот(?:а|ы|ом|у|ик\p{L}{0,2}|енок)?|питом\p{L}{0,4})(?![\p{L}\p{N}])/u;

/** Evcil hayvan kaleminde BAŞKA bir hizmet adı — "ücretsiz" onun olabilir ("Evcil hayvan kabul edilir; otopark ücretsizdir"). */
const OTHER_SUBJECT =
  /(?<![\p{L}])(?:otopark|park yeri|havuz|kahvalti|wi ?fi|internet|sauna|jakuzi|hamam|spa|spor|bisiklet|transfer|camasir|parking|pool|breakfast|gym|bike|shuttle|jacuzzi|hot tub|laundry|parkplatz|fruhstuck|petit[- ]dejeuner|desayuno|aparcamiento|piscine|piscina|парковк|завтрак|бассейн)/u;

/** Hizmet / yardımcı / destek hayvanı (çok dilli). Çıplak "ESA" İspanyolca "esa"dır, çıplak "emotional support" duygudur — ad öbeği şart. */
const ASSISTANCE_ANIMAL_SRC =
  "(?:yardimci (?:hayvan|kope[gk])|yardim kope[gk]|rehber kope[gk]|gorme engelli kope[gk]|(?:duygusal )?destek (?:hayvan|kope[gk])|" +
  "terapi (?:hayvan|kope[gk])|hizmet (?:hayvan|kope[gk])|assistance (?:animal|dog)|service (?:animal|dog)|guide dog|seeing[- ]eye dog|" +
  "emotional support (?:animal|dog|cat|pet)|support animal|therapy (?:animal|dog)|(?<![\\p{L}])esa (?:dog|cat|animal|letter)|assistenzhund|" +
  "blindenhund|blindenfuhrhund|therapiehund|chien (?:guide|d assistance)|animal d assistance|perro (?:guia|de asistencia|de servicio|de terapia)|" +
  "animal de (?:asistencia|apoyo|servicio)|собака[- ]поводырь|собака-помощник|служебн\\p{L}{0,3} собак)";
const ASSISTANCE_ANIMAL = new RegExp(ASSISTANCE_ANIMAL_SRC, "u");
const ASSISTANCE_ANIMAL_G = new RegExp(ASSISTANCE_ANIMAL_SRC, "gu");

/** Açık izin sözcükleri (katlanmış). */
const ALLOWED =
  /(?:kabul (?:edilir|ediyoruz|edilmektedir|ediliyor|gorur)|izin (?:verilir|veriyoruz|veriliyor|vardir)|serbest(?:tir)?|getirebilirsiniz|gelebilir|kalabilirsiniz|konaklayabilir|(?<![\p{L}])(?:welcome|allowed|permitted|accepted)(?![\p{L}])|erlaubt|willkommen|acceptes|autorises|admis|bienvenus|admitid|permitid|bienvenid|разрешен|допускаются)/u;

/** Olumsuzluk / yasak (katlanmış) — bir tanesi bile "ücretsiz kabul" okumasını bozar. */
const NEGATIVE =
  // Opus 10-23 akşam B1: "-emez / -amaz" yeterlilik olumsuzu ("kabul edilemez", "getirilemez", "getiremezsiniz"), "olmaz", "izin yok",
  // İngilizce "forbidden / prohibited / banned / disallowed" — biri yoksa "Kediler ücretsiz; köpekler kabul edilemez." ücretsiz kabul sayılıyordu.
  /(?:edilmez|edilmiyor|edilmemekte\p{L}*|edilemez|edilemiyor|getirilemez|getiremez\p{L}*|kabul edemiyoruz|verilmez|verilmiyor|verilmemekte\p{L}*|yasak|degil|kabul etmiyoruz|(?<![\p{L}])olmaz(?![\p{L}])|izin yok|(?<![\p{L}])(?:not|no|never|cannot|can t|don t|isn t|aren t|won t|forbidden|prohibited|banned|disallowed)(?![\p{L}])|kein|nicht|verboten|untersagt|interdit|refuse|non admis|pas (?:accept|autoris)|(?<![\p{L}])(?:no se|prohibid)|не (?:допуска|разреш)|запрещ|нельзя)/u;

/**
 * Türe göre ayrışan politika (Opus 10-23 akşam B1): kalem İKİ ayrı tür anıyorsa ("kediler … köpekler …") "ücretsiz kabul" hangi türe ait
 * belli değildir → evet denmez (ev sahibine).
 */
const SPECIES: readonly RegExp[] = [
  /(?<![\p{L}])(?:kedi\p{L}{0,6}|cats?|kitten|katzen?|(?:les|le|mon|nos|des|un|votre|vos) chats?|gatos?|кош\p{L}{0,3}|кот\p{L}{0,3})(?![\p{L}])/u,
  /(?<![\p{L}])(?:kopek\p{L}{0,6}|kopeg\p{L}{0,6}|(?<!hot )dogs?|puppy|puppies|hunde?n?|hundes|chiens?|perros?|собак\p{L}{0,3})(?![\p{L}])/u,
  /(?<![\p{L}])(?:kus\p{L}{0,4}|birds?|vogel|oiseaux?|pajaros?|птиц\p{L}{0,3}|tavsan\p{L}{0,4}|rabbits?|hamsters?|baliklar?|fish)(?![\p{L}])/u,
];

/** Açık ücretsizlik (katlanmış). */
const FREE_SRC =
  "(?:ucretsiz|ucret alinmaz|ucret alinmamaktadir|ucret talep edilmez|ek ucret (?:yok|alinmaz|alinmamaktadir)|ekstra ucret (?:yok|alinmaz)|bedava|" +
  // Çıplak "free" ücretsizlik DEĞİL ("Feel free to …", "smoke-free" — Opus 10-23 akşam B2): yalnız ücret bağlamı.
  "(?<![\\p{L}-])free of charge|(?<![\\p{L}-])for free(?![\\p{L}])|(?:pets?|dogs?|cats?) (?:stay|are|is) free(?![\\p{L}])|free for (?:pets?|dogs?|cats?)|" +
  "(?:at )?no (?:extra |additional )?(?:pet )?(?:fee|charge|cost)|kostenlos|kostenfrei|gebuhrenfrei|" +
  "gratuit\\p{L}*|sans frais|gratis|sin (?:cargo|coste|costo)|бесплатно)";
const FREE = new RegExp(FREE_SRC, "u");
const FREE_G = new RegExp(FREE_SRC, "gu");

/**
 * Koşul / ücret / tutar işaretleri — biri bile varsa "koşullu" (ev sahibine). Rakam her zaman koşul sayılır (kg, adet, tutar, saat).
 */
// İstisna sözcüğü ("hariç / dışında / except / außer / sauf / excepto") de koşuldur (Opus 10-28 R16: "Evcil hayvanlar ücretsiz kabul edilir,
// köpekler hariç." genel ücretsiz kabul sayılıyordu). Türkçe ekli biçimler de ("haricinde", "harici", "dışındaki"; Haiku 10-28); ek sabit
// kökten sonra sınırlı ({0,4}) → karesel iş yok.
const CONDITION =
  /(?:\p{Nd}|(?<![\p{L}])kg(?![\p{L}])|kilo|kucuk|buyuk|sadece|yalniz|onceden|haber ver|onay|izin al|depozito|teminat|temizlik ucreti|gecelik|ucretli|ucret (?:alinir|alinmaktadir|uygulan)|zorunlu|mecburi|gerek|sart|en fazla|en cok|tasma|kafes|bir adet|tek (?:bir )?(?:kedi|kope)|(?<![\p{L}])(?:only|small|large|max|maximum|up to|prior|approval|request|deposit|fee applies|per night|per stay|charge applies|if|provided|as long as|must|required|unless|one (?:dog|cat|pet))(?![\p{L}])|(?<![\p{L}])nur(?![\p{L}])|klein|vorher|genehmigung|kaution|gebuhr|hochstens|bis zu|wenn|seulement|uniquement|petit|caution|frais|(?<![\p{L}])si(?![\p{L}])|solo|solamente|unicamente|pequen|fianza|tarifa|(?<![\p{L}])si (?:es|son)|только|маленьк|залог|доплат|если|не более|in advance|let us know|notify|beforehand|leash|advance notice|inform us|vorab|anmelden|leine|avisar|antelacion|correa|laisse|prevenir|заранее|поводк|(?<![\p{L}])(?:ancak|ama|fakat|but|except|however|aber|mais|pero|lutfen|please|bitte|por favor)(?![\p{L}])|s il vous plait|пожалуйста|\p{L}(?:malidir|melidir|mamali|memeli)(?![\p{L}])|(?<![\p{L}])(?:haric\p{L}{0,4}|disinda\p{L}{0,3}|except|excluding|ausser|außer|sauf|excepto|salvo|кроме)(?![\p{L}]))/u;

/** Karşılaştırma biçimi: görünmez karakter yok, Türkçe harfler ASCII, kesme işareti boşluk ("can't" → "can t"), işaretler sökülür. */
const fold = (t: string) => normalizeForRetrieval(t).toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");

/** Metin evcil hayvan anıyor mu (yardımcı hayvan dahil). */
export function mentionsPets(text: string | null | undefined): boolean {
  if (!text) return false;
  const f = fold(text);
  return PET_WORD.test(f) || ASSISTANCE_ANIMAL.test(f);
}

/** Misafir hizmet / yardımcı / destek hayvanından söz ediyor mu. */
export function mentionsAssistanceAnimal(text: string | null | undefined): boolean {
  return !!text && ASSISTANCE_ANIMAL.test(fold(text));
}

/** Cümle bölme (nokta / ünlem / soru / satır sonu; "15.00" bölünmez). */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);

/**
 * Bilgi tabanı evcil hayvanı AÇIKÇA ÜCRETSİZ ve KOŞULSUZ kabul ediyor mu? Evcil hayvan anan HER kalem BÜTÜNÜYLE okunur (koşul / ücret sonraki
 * cümlede olabilir — Haiku 10-23 akşam: "… ücretsizdir. Depozito 500 TL alınır."): izin sözcüğü + açık ücretsizlik taşımalı; olumsuzluk /
 * yasak, rakam, koşul, ücret ya da başka bir hizmetin adı taşımamalı. Yalnız yardımcı hayvanı anan kalem evcil hayvan kanıtı değildir. Hiçbir
 * kalem evcil hayvan anmıyorsa ya da biri bile uymuyorsa `false` (ev sahibine). Saf.
 */
export function kbPetsFreeAllowed(kb: readonly { title: string; content: string }[]): boolean {
  let seen = 0;
  for (const item of kb) {
    const f = fold(`${item.title}: ${item.content}`);
    if (!PET_WORD.test(f.replace(ASSISTANCE_ANIMAL_G, " "))) continue;
    // Yardımcı hayvanı anan kalem sıradan evcil hayvan için kanıt sayılmaz ("Yardımcı hayvanlar ücretsiz kabul edilir" evcil hayvanı izinli
    // yapmaz); yasak / olumsuzluk taşıyorsa yine "hayır".
    if (ASSISTANCE_ANIMAL.test(f)) {
      if (NEGATIVE.test(f.replace(FREE_G, " "))) return false;
      continue;
    }
    seen += 1;
    // TÜR adı geçen kural genel "ücretsiz kabul" değildir (Opus 10-28 R16: "Kediler ücretsiz kabul edilir." köpek sorusuna "evet" dedirtiyordu;
    // "kediler … köpekler …" de belirsiz) → ev sahibine. Yalnız genel "evcil hayvan / pets" kuralı evet dedirtir.
    if (SPECIES.some((re) => re.test(f))) return false;
    if (!ALLOWED.test(f) || !FREE.test(f) || NEGATIVE.test(f.replace(FREE_G, " ")) || CONDITION.test(f) || OTHER_SUBJECT.test(f)) return false;
  }
  return seen > 0;
}

/**
 * Bilgi tabanında evcil hayvanı YASAKLAYAN cümle var mı (bilgi tabanı taraması uyarısı, seçenek A: "Yardımcı hayvanlar her durumda kabul
 * edilmeli; ilan ayarınızla uyumlu mu kontrol edin."). Saf.
 */
export function kbForbidsPets(kb: readonly { title: string; content: string }[]): boolean {
  for (const item of kb) {
    for (const raw of sentences(`${item.title}: ${item.content}`)) {
      const f = fold(raw);
      if (PET_WORD.test(f) && NEGATIVE.test(f.replace(FREE_G, " "))) return true;
    }
  }
  return false;
}

/** Giriş / çıkış konusu (hayvanı anmayan cümlede başka bir sorunun cevabıdır: "Check-in is not possible before 15:00" — Haiku 10-23 akşam). */
const STAY_TIME_SUBJECT =
  /(?<![\p{L}])(?:check ?-?in|check ?-?out|giris\p{L}{0,6}|cikis\p{L}{0,6}|anreise|abreise|arrivee|depart|llegada|salida|заезд\p{L}{0,2}|выезд\p{L}{0,2})(?![\p{L}])/u;
/** Kibar olumsuz kalıp ("No problem", "Sorun değil") olumsuzluk değildir. */
const POLITE_NEGATION =
  /(?<![\p{L}])(?:no problem|no worries|not a problem|sorun (?:degil|yok)|problem (?:degil|yok)|kein problem|pas de probleme|no hay problema|без проблем)(?![\p{L}])/gu;
/** Ücret / depozito sözcüğü (hayvanı anmayan cümlede de koşul taşır: "Evet, getirebilirsiniz. Gecelik ücret 200 TL."). */
const FEE_WORD =
  /(?<![\p{L}])(?:ucret\p{L}{0,6}|depozito|teminat|fee|fees|charge\p{L}{0,2}|deposit|surcharge|gebuhr\p{L}{0,2}|kaution|frais|caution|cargo|tarifa|fianza|доплат\p{L}{0,2}|залог\p{L}{0,2})(?![\p{L}])/u;

/**
 * Bilgi tabanı "ücretsiz kabul" derken CEVAP aynı yönde mi (Opus 10-23 akşam B4; kurucu "model sallamasın"): evcil hayvanı anan cümlede
 * olumsuzluk / yasak, rakam / koşul ya da ücret → `true` (ev sahibine). Misafirin mesajı evcil hayvan soruyorsa (`petTurn`) hayvanı anmayan
 * cümle de okunur ("Maalesef kabul edemiyoruz." · "Gecelik ücret 200 TL.") — başka bir hizmetin adını taşıyan cümle hariç ("Wi-Fi şifresi
 * …"). Açık ücretsizlik ifadesi ("ücretsiz", "no extra fee") ve kibar olumsuz kalıp ("No problem") okumadan önce silinir. Saf, doğrusal.
 */
export function petReplyStraysFromFreeKb(reply: string | null | undefined, petTurn: boolean): boolean {
  for (const raw of sentences(reply ?? "")) {
    const f = fold(raw);
    const plain = f.replace(FREE_G, " ").replace(POLITE_NEGATION, " ");
    if (PET_WORD.test(f) || ASSISTANCE_ANIMAL.test(f)) {
      if (NEGATIVE.test(plain) || CONDITION.test(plain) || FEE_WORD.test(plain)) return true;
    } else if (petTurn && !OTHER_SUBJECT.test(f) && !STAY_TIME_SUBJECT.test(f) && (NEGATIVE.test(plain) || FEE_WORD.test(plain))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// S3 (kurucu kararı 11-11; anahtar `AI_HELD_PET_SPLIT_ENABLED`, VARSAYILAN KAPALI) — "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?"
//
// Evcil hayvan isteği ev sahibine BIRAKILDIĞINDA (öğe kipi: istek ayrı öğe, tutuluyor) öteki isteklerin cevabı bugün yalnız bu yüzden
// tutuluyor (10-28 R18 kemeri: tutulan öğe de "hayvan turu" sayılır). Karar: öteki cevap GİDER, evcil hayvan sorusu ev sahibinde KALIR —
// ama cevap o soruya dair hiçbir onay / ret / koşul / ima taşımamalı. "Evet, getirebilirsiniz." hayvanı anmaz; "Tabii! Wi-Fi şifresi …"
// deki "Tabii" misafirin ilk sorusuna da okunur. Bu yüzden denetim hayvan sözcüğü aramakla yetinmez:
//   1. hayvanı / yardımcı hayvanı anan cümle → sızıntı;
//   2. onay / ret / kabul sözcüğü ("evet", "tabii", "maalesef", "yes", "of course" …) → sızıntı (konusu ne olursa olsun: aynı turda cevapsız
//      bir evet / hayır sorusu var); anlamı yere göre değişen sözcükler ("olur", "sure", "ja", "no") yalnız tek başına ünlemken;
//   3. getirme / izin / yasak fiili ("getirebilirsiniz", "kabul edilir", "allowed", "bring", "erlaubt" …) → sızıntı;
//   4. başka bir hizmetin adını taşımayan cümlede olumsuzluk ya da ücret ("Maalesef mümkün değil." · "Gecelik ücret 200 TL.") → sızıntı
//      (`petReplyStraysFromFreeKb` ile aynı okuma).
// Şüphede TUTAR (güvenli yön); gereksiz tutma oranı ölçülür. Saf, doğrusal (çapalı almaşıklar, iç içe niceleyici yok).
// ---------------------------------------------------------------------------

/** Anahtar yalnız tam "1" ile açılır (`STRICT_ONE_FLAGS`). */
export function heldPetSplitEnabled(): boolean {
  return process.env.AI_HELD_PET_SPLIT_ENABLED === "1";
}

/** Sızıntının türü (ölçüm ve kanıt için; karar yalnız "var / yok"). */
export type HeldPetLeak = "pet_mention" | "verdict_word" | "permission" | "unanchored_verdict";

/** Yeri ne olursa olsun onay / ret / kabullenme bildiren sözcükler (katlanmış). */
const VERDICT_ANYWHERE = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    "evet|tabi{1,2}(?: ?ki)?|elbette|memnuniyetle|hayir|maalesef|ne yazik ki|uzgunu[mz]|mumkun degil|" +
    "sorun (?:degil|yok|olmaz)|problem (?:degil|yok|olmaz)|sakinca(?:si)? yok|mahsuru yok|" +
    "yes|yeah|yep|of course|no problem|no worries|not a problem|unfortunately|sorry|afraid|" +
    "naturlich|selbstverstandlich|kein problem|leider|" +
    "oui|bien sur|pas de probleme|aucun probleme|malheureusement|desolee?s?|" +
    "por supuesto|sin problema|no hay problema|lamentablemente|desafortunadamente|lo siento|" +
    "конечно|без проблем|к сожалению|извините|" +
    "نعم|بالتاكيد|طبعا|للاسف" +
    ")(?![\\p{L}\\p{N}])",
  "u",
);

/**
 * Başka yerde başka anlam taşıyan onay / ret sözcükleri — yalnız TEK BAŞINA bir ünlem olduklarında ("Olur." · "Sure, …" · "No, …" ·
 * "Merhaba, olur."): yan cümlenin TAMAMI bu sözcükse. "No smoking inside." · "No hay toallas." · "Хорошо отапливается." bilgi cümlesidir
 * (Haiku 11-12: yan cümle başında aramak bunları da tutuyordu).
 */
const VERDICT_INTERJECTION = new RegExp(
  "^(?:olur|kesinlikle|tamam|peki|sure|certainly|absolutely|definitely|okay|ok|alright|no|ja|klar|gerne|nein|in ordnung|" +
    "non|d accord|si|claro|vale|да|нет|хорошо|ладно|لا|تمام)$",
  "u",
);
/** "No. 14" / "Nr. 3" / "No: 5" — kapı / daire numarası yazımı ret sözcüğü değildir (cümle bölücü "No." diye ayırır). */
const NUMBER_ABBREVIATION = /(?<![\p{L}\p{N}])(?:no|nr|num)\s?[.:]?\s?(?=\p{Nd})/giu;

/**
 * Hayvanı adıyla anmadan anan örtmeceler (Haiku 11-12: "Minik dostunuz da konaklayabilir." · "Furry friends are more than welcome." dört
 * denetimden de geçiyordu). Yalnız BU denetimde okunur — `mentionsPets` (bilgi tabanı ve misafir mesajı okuması) değişmez.
 */
const PET_EUPHEMISM = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    "(?:minik|kucuk|tuylu|patili|sevimli|dort ayakli|can) dost\\p{L}{0,8}|patili\\p{L}{0,6}|dort ayakli\\p{L}{0,6}|" +
    "furry|four legged|four-legged|fur bab(?:y|ies)|little friend\\p{L}{0,1}|companion animal\\p{L}{0,1}|" +
    "vierbeiner\\p{L}{0,2}|fellnase\\p{L}{0,1}|a quatre pattes|compagnons? a poils?|peludos?|cuatro patas|" +
    "четвероног\\p{L}{0,4}|пушист\\p{L}{0,4}" +
    ")(?![\\p{L}\\p{N}])",
  "u",
);

/** Getirme / kabul / izin / yasak fiilleri (katlanmış) — tutulan evcil hayvan sorusunun cevabı olarak okunur. */
const PERMISSION_VERB = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    "getirebilir\\p{L}{0,8}|getirin\\p{L}{0,3}|gelebilir\\p{L}{0,8}|konaklayabilir\\p{L}{0,8}|kalabilir\\p{L}{0,8}|katilabilir\\p{L}{0,8}|" +
    "kabul ed\\p{L}{0,12}|izin (?:ver\\p{L}{0,10}|var\\p{L}{0,4}|yok)|" +
    "serbest\\p{L}{0,4}|yasak\\p{L}{0,6}|beraberinizde|yaninizda getir\\p{L}{0,8}|" +
    "bring|allowed|permitted|accepted|forbidden|prohibited|(?:is|are|re|be) (?:[a-z]{1,10} ){0,2}welcome|welcome to (?:bring|come|join|stay)|" +
    "join (?:you|us)|come along|stay with (?:you|us)|" +
    "mitbring\\p{L}{0,4}|mitzubringen|erlaubt|gestattet|verboten|(?:ist|sind) (?:herzlich )?willkommen|" +
    "amener|autoris\\p{L}{0,4}|accept\\p{L}{0,4}|interdit\\p{L}{0,3}|(?:est|sont) l(?:e|a|es) bienvenu\\p{L}{0,2}|" +
    "traer|permitid\\p{L}{0,2}|admit\\p{L}{0,5}|acept\\p{L}{0,5}|prohibid\\p{L}{0,2}|" +
    "(?:es|son|sera|seran|sea|sean) (?:\\p{L}{1,10} ){0,2}bienvenid\\p{L}{0,2}|" +
    "можно|разреш\\p{L}{0,6}|запрещ\\p{L}{0,6}|нельзя|привози\\p{L}{0,3}|взять с собои|" +
    "مسموح|ممنوع|احضار" +
    ")(?![\\p{L}\\p{N}])",
  "u",
);

/**
 * "Yapamıyoruz / mümkün olmuyor / not possible" türü yeterlilik olumsuzu (katlanmış). Başka bir hizmetin cümlesinde bilgidir ("Check-in is not
 * possible before 15:00", "Havuz kışın kullanılamıyor") → yalnız KONUSUZ cümlede sızıntı sayılır ("Bu mümkün olmuyor." hangi sorunun cevabı?).
 */
const ABILITY_NEGATION = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    "mumkun (?:olmuyor|olmaz|olmayacak)|olmuyor|yapamiyoruz|yapamayiz|edemiyoruz|edemeyiz|alamiyoruz|alamayiz|veremiyoruz|veremeyiz|" +
    "not possible|cannot|can t|won t be able|unable|nicht moglich|geht nicht|pas possible|impossible|no es posible|imposible|" +
    "невозможно|не можем|не получится" +
    ")(?![\\p{L}\\p{N}])",
  "u",
);

/** Yan cümle bölme (virgül / noktalı virgül / iki nokta / parantez / boşluklu tire) — "Merhaba, olur." de yakalansın; "Wi-Fi" bölünmez. */
const clauses = (sentence: string) => sentence.split(/[,;:()]|\s[-–—]\s/u).map((c) => c.trim()).filter(Boolean);

/**
 * Cevap, ev sahibine bırakılan evcil hayvan isteğine dair bir onay / ret / koşul / ima taşıyor mu (S3)? `null` = taşımıyor (öteki isteklerin
 * cevabı gidebilir). Saf.
 */
export function heldPetLeak(reply: string | null | undefined): HeldPetLeak | null {
  if (!reply) return null;
  if (mentionsPets(reply) || PET_EUPHEMISM.test(fold(reply))) return "pet_mention";
  // Kapı / daire numarası kısaltması ("No. 14") cümle bölünmeden ÖNCE çıkarılır — yoksa "No." tek başına bir ret cümlesi gibi okunur.
  const text = reply.replace(NUMBER_ABBREVIATION, "");
  for (const raw of sentences(text)) {
    const f = fold(raw);
    if (VERDICT_ANYWHERE.test(f)) return "verdict_word";
    // Yan cümle yalnız harf / rakam / boşluğa indirilir ("Sure!" → "sure"); tek geçiş, doğrusal.
    if (clauses(raw).some((c) => VERDICT_INTERJECTION.test(fold(c).replace(/[^\p{L}\p{N}\s]/gu, "").trim()))) return "verdict_word";
    if (PERMISSION_VERB.test(f)) return "permission";
    if (!OTHER_SUBJECT.test(f) && !STAY_TIME_SUBJECT.test(f) && ABILITY_NEGATION.test(f)) return "unanchored_verdict";
  }
  return petReplyStraysFromFreeKb(text, true) ? "unanchored_verdict" : null;
}
