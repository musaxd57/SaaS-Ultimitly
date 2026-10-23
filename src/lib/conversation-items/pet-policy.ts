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
  /(?:edilmez|edilmiyor|edilmemektedir|verilmez|verilmiyor|yasak|degil|kabul etmiyoruz|(?<![\p{L}])(?:not|no|never|cannot|can t|don t|isn t|aren t|won t)(?![\p{L}])|kein|nicht|verboten|interdit|pas (?:accept|autoris)|(?<![\p{L}])(?:no se|prohibid)|не (?:допуска|разреш)|запрещ|нельзя)/u;

/** Açık ücretsizlik (katlanmış). */
const FREE_SRC =
  "(?:ucretsiz|ucret alinmaz|ucret alinmamaktadir|ucret talep edilmez|ek ucret (?:yok|alinmaz|alinmamaktadir)|ekstra ucret (?:yok|alinmaz)|bedava|" +
  "(?<![\\p{L}])free(?: of charge)?(?![\\p{L}])|(?:at )?no (?:extra |additional )?(?:pet )?(?:fee|charge|cost)|kostenlos|kostenfrei|gebuhrenfrei|" +
  "gratuit\\p{L}*|sans frais|gratis|sin (?:cargo|coste|costo)|бесплатно)";
const FREE = new RegExp(FREE_SRC, "u");
const FREE_G = new RegExp(FREE_SRC, "gu");

/**
 * Koşul / ücret / tutar işaretleri — biri bile varsa "koşullu" (ev sahibine). Rakam her zaman koşul sayılır (kg, adet, tutar, saat).
 */
const CONDITION =
  /(?:\p{Nd}|(?<![\p{L}])kg(?![\p{L}])|kilo|kucuk|buyuk|sadece|yalniz|onceden|haber ver|onay|izin al|depozito|teminat|temizlik ucreti|gecelik|ucretli|ucret (?:alinir|alinmaktadir|uygulan)|zorunlu|mecburi|gerek|sart|en fazla|en cok|tasma|kafes|bir adet|tek (?:bir )?(?:kedi|kope)|(?<![\p{L}])(?:only|small|large|max|maximum|up to|prior|approval|request|deposit|fee applies|per night|per stay|charge applies|if|provided|as long as|must|required|unless|one (?:dog|cat|pet))(?![\p{L}])|(?<![\p{L}])nur(?![\p{L}])|klein|vorher|genehmigung|kaution|gebuhr|hochstens|bis zu|wenn|seulement|uniquement|petit|caution|frais|(?<![\p{L}])si(?![\p{L}])|solo|solamente|unicamente|pequen|fianza|tarifa|(?<![\p{L}])si (?:es|son)|только|маленьк|залог|доплат|если|не более)/u;

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
