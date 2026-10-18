import { firstBreakdownDevice, foldTurkishAscii } from "@/lib/ai/fallback";
import { explicitTimeMentions } from "@/lib/early-checkin/text-checks";
import type { CommitmentKind, CommitmentTopic, DayPartCode } from "@/lib/guest-commitments-core";
import { deviceTopicsOf, topicsOf } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// YAPAY ZEKÂ EYLEM ÖNERİLERİ — SAF ÇEKİRDEK (yürütme sırası ⑤ ilk dilimi; kurucu 10-12: "A + B + C", onay "sahip + yönetici, 2 hafta
// ≥ %90"; tasarım `docs/TASARIM-2026-10-11-otonom-ai-ilk-dilim-onerisi.md`). LLM YOK, DB YOK — kural tabanlı tespit; her öneri ev
// sahibinin TEK TIKLA onayını bekler (otomatik eylem yok). Misafire hiçbir şey GÖNDERİLMEZ.
//  A görev  · misafir mesajından operasyonel görev (mevcut `detectOperationalTask`; işletmenin otomatik görev anahtarı KAPALIYKEN)
//  B Wi-Fi  · ev sahibinin misafire yazdığı şifre / ağ adı bilgi tabanındakinden FARKLI → bilgi tabanını güncelle
//  C söz    · ev sahibinin misafire verdiği söz ("yarın sabah teknisyen gelecek") → açık söz + görev
// ---------------------------------------------------------------------------

export const SUGGESTION_KINDS = ["task", "kb_wifi", "commitment"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
  task: "Görev önerisi",
  kb_wifi: "Bilgi tabanı düzeltmesi",
  commitment: "Söz kaydı önerisi",
};

/** Öneri penceresi: bu kadar eski mesajdan öneri çıkmaz (gün). */
export const SUGGESTION_WINDOW_DAYS = 7;
/** "Beğenirsek otomatik" ölçütü (kurucu 10-12): pencere, en az karar sayısı, en düşük düzenlemesiz onay oranı. */
export const AUTO_PROMOTION_WINDOW_DAYS = 14;
export const AUTO_PROMOTION_MIN_DECISIONS = 10;
export const AUTO_PROMOTION_MIN_RATE = 0.9;

/** Kararlı öneri anahtarı (`<tür>:<kaynak>`) — kaynak bir kimlik dizisidir; metin / PII TAŞIMAZ. */
export function suggestionKey(kind: SuggestionKind, source: string): string {
  return `${kind}:${source}`;
}

export function parseSuggestionKey(key: unknown): { kind: SuggestionKind; source: string } | null {
  if (typeof key !== "string" || key.length > 200) return null;
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const source = key.slice(i + 1);
  if (!(SUGGESTION_KINDS as readonly string[]).includes(kind) || !/^[A-Za-z0-9_:-]{1,160}$/.test(source)) return null;
  return { kind: kind as SuggestionKind, source };
}

// ── C · SÖZ ──────────────────────────────────────────────────────────────────

const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";
const PROMISE_TR =
  "(?:getir(?:ecegim|ecegiz|ecek|ecekler|ilecek|irim|iriz|tecegim|tirecegim|eyim|iyorum|iyoruz|iyorlar|iyor)|gonder(?:ecegim|ecegiz|ecek|ilecek|irim|iriz|iyorum|iyoruz)|yolla(?:yacagim|yacagiz|yacak|rim)|birak(?:acagim|acagiz|acak)|yap(?:acagim|acagiz|acak|ilacak)|gel(?:ecek(?!\\s+(?:hafta|ay|yil|sefer|misafir|konuk|kisi|grup|rezervasyon|sezon))|ecekler|ecegim|ecegiz|iyor|iyorlar)|ugra(?:yacak|yacagim|yacagiz)|bak(?:acak|acagim|acagiz|acaklar)|ilgilen(?:ecegim|ecegiz|ecek)|halled(?:ecegim|ecegiz|ecek|ilecek)|hallederim|tamir\\s+(?:edilecek|edecek|edecegim|ettirecegim)|degistir(?:ecegim|ecegiz|ecek|ilecek)|temizle(?:necek|yecek|yecegim|yecegiz)|ayarla(?:yacagim|yacagiz|nacak|rim))";
// Kesmesiz "Ill / Well" yalnız dar fiille (Opus gece-4 F5 kesmeyi zorunlu yaptı: "went well" söz sayılıyordu; Haiku: "Ill bring towels tomorrow"
// sessizce düşüyordu). "come" / "check" YOK: "You are well come" (welcome yazım hatası) ve "works well check-in…" söz değildir; durum
// sözcüğünden sonraki "well" ("Everything went well send…", "works well fix…") zarftır — Haiku gece-4.
const PROMISE_EN =
  "(?:i['’]?m\\s+sending|i\\s+am\\s+sending|i['’]ll|i\\s+will|we['’]ll|we\\s+will|ill\\s+(?:bring|send|drop|fix|deliver)|(?<!(?:went|work(?:s|ed)?|did|done|go(?:es|ing)?|very|as|so|pretty|quite|really|is|was|are|were|be|been|all)\\s)well\\s+(?:bring|send|drop|fix|deliver)|(?:someone|somebody|(?:(?:the|a|an|our)\\s+)?(?:technician|cleaner|plumber|electrician|engineer|housekeeper)s?|housekeeping|maintenance|he|she|they)\\s+will|(?:is|are)\\s+(?:coming|on\\s+(?:the|his|her|their)\\s+way))";
const PROMISE = new RegExp(`${NL}(?:${PROMISE_TR}|${PROMISE_EN})${NR}`, "u");
/** Teklif / koşul söz değildir ("isterseniz getirebilirim", "if you need I'll bring"). */
const CONDITIONAL = new RegExp(`${NL}(?:eger|isterseniz|istersen|gerekirse|ihtiyac\\p{L}{0,6}\\s+olursa|if|unless)${NR}`, "u");
/** İptal / engel söz değildir ("teknisyen izinli", "won't come", "iptal oldu") — cümlecik boyunca (Haiku 10-12). */
const NEGATION = new RegExp(`${NL}(?:iptal|olmayacak|gelmeyecek|gelemeyecek|izinli|won['’]?t|will\\s+not|cannot|can['’]?t|not\\s+coming|cancel\\p{L}*)${NR}`, "u");
/** Kararsız söz (kurucu 10-17 gece; Opus: "belki / emin değilim" söz sayılıyordu) — cümlecikte varsa söz DEĞİL (görev açılmaz). */
const HEDGE = new RegExp(
  `${NL}(?:belki|galiba|sanirim|muhtemelen|emin\\s+degil\\p{L}{0,6}|maybe|perhaps|probably|not\\s+sure)${NR}`,
  "u",
);
/**
 * Dilek ("umarım", "inşallah", "hopefully") YALNIZ sözün kendi kapsamında ya da hemen solundaki YALIN dilek parçasında sözü kararsız yapar:
 * "Umarım yarın teknisyen gelecek" / "Umarım, teknisyen yarın gelecek" söz değil; "Teknisyen yarın 10'da gelecek, umarım sorun hemen çözülür"
 * sözdür (dilek SONUÇ için — Opus 10-17 gece O6); "Umarım iyisinizdir, teknisyen yarın 10'da gelecek" de sözdür (dilek selamlaşma — Haiku
 * 10-17 gece 2. tur).
 */
// Opus gece-4 F15: "umuyorum / umarız / I hope" da dilektir.
const HEDGE_WISH = new RegExp(`${NL}(?:umarim|umariz|umuyorum|umuyoruz|insallah|hopefully|i\\s+hope|we\\s+hope)${NR}`, "u");
/**
 * Sözü ev sahibinin TEYİDE bağladığı soru ("…, uygun mu?", "…, olur mu?", "is that ok?") — söz henüz kesin değil (Opus 10-17 gece O3: ayrı
 * soru kuralı bunları da söz sayıyordu). "Başka bir ihtiyacınız var mı?" teyit DEĞİL, sözü bozmaz.
 */
const CONFIRM_QUESTION = new RegExp(
  `${NL}(?:uygun|olur|musait\\p{L}{0,6}|tamam|sorun\\s+olur|ok(?:ay)?|works?|fine|alright|good\\s+for\\s+you|convenient)${NR}`,
  "u",
);
/**
 * Genel hal sorusu ("Is everything else ok?", "Daire nasıl, her şey tamam mı?") sözün TEYİDİ değildir — nezaket kapanışı (Opus gece-4 dilim
 * sonu B5: kapanış sorusundaki "ok / tamam" gerçek sözü düşürüyordu).
 */
const GENERAL_CHECK = new RegExp(`${NL}(?:her\\s*sey\\p{L}{0,3}|baska\\s+(?:bir\\s+)?(?:sey\\p{L}{0,3}|ihtiyac\\p{L}{0,6}|soru\\p{L}{0,4}|istek\\p{L}{0,4}|isteg\\p{L}{0,4}|talep\\p{L}{0,4})|everything|anything|all\\s+good|daire\\p{L}{0,4}|konaklama\\p{L}{0,4}|the\\s+(?:apartment|flat|room|stay))${NR}`, "u");
/** Aktarılan / geçmiş söz ("teknisyen yarın gelecek DEMİŞTİM", "GELEMEDİ") — söz fiilinin PARÇASINDA ise o söz değil (Opus 10-17). */
const REPORTED = new RegExp(
  `${NL}(?:demistim|demistik|soylemistim|soylemistik|dedigim\\s+gibi|gelemedi|gelmedi|getiremedim|getiremedik|yapamadi|as\\s+i\\s+said|i\\s+told\\s+you)${NR}`,
  "u",
);
/**
 * Aktarma GİRİŞİ ("dediğim gibi, …", "as I said, …", "I told you, …") sözün SOLUNDAKİ parçada da sözü aktarılan söz yapar (Haiku 10-17 gece:
 * virgülle ayrılınca kaçıyordu). "Gelmedi / gelemedi" ise yalnız sözün kendi parçasında: "Teknisyen bugün gelmedi, yarın 10'da gelecek"
 * YENİ bir sözdür.
 */
const REPORTED_LEAD = new RegExp(`${NL}(?:dedigim\\s+gibi|soyledigim\\s+gibi|as\\s+i\\s+said|as\\s+mentioned|i\\s+told\\s+you)${NR}`, "u");
/**
 * SAAT DEĞİŞİKLİĞİ ("11'e kaydı", "yarına ertelendi", "saat değişti", "rescheduled", "moved to 11") — kurucu 10-17 gece: aynı sözün saati
 * BAĞLAMLA güncellenir. Söz fiili olmasa da söz cümleciği sayılır ama YALNIZ zaman bilgisiyle (`promiseAt`). "kaydı" tek başına AD olabilir
 * ("rezervasyon kaydı") → yalnız YÖNELME ekli saat / gün / dilim ardından ("11'e kaydı", "yarına alındı"); "Arıza kaydınız bugün alındı"
 * değişiklik DEĞİL (Opus 10-17 gece O5: yalın gün sözcüğü uydurma "bugün" sözü açıyordu); çıplak "değişti" de olmaz ("klima değişti").
 */
const RESCHEDULE = new RegExp(
  `${NL}(?:(?:\\d{1,2}(?:[:.]\\d{2})?\\s*(?:['’]\\s*)?(?:e|a|ye|ya)|yarina|bugune|sabaha|aksama|ogleye|aksamustune|ogleden\\s+sonraya)\\s+(?:kaydi|kaydirildi|kaydirdik|alindi|ertelendi|erteledik)|ertelendi|erteledik|ertelenmistir|saat\\p{L}{0,4}\\s+degis\\p{L}{0,6}|rescheduled|postponed|pushed\\s+back|moved\\s+to)${NR}`,
  "u",
);

/**
 * GEÇMİŞE ATIF (Haiku 10-17 gece): "dün gece", "geçen akşam", "last night" — sözün zamanı DEĞİL. Zaman / dilim okunmadan önce kapsamdan
 * silinir ("Dün gece klima bozuldu teknisyen yarın gelecek" → "yarın", gece dilimi değil); geçmişe atıf taşıyan virgül parçası söze katılmaz.
 */
const PAST_PART = new RegExp(
  `${NL}(?:dun|gecen|onceki|yesterday|last)\\s+(?:gece|aksam|sabah|ogle|night|evening|morning|afternoon)\\p{L}{0,5}${NR}`,
  "gu",
);
/** Selam ("İyi akşamlar", "Good evening") gün dilimi değildir (Opus gece-4 F2: "İyi akşamlar teknisyen yarın 9'da gelecek" → yarın 21:00). */
const GREETING_PART = new RegExp(`${NL}(?:(?:iyi|hayirli|tatli)\\s+(?:aksamlar|geceler|sabahlar|gunler)|good\\s+(?:morning|afternoon|evening|night))${NR}`, "gu");
const PAST_REF = new RegExp(`${NL}(?:dun|gecen|onceki|demin|az\\s+once|yesterday|last\\s+(?:night|week)|earlier\\s+today)${NR}`, "u");

/**
 * "değil" / "yok" YALNIZ söz fiilinin bulunduğu virgül parçasında ve fiilden SONRA olumsuzlar ("temizlikçi gelecek değil", "bugün gelecek
 * teknisyen yok"). Başka parçadaki ya da fiilden önceki "yok" sözü bozmaz ("Havlu yok demişsiniz, yarın getireceğim" — Haiku 10-12 2. tur).
 */
const NEGATION_AFTER_VERB = new RegExp(`${NL}(?:degil|yok)${NR}`, "u");
/** Virgül parçası ayracı (karşıtlık bağlacı da parça başlatır). İki rakam arasındaki virgül ayraç DEĞİLDİR ("1,5 saat"). */
const SEGMENT_SPLIT = /(?<!\d),|,(?!\d)|(?<![\p{L}\p{N}])(?:ama|fakat|ancak|but)(?![\p{L}\p{N}])/u;
/**
 * Gün sözcükleri: tanınan (bugün / yarın, ekli biçimler "yarına", "yarınki") ve TANINMAYAN (haftanın günleri ekleriyle, "yarından sonra",
 * "2 gün sonra", "önümüzdeki hafta") — tanınmayanda öneri YOK (yanlış son tarih tek tıkla yazılmasın — Haiku 10-12, 3. tur).
 * Haiku gece-4: "ertesi / öbür / sonraki sabah", "the next day / morning" de tanınmayan (bugüne düşüp yanlış günlü görev açıyordu); hafta günü
 * yalnız hâl ekleriyle ("salıya", "cumadan", "pazartesileri") — "Salim," / "Salih," ad, gün değil (söz sessizce düşüyordu).
 */
// "bu sabah / bu akşam / this evening" açıkça bugündür (Opus gece-4 F12 / F14).
const DAY_TODAY = /(?<![\p{L}\p{N}])(?:bugun\p{L}{0,3}|today|tonight|bu\s+(?:sabah|aksam|gece|ogle(?:den\s+sonra)?)\p{L}{0,3}|this\s+(?:morning|afternoon|evening))(?![\p{L}])/u;
// Opus gece-4 F3: yaygın yazım hataları ("tomorow", "tommorow", "tmrw") yarındır — bugüne düşüp yanlış günlü görev açıyordu.
const DAY_TOMORROW = /(?<![\p{L}\p{N}])(?:yarin(?:a|ki)?|tomm?orr?ow|tmrw?)(?![\p{L}])/u;
const DAY_UNKNOWN = new RegExp(
  `${NL}(?:(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)(?:y?[ae]|[dt][ae]n?|ki|n?in|y?i|si|l[ae]r[i]?|nd[ae]n?)?|yarindan\\s+(?:sonra|itibaren)|oburgun\\p{L}{0,2}|obursugun\\p{L}{0,2}|bayram\\p{L}{0,6}|(?:pzt|sal|crs|car|prs|per|cum|cmt|paz)\\.?\\s+gunu|(?:obur|ertesi|sonraki)\\s+(?:gun|sabah|aksam|ogle|gece)\\p{L}{0,3}|(?:the\\s+)?(?:next|following)\\s+(?:day|morning|afternoon|evening|night)|the\\s+day\\s+after|\\d{1,2}\\s*(?:gun\\p{L}{0,3}|hafta\\p{L}{0,3}|ay(?:a|da|dan)?(?![\\p{L}\\p{N}]))|(?:bir|iki|uc|dort|bes|birkac)\\s+(?:gun\\p{L}{0,3}|hafta\\p{L}{0,3}|ay(?:a|da|dan)?(?![\\p{L}\\p{N}]))|onumuzdeki|gelecek\\s+hafta\\p{L}{0,2}|haftaya|hafta\\s+(?:sonu|ici)\\p{L}{0,3}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+(?:week|month)|weekend|day\\s+after\\s+tomorrow|in\\s+(?:\\d+|a|an|one|two|three|a\\s+few|few)\\s+(?:days?|weeks?|months?))${NR}`,
  "u",
);
/**
 * TAKVİM TARİHİ (Haiku 10-17 gece 2. tur + ölçüm): "25 Ekim'de", "ayın 25'inde", "ay sonunda", "bu ay", "gelecek ay", "October 25", "the 25th",
 * "25/10", "25.10.2026" — bugün / yarın modelinin dışında → tanınmayan gün gibi öneri YOK (ölçüldü: hepsi BUGÜN sayılıp bugüne görev açıyordu).
 * Gün/ay yalnız geçerli aralıkta (gün 1–31, ay 1–12): "7/24" (her zaman) tarih DEĞİL; ay adına "-lı/-lu" sıfat eki gelirse ("2 ocaklı ocak")
 * tarih değil (Haiku 10-17 gece 4. tur: sözün sağındaki "7/24 ulaşabilirsiniz" sözü düşürüyordu).
 * Opus gece-3 F9: "24/7" (İngilizce "her zaman"), kapı / daire numarası ("No:12/3"), "1/2 saat", "2nd floor" tarih DEĞİL; sıra sayısı yalnız
 * "the / on the 25th" ya da "25th of" biçiminde tarihtir.
 * Gün-nokta-ay yalnız gün 24–31 ise ("25.10"); "12.10" saattir (12:10). Ad olmayan "aylık" / "aydır" / "ayar" tarih DEĞİL ("Bir aylık bakım
 * için teknisyen yarın 10'da gelecek" sözdür). Bitişik boşluk niceleyicileri arasındaki isteğe bağlı ayraç `\s*(?:X\s*)?` (karesel iş yok).
 */
const CALENDAR_DATE = new RegExp(
  `${NL}(?:\\d{1,2}\\s*(?:['’.]\\s*)?(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?!l[iu])\\p{L}{0,5}|ayin\\s+(?:\\d{1,2}|ilk|son|sonu\\p{L}{0,4}|basi\\p{L}{0,4}|ortasi\\p{L}{0,4})|ay\\s+(?:sonu|basi|ortasi|icinde)\\p{L}{0,4}|(?:bu|gelecek|ertesi)\\s+ay(?:a|da|in|ki)?|\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|(?<!(?:no|daire|kapi|apt)\\s?[:.]?\\s?)(?!24/7(?:[^\\p{L}\\p{N}'’]|$))(?:0?[1-9]|[12]\\d|3[01])/(?:0?[1-9]|1[0-2])(?![\\d/])(?!\\s*(?:saat|hour|kat|floor|puan))|(?:2[4-9]|3[01])\\.(?:0?[1-9]|1[0-2])|january|february|march|april|june|july|august|september|october|november|december|may\\s+\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?may|(?:the|on)\\s+\\d{1,2}(?:st|nd|rd|th)(?!\\s+(?:floor|bedroom|room|flat|apartment|door))|\\d{1,2}(?:st|nd|rd|th)\\s+of|this\\s+month|end\\s+of\\s+(?:the\\s+)?month)${NR}`,
  "u",
);

const KIND_TOPICS: ReadonlyArray<readonly [CommitmentKind, RegExp]> = [
  [
    "maintenance",
    new RegExp(
      `${NL}(?:teknisyen|tamir|usta|tesisatci|elektrikci|teknik\\s+servis|servis\\s+(?:elemani|ekibi|gorevlisi|teknisyeni)|ariza|bakim|klima|kombi|sofben|petek|bulasik\\s+makinesi|camasir\\s+makinesi|buzdolabi|(?:technicians?|repair|fix|plumbers?|electricians?|maintenance|engineers?|heater|boiler)${NR})`,
      "u",
    ),
  ],
  ["cleaning", new RegExp(`${NL}(?:temizlik|temizlikci|temizle|(?:cleaning|cleaners?|housekeeping|clean)${NR})`, "u")],
  ["towels", new RegExp(`${NL}(?:havlu|carsaf|nevresim|yastik\\s+kilif|(?:towels?|sheets?|linens?|bedding)${NR})`, "u")],
  [
    "supplies",
    new RegExp(
      `${NL}(?:tuvalet\\s+kagidi|kagit\\s+havlu|sampuan|sabun|deterjan|kahve|cay|seker|pil|ampul|cop\\s+poseti|icme\\s+suyu|damacana|(?:toilet\\s+paper|shampoo|soap|coffee|tea|detergent|bulbs?|batter(?:y|ies)|supplies)${NR})`,
      "u",
    ),
  ],
];

export interface HostPromise {
  kind: CommitmentKind;
  /** Sözün KONUSU (I1, migration 73) — yalnız sözün parçasından, kodla; tek konu yoksa null (`commitmentTopicOf`). */
  topic: CommitmentTopic | null;
  /** Gün: misafire söylenen ("yarın") ya da varsayılan bugün. */
  day: "today" | "tomorrow";
  /** Açık saat adayları (dakika; "6" → 06:00 ve 18:00) — gün dilimi ya da gündüz tercihiyle süzülmüş; seçim `promiseDue`da. */
  timeCandidates: number[];
  /** AÇIK göreli süre ("30 dakika içinde" 30, "1,5 saat sonra" 90, "yarım saat içinde" 30) — açık saat yoksa. "Birazdan" süre DEĞİL (↓ `soon`). */
  inMinutes: number | null;
  /** Açık saat ve süre YOKKEN gün dilimi ("sabah", "akşam") — kod + pencere sonu. Saat UYDURULMAZ (kurucu 10-17: "akşam yazmışsa akşam olarak tutsun"). */
  cue: { minutes: number; half: DayHalf; code: DayPartCode; end: number } | null;
  /** "Birazdan / hemen / soon" — saat değil; "kısa süre içinde" (kurucu 10-17: saat uydurulmaz). */
  soon: boolean;
  /** Saat DEĞİŞİKLİĞİ cümleciği ("11'e kaydı", "ertelendi") — bağlamla aynı sözün saati güncellenir (kurucu 10-17 gece). */
  reschedule: boolean;
  /** Gün sözcüğü ("bugün" / "yarın") kapsamda AÇIK mı — yoksa gün varsayılandır (saat değişikliği eski sözün gününe uygulanır, Opus O4). */
  dayExplicit: boolean;
  /**
   * Sözü YAPAN (Opus 10-17 gece O1: "Klima için teknisyen yarın 10'da" ile "Klima kumandasının pilini akşam getireceğim" aynı konu ama AYRI
   * söz): `visit` (teknisyen / usta / temizlikçi gelecek) · `delivery` (getireceğim / göndereceğim) · null (anlaşılmadı). Bağlam eşleşmesinde
   * farklı yapan ayrı sözdür; bilinmeyen yapan kendiliğinden taşınmaz (kart sorar).
   */
  actor: "visit" | "delivery" | null;
  /** Kapsamda birbirinden farklı birden çok saat var ("Dün akşam 9'da bozuldu, yarın 11'de gelecek", "10:00–12:00 arası") — saat SEÇİLMEZ, kart sorar (O9). */
  timeAmbiguous: boolean;
  /**
   * Sözün KENDİ gün sözcüğü yok ama mesajın başka yerinde yarın / tanınmayan gün / takvim tarihi geçiyor ("Teknisyen yarın 10'da gelecek.
   * Havlu getireceğim.") — gün tahmin edilmez: kendiliğinden kaydedilmez, kart günü SORAR (sert itirazcı 10-17 gece-4, kural 3). "Şimdi /
   * hemen / 20 dakika içinde" sözleri muaf (an belli).
   */
  dayUnclear: boolean;
  /** Metindeki KONUM ("<cümlecik>-<parça>") — öneri anahtarı bununla kurulur (algılama kuralları değişse de aynı söz aynı anahtar). */
  anchor: string;
}

type DayHalf = "am" | "pm" | "night";

/** Cümlecik + ayracı ("?" soru ayırt edilsin diye ayraç cümleciğe dahil). İki rakam arasındaki nokta ayraç DEĞİLDİR ("09.30", "1.5"). */
const RAW_CLAUSES = /(?:[^.!?;\n…؟。]|(?<=\d)\.(?=\d))+[.!?;\n…؟。]*/gu;
/** Söz fiilinden sonra soru eki ("gelecek mi", "getirecek misiniz"). */
const QUESTION_PARTICLE = /(?<![\p{L}\p{N}])m[iu](?:s[iu]n[iu]z|s[iu]n|y[iu]m)?(?![\p{L}])/u;
/**
 * Göreli süre YALNIZ son an bildiren kalıpla: "30 dakika içinde / sonra", "1,5 saate kadar", "in 2 hours", "within 30 minutes",
 * "20 minutes later". "İşi 2 saat sürer" SÜREDİR, son an değil (Haiku 10-12 3. tur). Sayı: rakam (ondalıklı) ya da yarım / bir / iki / üç.
 */
const DURATION_TR =
  /(?<![\p{L}\p{N}.,])(\d{1,3}(?:[.,]\d{1,2})?|yarim|bir|iki|uc)\s*(dakika|dk|saat)(?:ya|ye|a|e)?\s+(?:icinde|icerisinde|sonra|kadar)(?![\p{L}])/u;
const DURATION_EN =
  /(?<![\p{L}\p{N}])(?:(?:in|within)\s+(\d{1,3}(?:\.\d{1,2})?|an?|one|two|half\s+an?)\s+(minutes?|mins?|hours?|hrs?)|(\d{1,3})\s+(minutes?|mins?|hours?|hrs?)\s+later)(?![\p{L}])/u;
const SOON = /(?<![\p{L}\p{N}])(?:birazdan|hemen|simdi|az\s+sonra|shortly|right\s+away|right\s+now|soon|asap)(?![\p{L}])/u;
/** Ziyaret eden kişi (Opus O1 "sözü yapan"). */
const ACTOR_VISIT = new RegExp(
  `${NL}(?:teknisyen\\p{L}{0,6}|usta\\p{L}{0,4}|tesisatci\\p{L}{0,4}|elektrikci\\p{L}{0,4}|tamirci\\p{L}{0,4}|temizlikci\\p{L}{0,4}|servis\\p{L}{0,4}|gorevli\\p{L}{0,4}|ekip\\p{L}{0,4}|ekib\\p{L}{0,4}|technicians?|plumbers?|electricians?|cleaners?|housekeeping|engineers?|repairman)${NR}`,
  "u",
);
/** Getirme / gönderme / bırakma (teslim). */
const ACTOR_DELIVERY = new RegExp(
  `${NL}(?:getir\\p{L}{0,10}|gonder\\p{L}{0,10}|birak\\p{L}{0,10}|teslim|bring|send|drop\\s+off|deliver\\p{L}{0,3})${NR}`,
  "u",
);
/** "5'e kadar", "en geç 6'ya kadar" — saat okuyucusunun tanımadığı çıplak biçim (Haiku 10-12 4. tur). */
const UNTIL_HOUR = /(?<![\p{L}\p{N}.:])([01]?\d|2[0-3])\s*(?:['’]\s*)?(?:e|a|ye|ya)\s+kadar(?![\p{L}])/u;
/**
 * Saat değişikliğinin çıplak saati: "11'e kaydı", "3'e alındı", "15:30'a ertelendi" (kurucu 10-17 gece örneği — saat okuyucusu "11'e"yi saat
 * saymıyordu, değişiklik hiç tanınmıyordu). Yalnız değişiklik fiilinden HEMEN önce (ad "11'e" tek başına saat değil).
 */
const RESCHEDULE_HOUR =
  /(?<![\p{L}\p{N}.:])([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:['’]\s*)?(?:e|a|ye|ya)\s+(?:kaydi|kaydirildi|kaydirdik|alindi|ertelendi|erteledik)(?![\p{L}])/u;

/** Kapsamdaki açık saat adayları: saat okuyucusu + "N'e kadar" + "N'e kaydı". İki anlamlı çıplak saat ("3") iki aday (gündüz tercihi sonra). */
function timeMentions(raw: string, folded: string): number[] {
  const out = explicitTimeMentions(raw).flat();
  for (const m of [UNTIL_HOUR.exec(folded), RESCHEDULE_HOUR.exec(folded)]) {
    if (!m) continue;
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    out.push(h * 60 + min);
    if (h > 0 && h < 12) out.push((h + 12) * 60 + min);
  }
  return [...new Set(out)];
}
const WORD_NUMBER: Record<string, number> = { yarim: 0.5, bir: 1, iki: 2, uc: 3, a: 1, an: 1, one: 1, two: 2 };

function durationMinutes(text: string): number | null {
  const tr = DURATION_TR.exec(text);
  if (tr) {
    const n = WORD_NUMBER[tr[1]] ?? Number(tr[1].replace(",", "."));
    const minutes = tr[2] === "saat" ? n * 60 : n; // "yarım saat" = 0,5 × 60
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
  }
  const en = DURATION_EN.exec(text);
  if (en) {
    const rawN = en[1] ?? en[3];
    const unit = en[2] ?? en[4];
    const n = /^half/.test(rawN) ? 0.5 : (WORD_NUMBER[rawN] ?? Number(rawN));
    const minutes = /^h/.test(unit) ? n * 60 : n;
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
  }
  return null;
}

/**
 * Gün dilimi sözcükleri (ekli biçimler: "akşama", "sabahleyin", "öğlene", "geceleyin") → varsayılan saat + açık saati yorumlama yönü.
 * Sıra önemli: "öğleden sonra" > "öğle"; "akşamüstü" > "akşam"; "gece yarısı" > "gece".
 */
const DAY_PARTS: ReadonlyArray<{ re: RegExp; minutes: number; half: DayHalf; code: DayPartCode; end: number }> = [
  { re: new RegExp(`${NL}(?:ogleden\\s+sonra|afternoon)${NR}`, "u"), minutes: 15 * 60, half: "pm", code: "afternoon", end: 18 * 60 },
  { re: new RegExp(`${NL}aksamustu\\p{L}{0,3}${NR}`, "u"), minutes: 17 * 60, half: "pm", code: "late_afternoon", end: 19 * 60 },
  { re: new RegExp(`${NL}(?:aksam(?!lar)\\p{L}{0,5}|evening)${NR}`, "u"), minutes: 19 * 60, half: "pm", code: "evening", end: 23 * 60 + 59 },
  { re: new RegExp(`${NL}gece\\s+yarisi\\p{L}{0,3}${NR}`, "u"), minutes: 23 * 60 + 30, half: "night", code: "midnight", end: 25 * 60 },
  { re: new RegExp(`${NL}(?:gece(?!n(?:de|ler|lerde)?(?![\\p{L}\\p{N}])|ler)\\p{L}{0,5}|tonight)${NR}`, "u"), minutes: 21 * 60, half: "night", code: "night", end: 30 * 60 },
  { re: new RegExp(`${NL}(?:sabah(?!lar)\\p{L}{0,5}|morning)${NR}`, "u"), minutes: 10 * 60, half: "am", code: "morning", end: 12 * 60 },
  { re: new RegExp(`${NL}(?:ogle(?:n|ne|yin|ye)|noon|midday)${NR}`, "u"), minutes: 12 * 60, half: "pm", code: "noon", end: 14 * 60 },
];

/** Açık saat adaylarını gün dilimine göre yorumla: akşam "7:00" → 19:00, öğleden sonra "2:30" → 14:30, gece "2" → 02:00, sabah "9" → 09:00. */
function fitToHalf(candidates: number[], half: DayHalf): number[] {
  const DAY = 24 * 60;
  const out = candidates.map((m) => {
    if (half === "pm" && m < 12 * 60) return m + 12 * 60;
    if (half === "night" && m >= 6 * 60 && m < 12 * 60) return m + 12 * 60; // "gece 11" → 23:00
    // "gece 12" / "gece 12:30" gece yarısıdır (ertesi günün 00:xx'i), öğlen değil (Opus gece-4 F13; dilim sonu B7: 12:01–12:59 da).
    if (half === "night" && m >= 12 * 60 && m < 13 * 60) return m + 12 * 60;
    return m;
  });
  const fitting = out.filter((m) =>
    half === "am" ? m < 12 * 60 : half === "pm" ? m >= 12 * 60 && m < DAY : m >= 18 * 60 || m < 6 * 60,
  );
  return [...new Set(fitting.length > 0 ? fitting : out)];
}

/** Gün dilimi yokken iki anlamlı saat ("saat 2" → 02:00 / 14:00): gündüz (07:00–21:00) adayı tercih edilir (Haiku 10-12 3. tur). */
function preferDaytime(candidates: number[]): number[] {
  if (candidates.length < 2) return candidates;
  const day = candidates.filter((m) => m >= 7 * 60 && m < 21 * 60);
  return day.length > 0 ? day : candidates;
}

/** Söz fiilinin bulunduğu parçada fiilden SONRA "değil" / "yok" var mı. */
function negatedAfterVerb(segment: string): boolean {
  const m = PROMISE.exec(segment);
  return m !== null && NEGATION_AFTER_VERB.test(segment.slice(m.index + m[0].length));
}

/** Parça ayracı ÖZGÜN metinde (saat okuyucusu özgün metinde koşar); katlanmış metinle aynı sayıda parça vermezse null. */
const RAW_SEGMENT_SPLIT = /(?<!\d),|,(?!\d)|(?<![\p{L}\p{N}])(?:ama|fakat|ancak|but)(?![\p{L}\p{N}])/iu;

/** Parçada gün / saat / süre / gün dilimi bilgisi var mı (yoksa kapsam soldaki parçalara genişler: "Yarın sabah, teknisyen gelecek"). */
function hasTimeInfo(folded: string, raw: string): boolean {
  return (
    DAY_TODAY.test(folded) ||
    DAY_TOMORROW.test(folded) ||
    DAY_UNKNOWN.test(folded) ||
    // Takvim tarihi de zaman bilgisidir: sağdaki "…, 25 Ekim'de" parçası sözün kapsamına girer ve sözü düşürür (Haiku 10-17 gece 3. tur:
    // kapsam dışında kalıp söz "bugün" sayılıyordu).
    CALENDAR_DATE.test(folded) ||
    DAY_PARTS.some((d) => d.re.test(folded)) ||
    durationMinutes(folded) !== null ||
    timeMentions(raw, folded).length > 0
  );
}

/** Düzenli ifadenin tümünü değiştirme (global) kopyası. */
const globalOf = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
/** Zaman sözcükleri (süre, "hemen", gün, tanınmayan gün, takvim tarihi, gün dilimi, konu) — parça "yalnız zaman"mı sınaması için silinir. */
let timeWordsG: RegExp[] | null = null;
const TIME_FILLER_G = new RegExp(
  `${NL}(?:saat|saatte|saatlerinde|gibi|civari|civarinda|sularinda|erkenden|erken|gec|en|ki|ve|da|de|ta|te|icin|ile|bu|su|ise|uzeri|ustu|around|at|about|by|on|the|this|in|early|late|for|and|o['’]?clock)${NR}`,
  "gu",
);
/** Saat / rakam artığı ("10'da", "7:30", "2pm"). */
// Opus gece-4 F6: harf eki yalnız BİTİŞİK / kesmeli ("10'da", "7pm"); boşluktan sonra yalnız am / pm — "10 civarı"nda "civa"yı yiyordu.
const CLOCK_RESIDUE_G = /\d{1,2}(?:[:.]\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?)(?![\p{L}])|['’]?\p{L}{0,4})?/gu;
const HEDGE_WISH_G = globalOf(HEDGE_WISH);

/**
 * Parçanın türü: yalnız zaman / tarih sözcükleri ("Yarın," · "Yarın akşam," · "Klima için yarın sabah,") → "time"; yalnız dilek ("Umarım,",
 * "Umarım ki,", "…, inşallah.") ya da dilek + zaman ("Umarım yarın,") → "wish"; başka içerik ("Merhaba Cuma Bey", "Bugün klima bozuldu")
 * → null. Konu sözcükleri (klima, havlu…) zaman parçasını bozmaz. Sert itirazcı 10-17 gece-4: gün YALNIZ sözün kendi kapsamından ya da hemen
 * solundaki saf zaman parçasından okunur — başka cümledeki "Cuma" / "yarın çıkış" sözü veto etmez.
 */
function segmentKind(seg: string): "time" | "wish" | null {
  if (!timeWordsG) {
    timeWordsG = [DURATION_TR, DURATION_EN, SOON, DAY_TODAY, DAY_TOMORROW, DAY_UNKNOWN, CALENDAR_DATE, ...DAY_PARTS.map((d) => d.re), ...KIND_TOPICS.map(([, re]) => re)].map(
      globalOf,
    );
  }
  let rest = seg;
  const wish = HEDGE_WISH.test(seg);
  if (wish) rest = rest.replace(HEDGE_WISH_G, " ");
  for (const re of timeWordsG) rest = rest.replace(re, " ");
  rest = rest.replace(CLOCK_RESIDUE_G, " ").replace(TIME_FILLER_G, " ");
  if (/\p{L}/u.test(rest)) return null;
  if (wish) return "wish";
  return seg.trim() === "" ? null : "time";
}

/** Parçadaki söz fiili sayısı (aynı parçada iki söz → saat karışabilir, kart sorar — T1). */
const PROMISE_G = globalOf(PROMISE);
function promiseVerbCount(seg: string): number {
  return seg.match(PROMISE_G)?.length ?? 0;
}

/** Bağlaç "ve / and" (yakalayan grup: bölünen parçalar ayracı korur). */
const JOIN_WORD = /((?<![\p{L}\p{N}])(?:ve|and)(?![\p{L}\p{N}]))/iu;

/**
 * İki söz fiilini "ve / and" bağlıyorsa parça ikiye ayrılır (sert itirazcı 10-17 gece-4, T1: "Teknisyen yarın 10'da gelecek ve havluları
 * akşam getireceğim" tek parçaydı → havlu kayboluyor, teknisyen yarın 22:00 okunuyordu). Kesim yalnız iki yanda da söz fiili kalıyorsa
 * ("Teknisyen ve usta yarın gelecek" bölünmez). Özgün metin aynı sayıda parçaya bölünemezse bölünmez (saat okuyucusu özgün metinde koşar).
 */
function splitJoinedPromises(folded: string, raw: string | null): Array<readonly [string, string | null]> {
  if (promiseVerbCount(folded) < 2 || raw === null) return [[folded, raw]];
  const fp = folded.split(JOIN_WORD);
  const rp = raw.split(JOIN_WORD);
  if (rp.length !== fp.length) return [[folded, raw]];
  // Sağda söz fiili kalıyor mu — sondan bir kez hesaplanır (her kesimde kalanı yeniden birleştirmek uzun dizide karesel olurdu).
  const verbAfter: boolean[] = new Array<boolean>(fp.length + 1).fill(false);
  for (let i = fp.length - 1; i >= 0; i -= 1) verbAfter[i] = verbAfter[i + 1]! || (i % 2 === 0 && PROMISE.test(fp[i]!));
  const out: Array<readonly [string, string]> = [];
  let f = "";
  let r = "";
  let fHasVerb = false;
  for (let i = 0; i < fp.length; i += 2) {
    f += (i > 0 ? fp[i - 1] : "") + fp[i];
    r += (i > 0 ? rp[i - 1] : "") + rp[i];
    fHasVerb = fHasVerb || PROMISE.test(fp[i]!);
    if (i + 2 < fp.length && fHasVerb && verbAfter[i + 2]) {
      out.push([f, r]);
      f = "";
      r = "";
      fHasVerb = false;
    }
  }
  out.push([f, r]);
  return out;
}

/** Cümleciğin parçaları (virgül / karşıtlık bağlacı; iki sözü bağlayan "ve" — ↑). Özgün parçalar hizalı değilse `null`. */
function segmentClause(raw: string): { clause: string; segments: string[]; rawSegments: string[] | null } {
  const clause = foldTurkishAscii(raw).toLowerCase();
  const folded = clause.split(SEGMENT_SPLIT);
  const rawParts = raw.split(RAW_SEGMENT_SPLIT);
  const aligned = rawParts.length === folded.length;
  const pieces = folded.flatMap((seg, i) => splitJoinedPromises(seg, aligned ? rawParts[i]! : null));
  return {
    clause,
    segments: pieces.map(([f]) => f),
    rawSegments: aligned ? pieces.map(([, r]) => r ?? "") : null,
  };
}

/** Gelecekteki belirsiz-olmayan gün sözcüğü (yarın / tanınmayan gün / takvim tarihi) — D3 tetikleyicisi. "Bugün" tetiklemez. */
const futureDayIn = (t: string) => DAY_TOMORROW.test(t) || DAY_UNKNOWN.test(t) || CALENDAR_DATE.test(t);
const dayWordIn = (t: string) => DAY_TODAY.test(t) || futureDayIn(t);

/**
 * Mesaj bağlamı: yarın / tanınmayan gün / takvim tarihi geçen parçalar ("<cümlecik>.<parça>"; geçmişe atıf taşıyan parça hariç). Kendi gün
 * sözcüğü olmayan söz, KAPSAMI DIŞINDA böyle bir parça varsa günü tahmin etmez → kart günü sorar (D3).
 */
interface MessageContext {
  futureDayMarks: ReadonlyArray<readonly [number, number]>;
  /** Saat değişikliği sözcüğü geçen parçalar ("11'e kaydı", "ertelendi") — hiçbir sözün kapsamına girmeyen varsa saatler belirsiz (↓). */
  rescheduleMarks: ReadonlyArray<readonly [number, number]>;
}

function messageContext(clauses: readonly string[]): MessageContext {
  const futureDayMarks: Array<readonly [number, number]> = [];
  const rescheduleMarks: Array<readonly [number, number]> = [];
  clauses.forEach((raw, ci) => {
    segmentClause(raw).segments.forEach((seg, si) => {
      // Geçmişe atıf yalnız KENDİ sözcükleriyle düşer; aynı parçadaki yarın işareti kalır (Opus gece-4 F4: "Dün akşam klima bozulmuş yarın
      // teknisyen gelecek. Havlu getireceğim." havlu bugüne yazılıyordu).
      const present = seg.replace(PAST_PART, " ").replace(PAST_REF_G, " ");
      if (futureDayIn(present)) futureDayMarks.push([ci, si]);
      if (!PAST_REF.test(seg) && RESCHEDULE.test(seg)) rescheduleMarks.push([ci, si]);
    });
  });
  return { futureDayMarks, rescheduleMarks };
}

const PAST_REF_G = globalOf(PAST_REF);

/** Sözün fiili (T4 için: varış / teslim fiili işin süresi değildir — Opus gece-4 F16). */
const promiseVerbs = new WeakMap<HostPromise, string>();
const ARRIVAL_VERB = /^(?:gel|getir|gonder|yolla|ugra|birak)|coming|on\s+(?:the|his|her|their)\s+way|sending/u;

/** Sözün kapsamı (cümlecik, ilk parça, son parça) — mesaj düzeyi denetim için (yalnız bu dosya). */
const scopeRanges = new WeakMap<HostPromise, readonly [number, number, number]>();

/**
 * Şimdiye bağlı söz ("on the way", "yolda") — günü belli (bugün, şimdi); D3'ten muaf. Çıplak "-iyor" / "is coming" / "sending" ŞİMDİYE bağlı
 * DEĞİL (Türkçede ve İngilizcede planlı geleceği de anlatır — Opus gece-4 F1: "Yarın teknisyen geliyor, temizlikçi de geliyor." temizliği
 * bugüne yazıyordu); "şimdi / hemen / birazdan" zaten `soon`.
 */
const NOW_VERB = /on\s+(?:the|his|her|their)\s+way$/u;
const ON_THE_WAY = new RegExp(`${NL}(?:yolda(?:yim|yiz|lar)?|yola\\s+(?:cikti|ciktilar|ciktim|ciktik))${NR}`, "u");

/**
 * Ev sahibinin mesajında misafire verilen SÖZ var mı (aynı cümlecikte söz fiili + konu; soru / koşul / teklif değil)? Tür kapalı küme
 * (havlu / malzeme / temizlik / bakım) — konu önce söz fiilinin virgül parçasında aranır ("Klima için teşekkürler, yarın havlu getireceğim"
 * → havlu), yoksa cümlecikte; birden çok konu varsa bakım > temizlik > havlu > malzeme. Gün / saat / süre YALNIZ sözün parçasından (o parçada
 * yoksa soldaki söz fiilsiz parçalardan): "Teknisyen bugün gelecek, yarın havlu getiririm" → bakım BUGÜN; "Teknisyen yarın gelecek, işi
 * 2 saat sürer" → süre son an değil (Haiku 10-12 3. tur). Metin SAKLANMAZ.
 */
export function detectHostPromise(text: string | null | undefined): HostPromise | null {
  if (typeof text !== "string" || text.trim() === "" || text.length > 4_000) return null;
  const clauses = text.match(RAW_CLAUSES) ?? [];
  const ctx = messageContext(clauses);
  for (const [ci, raw] of clauses.entries()) {
    const c = promiseClause(raw, ci);
    if (!c) continue;
    const withTopic = c.verbIdx.find((i) => c.topicIn(c.segments[i]) !== undefined);
    const kind = withTopic !== undefined ? c.topicIn(c.segments[withTopic]) : c.topicIn(c.clause);
    if (!kind) continue;
    const p = promiseAt(c, withTopic ?? c.verbIdx[0], kind, ctx);
    // Tanınmayan / belirsiz gün ya da 24 saati aşan süre → bütün mesaj için öneri yok (bugünkü sözleşme; ↓ çoklu okuma yalnız o sözü atlar).
    return p === REJECT ? null : p;
  }
  return null;
}

/** Bir mesajda en fazla bu kadar söz önerilir (kurucu Q1-b, 10-17: "ikisini de öner"). */
export const MAX_PROMISES_PER_MESSAGE = 3;

/**
 * Mesajdaki BÜTÜN sözler (kurucu Q1-b, 10-17: "Klima için teknisyen yarın 10'da gelecek. Musluk için usta 11'de gelecek." → iki öneri).
 * Her cümlecik ayrı okunur; bir cümlecikte konusu kendi parçasında olan birden çok söz fiili varsa her biri ayrı söz ("Teknisyen yarın
 * 10'da gelecek, havluları da bugün getireceğim"). Konusu yalnız cümlecikte olan söz bugünkü gibi tek. İLK söz `detectHostPromise` ile aynı
 * cümlecikten gelir (öneri anahtarı geriye uyumlu). Tanınmayan / belirsiz gün yalnız O sözü düşürür (öteki sözlerin kendi zaman kapsamı
 * var). Yalnız BİREBİR tekrar (tür + konu + gün + saat okuması aynı) alınmaz; "Teknisyen yarın 10:00'da gelecek. Klima için usta yarın
 * 11:00'de gelecek." İKİ söz (Haiku 10-17: konusuz + konulu ikinci söz düşüyordu — kurucu "her söz ayrı"). Aynı saatteki konusuz + konulu
 * iki söz de gösterilir; onayda biri ötekine bağlanır (Q1 "a"). Tavan 3. Metin SAKLANMAZ.
 */
export function detectHostPromises(text: string | null | undefined): HostPromise[] {
  if (typeof text !== "string" || text.trim() === "" || text.length > 4_000) return [];
  const clauses = text.match(RAW_CLAUSES) ?? [];
  const ctx = messageContext(clauses);
  const found: HostPromise[] = [];
  // Ön okuma tavanı (devam / süre düşürmesinden SONRA ilk 3 söz alınır) + deneme tavanı (aynı sözün yüzlerce tekrarı — "havlu getireceğim
  // ve …" — her biri ayrı okunup tekrar diye atılıyordu; uzun mesajda iş sınırlı).
  const READ_CAP = MAX_PROMISES_PER_MESSAGE * 4;
  let attempts = READ_CAP * 2;
  for (const [ci, raw] of clauses.entries()) {
    if (found.length >= READ_CAP || attempts <= 0) break;
    const c = promiseClause(raw, ci);
    if (!c) continue;
    // Hemen sonraki cümlecik yalnız TEYİT sorusuysa ("Teknisyen yarın 10'da gelecek. Uygun mu?") söz henüz kesin değil (O3; Opus gece-4 F15).
    if (confirmQuestionFollows(clauses[ci + 1])) continue;
    const topical = c.verbIdx.filter((i) => c.topicIn(c.segments[i]) !== undefined);
    const picks: Array<readonly [number, CommitmentKind]> = topical.length
      ? topical.map((i) => [i, c.topicIn(c.segments[i])!] as const)
      : (() => {
          const k = c.topicIn(c.clause);
          return k ? [[c.verbIdx[0], k] as const] : [];
        })();
    const rejectedKinds = new Set<CommitmentKind>();
    for (const [at, kind] of picks) {
      if (found.length >= READ_CAP || attempts-- <= 0) break;
      const p = promiseAt(c, at, kind, ctx);
      if (p === REJECT) {
        rejectedKinds.add(kind);
        continue;
      }
      // Önceki söz REDDEDİLDİYSE (tanınmayan gün, soru, dilek…) aynı cümlecikteki zamansız devamı da düşer ("Teknisyen 25 Ekim'de gelecek,
      // klima bakımı da yapacak" — Haiku 3. tur).
      if (!hasPromiseTime(p) && rejectedKinds.has(p.kind)) continue;
      if (found.some((q) => samePromise(q, p))) continue;
      found.push(p);
    }
  }
  // Hiçbir sözün kapsamına girmeyen saat değişikliği ("Teknisyen yarın 10'da gelecek, saat 11'e kaydı." · "…, ertelendi.") — hangi sözün
  // saati değişti belli değil: sözlerin saati kendiliğinden kaydedilmez, kart sorar (Haiku gece-4: 10:00 kendiliğinden açılıyordu).
  const covered = (ci: number, si: number) =>
    found.some((p) => {
      const r = scopeRanges.get(p);
      return r !== undefined && r[0] === ci && r[1] <= si && si <= r[2];
    });
  const orphanReschedule = ctx.rescheduleMarks.some(([ci, si]) => !covered(ci, si));
  const checked = orphanReschedule ? found.map((p) => ({ ...p, timeAmbiguous: true })) : found;
  return dropContinuations(checked).slice(0, MAX_PROMISES_PER_MESSAGE);
}

/** Kısa, söz fiilsiz teyit sorusu cümleciği ("Uygun mu?", "Sizin için uygun mu?", "Is that ok?"). */
function confirmQuestionFollows(next: string | undefined): boolean {
  if (!next || !/[?؟]\s*$/u.test(next) || next.length > 60) return false;
  const f = foldTurkishAscii(next).toLowerCase();
  return CONFIRM_QUESTION.test(f) && !PROMISE.test(f) && !GENERAL_CHECK.test(f);
}

/** Aynı ziyaret / teslim olabilir mi: tür aynı, konu uyumlu (biri boşsa uyumlu), yapan uyumlu (biri bilinmiyorsa uyumlu). */
function samePromiseFamily(a: HostPromise, b: HostPromise): boolean {
  return a.kind === b.kind && (a.topic === null || b.topic === null || a.topic === b.topic) && (a.actor === null || b.actor === null || a.actor === b.actor);
}

/**
 * Mesaj düzeyinde DEVAM düşürmesi (sert itirazcı 10-17 gece-4):
 *  · T3 — kendi zamanı olmayan söz, aynı aileden (tür + konu + yapan uyumlu) zamanlı bir sözün DEVAMIDIR, hangi yönde olursa olsun ("Teknisyen
 *    yarın 10'da gelecek. Klimaya da bakacak." · "Temizlik yapılacak, temizlikçi yarın 10'da gelecek." tek ziyaret). Zamanlı söz yoksa ilk
 *    zamansız söz kalır. Devamın konusu, konusuz zamanlı söze yazılır ("…Klimaya da bakacak" → klima). Konusu farklı devam ("Klima için
 *    teknisyen yarın 10'da gelecek. Kombiyi de tamir edecek.") ayrı sözdür (gün belirsizse kart sorar).
 *  · T4 — yalnız süre taşıyan söz ("…, arızayı 2 saat içinde halledecek") SOLUNDA aynı aileden günlü / saatli söz varsa işin süresidir, düşer.
 *    Solda değilse ayrı sözdür ("Teknisyen 1 saat içinde gelecek. Yarın 10'da da usta gelecek." iki söz).
 */
function dropContinuations(found: HostPromise[]): HostPromise[] {
  const dated = (p: HostPromise) => p.dayExplicit || p.timeCandidates.length > 0;
  const kept: HostPromise[] = [];
  const dropped = new Set<number>();
  found.forEach((p, i) => {
    if (!hasPromiseTime(p)) {
      const host = found.findIndex((q, j) => j !== i && !dropped.has(j) && hasPromiseTime(q) && samePromiseFamily(p, q));
      if (host >= 0) {
        dropped.add(i);
        const q = found[host]!;
        if (q.topic === null && p.topic !== null) found[host] = { ...q, topic: p.topic };
        return;
      }
      if (found.some((q, j) => j < i && !dropped.has(j) && !hasPromiseTime(q) && samePromiseFamily(p, q))) {
        dropped.add(i);
        return;
      }
    }
    // Varış / teslim fiili ("tesisatçı da 1 saat içinde gelecek") ayrı sözdür, işin süresi değil (Opus gece-4 F16).
    const arrival = ARRIVAL_VERB.test(promiseVerbs.get(p) ?? "");
    if (p.inMinutes !== null && !dated(p) && !arrival && found.some((q, j) => j < i && !dropped.has(j) && dated(q) && samePromiseFamily(p, q))) dropped.add(i);
  });
  found.forEach((p, i) => {
    if (!dropped.has(i)) kept.push(p);
  });
  return kept;
}

const REJECT = Symbol("reject");

/** Sözün kendi zaman bilgisi var mı (gün sözcüğü, saat, süre, gün dilimi, "birazdan"). */
export function hasPromiseTime(p: HostPromise): boolean {
  return p.dayExplicit || p.timeCandidates.length > 0 || p.inMinutes !== null || p.cue !== null || p.soon;
}

/**
 * Aynı sözün mesaj içinde BİREBİR tekrarı mı (tür, konu, YAPAN, gün ve saat okuması aynı). Yapan farklıysa iki sözdür: "Klima için teknisyen
 * yarın gelecek, klima filtresini yarın getireceğim" (Haiku 10-17 gece 2. tur: teslim sözü tekrar sanılıp düşüyordu).
 */
function samePromise(a: HostPromise, b: HostPromise): boolean {
  return (
    a.kind === b.kind &&
    a.topic === b.topic &&
    a.actor === b.actor &&
    a.day === b.day &&
    a.inMinutes === b.inMinutes &&
    a.timeCandidates.join(",") === b.timeCandidates.join(",") &&
    (a.cue?.code ?? null) === (b.cue?.code ?? null) &&
    a.soon === b.soon &&
    a.reschedule === b.reschedule
  );
}

interface PromiseClause {
  raw: string;
  /** Mesajdaki sırası (söz konumu `anchor` ve D3 bağlamı için). */
  index: number;
  clause: string;
  segments: string[];
  rawSegments: string[] | null;
  verbIdx: number[];
  topicIn: (t: string) => CommitmentKind | undefined;
}

/** Cümlecik söz taşıyabilir mi (soru / koşul / olumsuz değil, söz fiili var) — taşıyorsa parçaları. */
function promiseClause(raw: string, index: number): PromiseClause | null {
  const { clause, segments, rawSegments } = segmentClause(raw);
  if (clause.trim() === "" || CONDITIONAL.test(clause)) return null;
  if (!PROMISE.test(clause) && !RESCHEDULE.test(clause)) return null;
  // Soru YALNIZ sözün kapsamında söz bozar (↓ `promiseAt`): "Yarın havlu getireceğim, başka bir ihtiyacınız var mı?" bir söz + ayrı bir
  // sorudur (Haiku 10-17 gece; eskiden cümlecik sonundaki "?" bütün sözü düşürüyordu). İptal / kararsızlık bilerek cümlecik boyunca kalır
  // ("Teknisyen gelecek ama iptal olabilir", "…, galiba").
  if (NEGATION.test(clause) || HEDGE.test(clause)) return null;
  const verbIdx = segments.map((seg, i) => (PROMISE.test(seg) || RESCHEDULE.test(seg) ? i : -1)).filter((i) => i >= 0);
  if (verbIdx.length === 0 || verbIdx.some((i) => negatedAfterVerb(segments[i]))) return null;
  const topicIn = (t: string) => KIND_TOPICS.find(([, re]) => re.test(t))?.[0];
  return { raw, index, clause, segments, rawSegments, verbIdx, topicIn };
}

/**
 * `at` parçasındaki söz fiilinin sözü (kapsam, gün, saat, konu). Tanınmayan / belirsiz gün ya da 24 saati aşan süre → REJECT.
 *
 * GÜN (sert itirazcı 10-17 gece-4, D1–D4 — başka cümledeki "Cuma Bey" / "yarın çıkış" sözü veto etmez, sözün günü de tahmin edilmez):
 *  · D1 sözün KENDİ kapsamı (söz parçası + sağdaki yalın zaman parçaları): yarın → yarın; bugün → bugün; ikisi → yok; tanınmayan gün /
 *    takvim tarihi → yok.
 *  · D2 kendi kapsamında gün yoksa hemen soldaki YALIN parça zinciri (yalnız zaman / tarih / konu sözcüğü; en çok 3): gün sözcüğü taşıyan en
 *    yakın parçanın günü VE gün dilimi alınır ("Yarın akşam, teknisyen 7'de gelecek" → yarın 19:00).
 *  · D3 yine gün yoksa ve mesajda kapsam DIŞINDA yarın / tanınmayan gün / takvim tarihi geçiyorsa (geçmişe atıf hariç) → `dayUnclear`: kart
 *    günü sorar ("Teknisyen yarın 10'da gelecek. Havlu getireceğim." havlu). Şimdiye bağlı söz muaf ("hemen", "20 dakika içinde",
 *    "getiriyorum").
 *  · D4 aksi hâlde bugün.
 * DİLEK (H1): kendi kapsamında ya da bitişik YALIN dilek parçasında ("Umarım,", "Umarım yarın,", "…, inşallah.") → söz değil; yalın olmayan
 * dilek ("Umarım her şey yolundadır, …", "…, umarım beğenirsiniz") bozmaz.
 * SAAT (T1 / T2): aynı parçada iki söz fiili kalırsa kart saati sorar; açık saat süreyi yener (süre işin uzunluğudur); yarınki söz + süre
 * ("Teknisyen yarın 2 saat içinde gelecek") kart (yarın 11:00 uydurulmaz).
 */
function promiseAt(c: PromiseClause, at: number, kind: CommitmentKind, ctx: MessageContext): HostPromise | typeof REJECT {
  const { raw, segments, rawSegments, topicIn } = c;
  // Aktarılan / geçmiş söz (söz fiilinin kendi parçasında) söz değildir.
  if (REPORTED.test(segments[at]) || segments.slice(0, at).some((seg) => REPORTED_LEAD.test(seg))) return REJECT;
  // Kapsam: sözün parçası + soldaki / sağdaki YALIN zaman parçaları. Özgün metin aynı sayıda parçaya bölünemezse cümlecik.
  const aligned = rawSegments !== null && rawSegments.length === segments.length;
  const sliceOf = (a: number, b: number) => ({
    folded: segments.slice(a, b + 1).join(","),
    raw: aligned ? rawSegments.slice(a, b + 1).join(",") : raw,
  });
  // Soldaki YALIN parça zinciri (en çok 3; söz fiili / saat değişikliği / geçmişe atıf durdurur). Yalın dilek parçası → kararsız söz (H1).
  let bare = at;
  while (bare > 0 && at - bare < 3) {
    const s = segments[bare - 1];
    if (PROMISE.test(s) || RESCHEDULE.test(s) || PAST_REF.test(s)) break;
    const k = segmentKind(s);
    if (k === "wish") return REJECT;
    if (k !== "time") break;
    // Başka türün parçası ("Towels tomorrow, the technician will come at 3") bu sözün zamanı değildir (Opus gece-4 F17).
    const sk = topicIn(s);
    if (sk !== undefined && sk !== kind) break;
    bare--;
  }
  // Zaman bilgisi yoksa soldaki yalın parçalar kapsama girer ("Yarın sabah, teknisyen gelecek").
  let from = at;
  while (from > bare && !hasTimeInfo(sliceOf(from, at).folded, sliceOf(from, at).raw)) from--;
  // Konu kapsamı (gün / saat DEĞİL): soldaki söz fiilsiz parçalar ("Klima arızası için üzgünüz, teknisyen gelecek" → klima) — önceki kural.
  let topicFrom = at;
  while (
    topicFrom > 0 &&
    at - topicFrom < 3 &&
    !hasTimeInfo(sliceOf(topicFrom, at).folded, sliceOf(topicFrom, at).raw) &&
    !PROMISE.test(segments[topicFrom - 1]) &&
    !RESCHEDULE.test(segments[topicFrom - 1]) &&
    !PAST_REF.test(segments[topicFrom - 1])
  )
    topicFrom--;
  // Sağdaki YALIN zaman parçaları da sözün parçasıdır ("Teknisyen gelecek, yarın sabah 10 gibi"; "The technician will come tomorrow, around
  // 9") — en fazla 2; "havlular yarın" gibi başka konulu ya da "yarın görüşürüz" gibi yalın olmayan parça katılmaz (Haiku 10-12 4. tur; sert
  // itirazcı 10-17 gece-4: sağdaki cümleden gün okunmaz). Saat değişikliği bildiren parçanın (söz fiili yok) sağındaki KONUSUZ söz parçası
  // aynı sözün yeni zamanıdır ("Teknisyen saati değişti, 15:00'te gelecek" — kurucu 10-17 gece: "konuyu, değiştirilen şeyi anlamalı").
  const rescheduleOnly = !PROMISE.test(segments[at]) && RESCHEDULE.test(segments[at]);
  let to = at;
  // Süre ("30 dakika içinde") yalnız SÖZÜN parçalarından okunur (Haiku 10-17 gece: "Teknisyen yarın 10'da gelecek, işi 2 saat içinde bitirir"
  // sağdaki işin süresini son an sanıyor, 10:00'ı silip 16:00 uyduruyordu). Saat değişikliğinin devam eden söz parçası sözün parçasıdır.
  let durationTo = at;
  while (to + 1 < segments.length && to - at < 2) {
    const next = sliceOf(to + 1, to + 1);
    const continues = rescheduleOnly && to === at && PROMISE.test(next.folded) && !RESCHEDULE.test(next.folded);
    if (
      (!continues && (PROMISE.test(next.folded) || segmentKind(next.folded) !== "time")) ||
      RESCHEDULE.test(next.folded) ||
      topicIn(next.folded) !== undefined ||
      PAST_REF.test(next.folded) ||
      !hasTimeInfo(next.folded, next.raw)
    )
      break;
    to++;
    if (continues) durationTo = to;
  }
  // Sağdaki yalın dilek parçası ("…, umarım." · "…, hopefully.") sözü kararsız yapar (H1); sonraki söz fiili durdurur.
  for (let i = to + 1; i < segments.length && !PROMISE.test(segments[i]); i++) if (segmentKind(segments[i]) === "wish") return REJECT;
  // D2: kendi kapsamında gün yoksa soldaki yalın zincirde gün sözcüğü taşıyan EN YAKIN parça (günü + gün dilimi).
  const ownDay = dayWordIn(sliceOf(from, to).folded);
  if (!ownDay) {
    for (let i = from - 1; i >= bare; i--) {
      if (dayWordIn(segments[i])) {
        from = i;
        break;
      }
    }
  }
  // Kapsamda gün dilimi yoksa soldaki yalın zincirdeki en yakın DİLİM parçası ("Akşam, teknisyen 9'da gelecek" → bugün 21:00 — Opus gece-4 F12).
  // Sözün KENDİ günü varsa günsüz soldaki dilim ona bağlanmaz (Haiku gece-4: "Akşam, teknisyen yarın 9'da gelecek" yarın 21:00 okunuyordu —
  // günsüz "akşam" bugünün akşamıdır, "yarın 9'da" ile birleştirilemez).
  if (!ownDay && !DAY_PARTS.some((d) => d.re.test(sliceOf(from, to).folded))) {
    for (let i = from - 1; i >= bare; i--) {
      if (DAY_PARTS.some((d) => d.re.test(segments[i]!))) {
        from = i;
        break;
      }
    }
  }
  // Kapsamda açık saat yoksa soldaki yalın zincirdeki en yakın SAAT parçası ("Teknisyen 10'da, yarın gelecek" → yarın 10:00).
  if (timeMentions(sliceOf(from, to).raw, sliceOf(from, to).folded).length === 0) {
    for (let i = from - 1; i >= bare; i--) {
      const seg = sliceOf(i, i);
      if (timeMentions(seg.raw, seg.folded).length > 0) {
        from = i;
        break;
      }
    }
  }
  const scope = sliceOf(from, to);
  // Soru sözün kapsamındaysa söz değil: soru eki ("gelecek mi") ya da cümlecik "?" ile bitiyor ve son parça kapsamda.
  if (QUESTION_PARTICLE.test(scope.folded) || (/[?؟]\s*$/.test(raw) && to === segments.length - 1)) return REJECT;
  // Sağdaki ayrı soru sözü TEYİDE bağlıyorsa ("…, uygun mu?", "…, olur mu?") söz henüz kesin değil (O3).
  const isQuestionSeg = (i: number) => QUESTION_PARTICLE.test(segments[i]) || (i === segments.length - 1 && /[?؟]\s*$/.test(raw));
  for (let i = to + 1; i < segments.length; i++) if (isQuestionSeg(i) && CONFIRM_QUESTION.test(segments[i])) return REJECT;
  // Dilek sözün kapsamında → kararsız söz (O6); soldaki başka cümle ("umarım iyisinizdir") bozmaz. Söz fiilinden SONRA gelen dilek yalnız
  // ARDINDA başka içerik yoksa bozar ("…gelecek umarım." · "…tomorrow hopefully." bozar; "…gelecek umarım sorun çözülür" sonuca dilektir —
  // Haiku gece-4: virgülsüz yazılınca söz sessizce düşüyordu).
  const verbAt = PROMISE.exec(segments[at]);
  const verbEnd = verbAt ? verbAt.index + verbAt[0].length : segments[at].length;
  const afterVerb = segments[at].slice(verbEnd);
  const lastWish = [...afterVerb.matchAll(HEDGE_WISH_G)].at(-1);
  const wishRest = lastWish ? afterVerb.slice((lastWish.index ?? 0) + lastWish[0].length) : "";
  const trailingWish = lastWish !== undefined && (!/\p{L}/u.test(wishRest) || segmentKind(wishRest) === "time");
  const ownScope = [...segments.slice(from, at), segments[at].slice(0, verbEnd), ...segments.slice(at + 1, to + 1)];
  if (ownScope.some((seg) => HEDGE_WISH.test(seg)) || trailingWish) return REJECT;
  // Tanınmayan gün / takvim tarihi (kapsamda) → öneri yok.
  if (DAY_UNKNOWN.test(scope.folded) || CALENDAR_DATE.test(scope.folded)) return REJECT;
  // "Bugün ya da yarın" → hangi gün? belirsiz → öneri yok.
  if (DAY_TOMORROW.test(scope.folded) && DAY_TODAY.test(scope.folded)) return REJECT;
  const day: HostPromise["day"] = DAY_TOMORROW.test(scope.folded) ? "tomorrow" : "today";
  // T1: aynı parçada ayrılamayan iki söz fiili ("Teknisyen yarın 10'da gelecek havluları akşam getireceğim") — saat / dilim hangi söze ait
  // belli değil: hiçbiri okunmaz (yarın 22:00 uydurulurdu), kart saati sorar.
  // Opus gece-4 F18: iki fiil AYNI ziyaretse ("gelecek klimayı tamir edecek") saat okunur; yalnız farklı tür / yapan ise ayrılamaz.
  const kindsInSeg = new Set(KIND_TOPICS.filter(([, re]) => re.test(segments[at]!)).map(([k]) => k));
  const twoVerbs =
    promiseVerbCount(segments[at]) >= 2 && (kindsInSeg.size >= 2 || (ACTOR_VISIT.test(segments[at]!) && ACTOR_DELIVERY.test(segments[at]!)));
  // Geçmişe atıf ("dün gece") dilim sayılmaz.
  const part = twoVerbs ? undefined : DAY_PARTS.find((d) => d.re.test(scope.folded.replace(PAST_PART, " ").replace(GREETING_PART, " ")));
  // T2: açık saat süreyi yener ("Teknisyen 10'da gelecek, 2 saat içinde halleder" — süre işin uzunluğu).
  const clocks = twoVerbs ? [] : timeMentions(scope.raw, scope.folded);
  let inMinutes = clocks.length > 0 || twoVerbs ? null : durationMinutes(sliceOf(from, durationTo).folded);
  // 24 saati aşan süre ("48 saat içinde") bugün / yarın modelinin dışında → öneri yok (Haiku 10-12 4. tur: saat kipinde yuvarlanıyordu).
  if (inMinutes !== null && inMinutes > 24 * 60) return REJECT;
  // T2: yarınki söz + süre ("Teknisyen yarın 2 saat içinde gelecek") — süre ŞİMDİDEN sayılıp yarına konmaz (yarın 11:00 uydurulurdu): saat
  // atılır, kart saati sorar.
  const durationOnTomorrow = inMinutes !== null && day === "tomorrow";
  if (durationOnTomorrow) inMinutes = null;
  let timeCandidates = inMinutes === null ? clocks : [];
  timeCandidates = part ? fitToHalf(timeCandidates, part.half) : preferDaytime(timeCandidates);
  // Birbirinden farklı saatler (12 saat farkı aynı saatin öğleden önce / sonra okumasıdır) → saat seçilmez, kart sorar (O9). Aynı parçada
  // ayrılamayan iki söz fiili (T1) de kart.
  const timeAmbiguous =
    timeCandidates.some((a) => timeCandidates.some((b) => a !== b && Math.abs(a - b) !== 12 * 60)) ||
    durationOnTomorrow ||
    twoVerbs ||
    // "yarın gece 12" = yarın 00:00 mı, yarın gece 24:00 mı? belirsiz → kart (Opus gece-4 F13).
    (part?.half === "night" && day === "tomorrow" && timeCandidates.some((m) => m >= 24 * 60));
  const cue = inMinutes === null && timeCandidates.length === 0 && part ? { minutes: part.minutes, half: part.half, code: part.code, end: part.end } : null;
  const soon = inMinutes === null && timeCandidates.length === 0 && cue === null && SOON.test(scope.folded);
  const reschedule = RESCHEDULE.test(scope.folded);
  // Söz fiili olmayan saat değişikliği cümleciği ("Teknisyen 11'e kaydı") YALNIZ zaman bilgisiyle söz sayılır — "ertelendi" tek başına yeni
  // bir zaman söylemez (hiçbir şey açılmaz / güncellenmez).
  if (!PROMISE.test(segments[at]) && !hasTimeInfo(scope.folded, scope.raw)) return REJECT;
  const dayExplicit = DAY_TOMORROW.test(scope.folded) || DAY_TODAY.test(scope.folded);
  // D3: kendi günü yok + kapsam dışında yarın / tanınmayan gün / takvim tarihi → gün tahmin edilmez (kart sorar). Şimdiye bağlı söz muaf.
  const nowAnchored = soon || inMinutes !== null || NOW_VERB.test(PROMISE.exec(segments[at])?.[0] ?? "") || ON_THE_WAY.test(scope.folded);
  const dayUnclear =
    !dayExplicit && !nowAnchored && ctx.futureDayMarks.some(([ci, si]) => ci !== c.index || si < from || si > to);
  // Konu / yapan: soldaki söz fiilsiz parçalarla (önceki kapsam kuralı; gün / saat okumasına girmez).
  const topicSlice = sliceOf(Math.min(topicFrom, from), to);
  // "10 sularında" saattir, su konusu değil (Opus gece-4 F19f).
  const topicScope = {
    raw: topicSlice.raw.replace(/(?<![\p{L}])sular[ıi]nda(?![\p{L}])/giu, " "),
    folded: topicSlice.folded.replace(/(?<![\p{L}])sularinda(?![\p{L}])/gu, " "),
  };
  const actor: HostPromise["actor"] = ACTOR_VISIT.test(topicScope.folded) ? "visit" : ACTOR_DELIVERY.test(topicScope.folded) ? "delivery" : null;
  const promise: HostPromise = {
    kind,
    topic: commitmentTopicOf(kind, topicScope.raw, topicScope.folded),
    day,
    timeCandidates,
    inMinutes,
    cue,
    soon,
    reschedule,
    dayExplicit,
    actor,
    timeAmbiguous,
    dayUnclear,
    anchor: `${c.index}-${at}-${kind}`,
  };
  scopeRanges.set(promise, [c.index, from, to]);
  promiseVerbs.set(promise, verbAt?.[0] ?? "");
  return promise;
}

/**
 * Sözün ZAMAN PENCERESİ (kurucu 10-17 gece: "saati belirtilmemiş saati söyleyemez, bilgi uyduramaz"; "akşam yazmışsa akşam olarak tutsun").
 * Kesinlik: `time` (açık saat — aday saatlerden şimdiden sonraki ilki, yoksa yarın; ya da AÇIK süre "30 dakika içinde") · `part` (gün dilimi /
 * "kısa süre içinde") · `day` (yalnız gün). `end` = pencerenin SONU, günün başından dakika (ertesi güne taşabilir: gece yarısı 25:00, gece
 * 30:00) — yalnız gecikme hesabı içindir, ev sahibine gösterilmez. Bugünkü sabah / öğle / öğleden sonra geçtiyse ("Sabah teknisyen gelecek"
 * akşam yazıldı) yarın.
 */
export type PromiseWindow =
  | { day: "today" | "tomorrow"; precision: "time"; time: string; end: number }
  | { day: "today" | "tomorrow"; precision: "part"; dayPart: DayPartCode; end: number }
  | { day: "today" | "tomorrow"; precision: "day"; end: number };

const END_OF_DAY = 23 * 60 + 59;

export function promiseWindow(p: HostPromise, nowMinutes: number): PromiseWindow {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  if (p.inMinutes !== null) {
    const t = nowMinutes + p.inMinutes;
    return t >= 24 * 60
      ? { day: "tomorrow", precision: "time", time: fmt(t - 24 * 60), end: t - 24 * 60 }
      : { day: p.day, precision: "time", time: fmt(t), end: t };
  }
  if (p.timeCandidates.length > 0) {
    if (p.day === "tomorrow") {
      const m = Math.min(...p.timeCandidates);
      return { day: "tomorrow", precision: "time", time: fmt(m), end: m };
    }
    const future = p.timeCandidates.filter((m) => m > nowMinutes).sort((a, b) => a - b);
    const m = future.length > 0 ? future[0] : Math.min(...p.timeCandidates);
    // "Bu gece 12'de" = ertesi günün 00:00'ı (24:00 olarak tutulur).
    if (m >= 24 * 60) return { day: "tomorrow", precision: "time", time: fmt(m - 24 * 60), end: m - 24 * 60 };
    // Açık "bugün" + geçmiş saat yarına KAYMAZ (Opus gece-4 F14: "Teknisyen bugün 11'de gelecek" 13:00'te yazıldı → yarın 11:00 tahmindi);
    // bugün kalır → geçmiş söz önerilmez.
    return { day: future.length > 0 || p.dayExplicit ? "today" : "tomorrow", precision: "time", time: fmt(m), end: m };
  }
  if (p.cue !== null) {
    const early = p.cue.code === "morning" || p.cue.code === "noon" || p.cue.code === "afternoon" || p.cue.code === "late_afternoon";
    const day = p.day === "tomorrow" || (early && p.cue.end <= nowMinutes && !p.dayExplicit) ? "tomorrow" : "today";
    return { day, precision: "part", dayPart: p.cue.code, end: p.cue.end };
  }
  if (p.soon) return { day: p.day, precision: "part", dayPart: "soon", end: END_OF_DAY };
  return { day: p.day, precision: "day", end: END_OF_DAY };
}

// ── B · Wi-Fi ────────────────────────────────────────────────────────────────

/** Şifre / ağ adı sözcüğünden sonra gelebilecek, değer OLMAYAN sözcükler ("şifre yanlış", "Wi-Fi adı yok", "password is wrong"). */
const NOT_A_VALUE =
  /^(?:yanlis|dogru|degisti|degistirildi|degismedi|degistirdim|guncellendi|asagida|asagidaki|yukarida|yukaridaki|nedir|ne|su|bu|kartta|kartin|duvarda|modemin|modemde|altinda|etikette|etiketteki|ekte|ektedir|ayni|aynidir|yazili|yaziyor|gonderdim|gonderildi|yok|var|gorunmuyor|bulunmuyor|wrong|correct|incorrect|below|above|attached|unchanged|on|the|is|was|changed|printed|written|same|not|missing|up|down|slow|working|broken|fine|ok|okay|back|offline|online)$/u;
/** Türkçe fiil / yüklem sonu ("çalışmıyor", "bilmiyorum", "değişmeyecek", "gelmedi") — sözcük biçimli ağ adı OLAMAZ (Haiku 10-12 3. tur). */
const VERB_LIKE_END = /(?:yor|yorum|yoruz|yorsunuz|mez|maz|mem|mam|cak|cek|cagim|cegim|madi|medi|mis|mus|dim|dum|tim|tum)$/u;
/**
 * Değer biçimi: şifre en az bir RAKAM içerir (sözcük biçimli şifre ASLA — "Wi-Fi şifresi: çalışmıyor" değer değildir, kurucu 10-11 dersi;
 * Haiku 10-12 3. tur gevşek kuralı kaldırdı). Ağ adı rakam / "-" / "_" içerir ya da büyük harfle başlayan ≥ 4 harf; açık ":" / "="
 * ayracından sonra satırı bitiren, fiil sonu taşımayan ≥ 3 harf de kabul ("Ağ adı: lale").
 */
const looksLikePassword = (v: string) => /\d/.test(v);
const looksLikeNetwork = (v: string) => /[\d_-]/.test(v) || (/^\p{Lu}/u.test(v) && v.length >= 4);
/** Değerden sonra yalnız satır / metin sonu → değer satırı bitiriyor (gevşek ağ adı kuralı için). */
const ENDS_LINE = /^["'”»]?[ \t]*(?:$|\n)/u;
/**
 * Değerden sonra aynı satırda HARF / RAKAMLA başlayan bir sözcük varsa ve bu bir etiket / bağlaç değilse değer BELİRSİZ (boşluklu şifre ya
 * da ağ adı olabilir: "Sonbahar2024 Lale", "Lale Ev") → değer yok (Haiku 10-12 3. tur: ilk sözcük yanlış yere yazılıyordu).
 */
const AFTER_VALUE_OK = new RegExp(
  `^["'”»)\\]>}]?[ \\t]*(?:$|\\n|[.,;:!?)\\]]|\\p{Extended_Pictographic}|(?:ve|and|ile|a[ğg]|wi-?fi|kablosuz|network|ssid|[şs]ifre\\p{L}{0,4}|parola\\p{L}{0,3}|password|ol\\p{L}{0,8}|de[ğg]i[şs]\\p{L}{0,8}|[şs]eklinde|kullan\\p{L}{0,12}|iyi|is|was|now|for|have|enjoy|thanks|te[şs]ekk[üu]r\\p{L}{0,6})(?![\\p{L}\\p{N}]))`,
  "iu",
);

/**
 * Wi-Fi şifresi değeri (WPA: 8–63 karakter, boşluksuz). Türkçe / İngilizce: "Wi-Fi şifresi: X", "yeni şifre X", "password is now X".
 * ÖZGÜN metinde koşar (büyük-küçük harf korunur); Türkçe harfler sınıfla kabul edilir (katlama YOK — konum kayması olmasın).
 */
const PASSWORD_VALUE = new RegExp(
  `${NL}(?:[şs]ifre(?:si|miz|niz|yi|yı)?|parola(?:s[ıi]|y[ıi])?|password)${NR}\\s*(?:(?:yeni|art[ıi]k|now|is|olarak|ise|changed\\s+to)\\s*){0,3}(?<sep>[:=\\-–])?[*_~\`]*\\s*["'“”«(\\[<{]?(?<v>[\\p{L}\\p{N}!#$%&*+@_.~^=?-]{8,63})`,
  "iu",
);
/** Ağ adı (SSID): "Ağ adı: X", "Wi-Fi adı X", "ağ adımız X", "misafir ağı adı X", "network name is X", "SSID: X". */
const NETWORK_VALUE = new RegExp(
  `${NL}(?:(?:a[ğg](?:[ıi]n|[ıi])?|wi-?fi|kablosuz\\s+a[ğg])\\s+(?:ad[ıi](?:m[ıi]z|n[ıi]z)?|ismi)|network(?:\\s+name)?|ssid)${NR}\\s*(?:(?:is|now|art[ıi]k)\\s*){0,2}(?<sep>[:=\\-–])?[*_~\`]*\\s*["'“”«(\\[<{]?(?<v>[\\p{L}\\p{N}!#$%&*+@_.~^=?-]{2,32})`,
  "iu",
);
/**
 * Wi-Fi OLMAYAN şifre etiketi: modem / yönetici paneli, kapı, kasa, alarm, anahtar kutusu ("Modem admin şifresi: admin1234", "Kapı şifresi:
 * 4829#1234", "modem arayüzü şifresi", "kapının şifresi" — etiket + ≤ 5 harflik ek). Etiketten hemen önceki ≤ 24 karakterde aranır (sabit
 * pencere — uzun metinde karesel iş yok).
 */
const NON_WIFI_LABEL =
  /(?<![\p{L}\p{N}])(?:admin|modem|router|y[öo]netic|y[öo]netim|panel|aray[üu]z|kap[ıi]|door|gate|kasa|safe|alarm|lockbox|anahtar\s+kutu|key\s*box)\p{L}{0,5}\s*$/iu;

function cleanValue(v: string | undefined): string | null {
  if (!v) return null;
  // Biçimlendirme işaretleri ("**Şifre:** abc12345", "_abc12345_") ve sondaki nokta / parantez atılır; "!" şifrenin parçası olabilir.
  const t = v.replace(/^[*_~`]+/u, "").replace(/[*_~`]+$/u, "").replace(/[.)\]]+$/u, "");
  return t.length >= 2 && !NOT_A_VALUE.test(foldTurkishAscii(t).toLowerCase()) ? t : null;
}

/** Yatay boşluk dizisi teke iner (bitişik boşluk niceleyicileri uzun dizide karesel olmasın); değerler boşluk içermez. */
const squash = (t: string) => t.replace(/[^\S\n]+/g, " ").replace(/(?<![*_~`])[*_~`]+(?=\s*[:=])/g, "");

/**
 * Eşleşmeden değer: null = Wi-Fi etiketi DEĞİL (modem / kapı şifresi) ya da etiket sözcüğü düz cümlede ("Şifreyi değiştirdim", "şifre yanlış");
 * "ambiguous" = etiket VAR ama değer okunamıyor (ardından etiket olmayan sözcük, açık ":" sonrası sözcük biçimli şifre) → o metinde hedef
 * belirsiz; string = geçerli değer.
 */
function valueOf(m: RegExpMatchArray, t: string, field: "password" | "network"): string | "ambiguous" | null {
  const start = m.index ?? 0;
  if (NON_WIFI_LABEL.test(t.slice(Math.max(0, start - 24), start))) return null;
  const v = cleanValue(m.groups?.v);
  if (!v) return null;
  const sep = m.groups?.sep;
  const explicit = sep === ":" || sep === "=";
  const after = t.slice(start + m[0].length);
  // Sonu "!" ya da cümleye bitişik ("Lale2024.Teşekkürler") → değerin nerede bittiği belirsiz (Haiku 10-12 4. tur).
  if (/!$/.test(m.groups?.v ?? "") || /\.\p{Lu}\p{Ll}{2,}/u.test(v)) return "ambiguous";
  const shapeOk = field === "password" ? v.length >= 8 && looksLikePassword(v) : looksLikeNetwork(v);
  if (shapeOk) return AFTER_VALUE_OK.test(after) ? v : "ambiguous";
  if (!explicit) return null; // ayraçsız sözcük → düz cümle ("şifre değiştirilmedi")
  if (field === "network" && v.length >= 3 && /^\p{L}+$/u.test(v) && !VERB_LIKE_END.test(foldTurkishAscii(v).toLowerCase()) && ENDS_LINE.test(after)) {
    return v; // "Ağ adı: lale" (satırı bitiren, fiil sonu taşımayan)
  }
  return "ambiguous"; // "Wi-Fi şifresi: çalışmıyor" / "Şifre: lalehouse" — değer değil ama kalemde hedef de belirsiz
}

/** Bir alanın Wi-Fi etiketleri: kaç etiket var ve hangileri GEÇERLİ değer verdi (belirsiz etiket sayılır ama değer vermez). */
function wifiField(text: string, field: "password" | "network"): { labels: number; values: string[] } {
  const t = squash(text);
  const re = new RegExp((field === "password" ? PASSWORD_VALUE : NETWORK_VALUE).source, "giu");
  let labels = 0;
  const values: string[] = [];
  for (const m of t.matchAll(re)) {
    const v = valueOf(m, t, field);
    if (v === null) continue; // Wi-Fi etiketi değil (modem / kapı)
    labels++;
    if (v !== "ambiguous") values.push(v);
  }
  return { labels, values };
}

/** Ev sahibinin metninden Wi-Fi şifresi / ağ adı — alan için TEK, belirsiz olmayan etiket varsa. Şifre BÜYÜK-KÜÇÜK harf korunur. */
export function extractWifiValues(text: string | null | undefined): { password: string | null; network: string | null } {
  if (typeof text !== "string" || text.length > 4_000) return { password: null, network: null };
  const one = (field: "password" | "network") => {
    const f = wifiField(text, field);
    // Tek değer ya da hepsi AYNI değer; iki farklı değer ("Eski şifre: X, yeni şifre: Y") → hangisi? belirsiz (Haiku 10-12 4. tur).
    return f.labels >= 1 && f.values.length === f.labels && new Set(f.values).size === 1 ? f.values[0] : null;
  };
  return { password: one("password"), network: one("network") };
}

/**
 * Bilgi tabanı kaleminde bu alan için hedef BELİRSİZ mi: birden çok değer (ana + misafir ağı — Haiku 10-12) ya da okunamayan etiket
 * ("Wi-Fi adı: Lale Ev" boşluklu) → öneri YOK. Modem / kapı şifresi sayılmaz.
 */
export function wifiTargetAmbiguous(text: string, field: "password" | "network"): boolean {
  const f = wifiField(text, field);
  return f.values.length > 1 || f.labels > f.values.length;
}

/** Kalemdeki geçerli değer sayısı (modem / kapı şifresi sayılmaz). */
export function wifiValueCount(text: string, field: "password" | "network"): number {
  return wifiField(text, field).values.length;
}

/** Değerin bilgi tabanı metninde AYNEN geçip geçmediği (şifre büyük-küçük harfe duyarlı; ağ adı duyarsız). */
export function kbContainsValue(kbContent: string, value: string, caseSensitive: boolean): boolean {
  return caseSensitive ? kbContent.includes(value) : kbContent.toLocaleLowerCase("tr").includes(value.toLocaleLowerCase("tr"));
}

/**
 * Bilgi tabanı metninde eski değeri yenisiyle değiştir: geçerli değer metinde TAM BİR KEZ geçiyorsa yerine yazılır (başlıkta / başka satırda
 * da geçen değer — "Lale Apart … Ağ adı: Lale" — yanlış yere yazılmasın: Haiku 10-12 3. tur); kalemde o alan hiç yoksa satır eklenir
 * ("Şifre: X" / "Ağ adı: X"); hedef belirsizse null (öneri yok / onay yazmaz). Saf — onaydan ÖNCE önizleme de bununla kurulur.
 */
export function applyWifiValue(kbContent: string, field: "password" | "network", value: string): string | null {
  if (wifiTargetAmbiguous(kbContent, field)) return null;
  const [current] = wifiField(kbContent, field).values;
  if (current === value) return kbContent;
  if (current) {
    const i = kbContent.indexOf(current);
    if (i < 0 || kbContent.indexOf(current, i + 1) >= 0) return null;
    return kbContent.slice(0, i) + value + kbContent.slice(i + current.length);
  }
  const label = field === "password" ? "Şifre" : "Ağ adı";
  return `${kbContent.trimEnd()}\n${label}: ${value}`;
}

/** Ev sahibine gösterilen maske: "••••89" (şifre kartta açık yazılmaz). */
export function maskSecret(value: string): string {
  return `••••${value.slice(-2)}`;
}

// ── ÖLÇÜT ────────────────────────────────────────────────────────────────────

export interface SuggestionDecision {
  kind: SuggestionKind;
  decision: "approved" | "dismissed";
  /** Onaylanırken ev sahibi öneriyi değiştirdi mi (ör. sözün saati). */
  edited: boolean;
  at: Date;
}

/**
 * "Beğenirsek otomatik" ölçütü (kurucu 10-12: 2 hafta, ≥ %90): pencere içindeki kararlarda DÜZENLEMESİZ onay oranı. Karar sayısı
 * eşiğin altındaysa hazır sayılmaz. Otomatiğe geçiş ayrı karar / anahtar — bu fonksiyon yalnız ölçer.
 */
export function promotionReadiness(decisions: readonly SuggestionDecision[], now: Date): Record<SuggestionKind, { decided: number; cleanApproved: number; rate: number | null; ready: boolean }> {
  const since = now.getTime() - AUTO_PROMOTION_WINDOW_DAYS * 86_400_000;
  const out = {} as Record<SuggestionKind, { decided: number; cleanApproved: number; rate: number | null; ready: boolean }>;
  for (const kind of SUGGESTION_KINDS) {
    const inWindow = decisions.filter((d) => d.kind === kind && d.at.getTime() >= since && d.at.getTime() <= now.getTime());
    const clean = inWindow.filter((d) => d.decision === "approved" && !d.edited).length;
    const rate = inWindow.length > 0 ? clean / inWindow.length : null;
    out[kind] = {
      decided: inWindow.length,
      cleanApproved: clean,
      rate,
      ready: inWindow.length >= AUTO_PROMOTION_MIN_DECISIONS && rate !== null && rate >= AUTO_PROMOTION_MIN_RATE,
    };
  }
  return out;
}

// ── I1 · SÖZÜN KONUSU (kurucu 10-17 "A", migration 73) ─────────────────────────────────────────────────────────────────────────────────
// Aynı tür + aynı saatte iki FARKLI konu ("Klima için teknisyen 18:00" + "Musluk için usta 18:00") iki söz + iki görevdir. Konu YALNIZ sözün
// parçasından, kodla (model yok): bakımda cihaz okuyucusu (görev tekilleştirmesiyle AYNI — `firstBreakdownDevice`, kurucu 10-15 "Klima bozuk
// ile Musluk bozuk birleşmemeli") + İngilizce cihaz kavramları; eksik eşyada eşya adı. Parçada İKİ farklı konu → null (tek ziyaret / teslimat
// olabilir; konusuz söz mevcut sözlerle birleşir). Havlu / temizlik → null (aynı saatte havlu + çarşaf tek teslimat; tek temizlik ziyareti).

/** Cihaz kökü (`firstBreakdownDevice` çıktısı, Türkçe) → konu. Haritada olmayan kök (makine, cihaz, motor, dolap…) konu ÜRETMEZ. */
const DEVICE_STEM_TO_TOPIC: Readonly<Record<string, CommitmentTopic>> = {
  klima: "ac",
  kombi: "heating",
  petek: "heating",
  kalorifer: "heating",
  radyatör: "heating",
  ısıtıcı: "heating",
  şofben: "hot_water",
  termosifon: "hot_water",
  musluk: "faucet",
  lavabo: "faucet",
  sifon: "faucet",
  tuvalet: "toilet",
  klozet: "toilet",
  duş: "shower",
  buzdolabı: "fridge",
  bulaşık: "dishwasher",
  çamaşır: "laundry",
  ocak: "stove",
  fırın: "stove",
  mikrodalga: "microwave",
  televizyon: "tv",
  tv: "tv",
  kumanda: "tv",
  modem: "wifi",
  router: "wifi",
  kapı: "door",
  kilit: "door",
  lamba: "light",
  ışık: "light",
  priz: "socket",
  asansör: "elevator",
  su: "water",
};

/** İngilizce cihaz kavramı (`topicsOf` kimlikleri) → konu. */
const CONCEPT_TO_TOPIC: Readonly<Record<string, CommitmentTopic>> = {
  ac: "ac",
  heating: "heating",
  hot_water: "hot_water",
  fridge: "fridge",
  dishwasher: "dishwasher",
  laundry: "laundry",
  stove: "stove",
  microwave: "microwave",
  tv: "tv",
  wifi: "wifi",
  keys: "door",
  socket: "socket",
  elevator: "elevator",
};

/** Kavram sözlüğünde olmayan / eksik İngilizce cihaz sözcükleri (katlanmış metinde, tam sözcük) — Türkçe kökle eşdeğer kapsam (Haiku 10-17). */
const EN_PLUMBING: ReadonlyArray<readonly [CommitmentTopic, RegExp]> = [
  ["faucet", /(?<![\p{L}])(?:taps?|faucets?|sinks?)(?![\p{L}])/u],
  ["toilet", /(?<![\p{L}])(?:toilets?|flush)(?![\p{L}])/u],
  ["shower", /(?<![\p{L}])showers?(?![\p{L}])/u],
  ["light", /(?<![\p{L}])(?:lights?|lamps?|lighting)(?![\p{L}])/u],
  ["heating", /(?<![\p{L}])(?:heating|heaters?|radiators?|boilers?)(?![\p{L}])/u],
  ["water", /(?<![\p{L}])(?:water|leaks?|leaking)(?![\p{L}])/u],
];

/**
 * YAN öğe kökleri (Haiku 10-17): "Musluk SUYU", "Klimanın KUMANDASI" — başka bir cihaz kökü varsa konu üretmez (ana cihazın parçasıdır);
 * tek başınaysa konudur ("Su için tesisatçı gelecek" → su).
 */
const SECONDARY_STEMS: ReadonlySet<string> = new Set(["su", "kumanda"]);
/**
 * BELİRSİZ kökler (Haiku 10-17): yer / ay / talimat anlamı da taşır ("kapıya gelecek", "Ocak ayında", "Işıkları açık bırakmayın") → yalnız
 * hemen ardından "için" ya da en çok 4 sözcük içinde onarım fiili gelirse konu ("Kapıyı yarın usta tamir edecek", "Ocak için servis gelecek").
 */
const AMBIGUOUS_STEMS: ReadonlySet<string> = new Set(["kapı", "kilit", "ocak", "ışık"]);
const REPAIR_CUE = /^(?:icin|tamir|degis|onar|duzel|bak|kontrol|ayarla|fix|repair|replace|check)/u;
const AMBIGUOUS_CUE_WINDOW = 4;

/** Eksik eşya konusu (katlanmış metin; `KIND_TOPICS` supplies kalıbının alternatifleriyle aynı sözcükler). */
const SUPPLY_TOPICS: ReadonlyArray<readonly [CommitmentTopic, RegExp]> = [
  ["toilet_paper", /(?<![\p{L}])(?:tuvalet\s+kagidi|toilet\s+paper)/u],
  ["shampoo", /(?<![\p{L}])(?:sampuan|shampoo)/u],
  ["soap", /(?<![\p{L}])(?:sabun|soap)/u],
  ["coffee", /(?<![\p{L}])(?:kahve|coffee)/u],
  ["tea", /(?<![\p{L}])(?:cay|tea)(?![\p{L}])/u],
  ["sugar", /(?<![\p{L}])seker/u],
  ["battery", /(?<![\p{L}])(?:pil(?:ler)?|batter(?:y|ies))(?![\p{L}])/u],
  ["bulb", /(?<![\p{L}])(?:ampul|bulbs?)/u],
  ["trash_bags", /(?<![\p{L}])cop\s+poseti/u],
  ["drinking_water", /(?<![\p{L}])(?:icme\s+suyu|damacana)/u],
  ["detergent", /(?<![\p{L}])(?:deterjan|detergent)/u],
];

const WORDS = /[^\p{L}\p{N}'’]+/u;
/**
 * Sözcük tavanı: parça zaten bir cümleciğin en çok birkaç virgül parçası. Tavanı AŞAN parça konusuz (Haiku 10-17: sessiz kesme sonda kalan
 * ikinci cihazı görmeyip yanlış TEK konu üretiyordu).
 */
const MAX_TOPIC_WORDS = 60;
/** Kavram okuyucusuna verilen en çok karakter (maliyet sınırı; söz parçası bundan uzunsa İngilizce yol konu üretmez). */
const MAX_CONCEPT_CHARS = 400;

export function commitmentTopicOf(kind: CommitmentKind, scopeRaw: string, scopeFolded: string): CommitmentTopic | null {
  const found = new Set<CommitmentTopic>();
  if (kind === "maintenance") {
    const words = scopeRaw.split(WORDS).filter(Boolean);
    if (words.length > MAX_TOPIC_WORDS) return null;
    const folded = words.map((w) => foldTurkishAscii(w).toLowerCase());
    const secondary = new Set<CommitmentTopic>();
    // Türkçe cihaz kökü GÖRÜLDÜ mü (konu üretmese de — belirsiz / haritasız kök): görüldüyse kavram sözlüğüne düşülmez (Haiku 10-17: "Ocak
    // ayında", "Anahtarlarınızı getirecek" kökte elendiği hâlde kavram yolundan ocak / kapı konusu geri geliyordu).
    let sawStem = false;
    for (let i = 0; i < words.length; i++) {
      const stem = firstBreakdownDevice(words[i]!)?.toLocaleLowerCase("tr");
      if (!stem) continue;
      sawStem = true;
      const t = DEVICE_STEM_TO_TOPIC[stem];
      if (!t) continue;
      if (AMBIGUOUS_STEMS.has(stem) && !folded.slice(i + 1, i + 1 + AMBIGUOUS_CUE_WINDOW).some((w) => REPAIR_CUE.test(w))) continue;
      (SECONDARY_STEMS.has(stem) ? secondary : found).add(t);
    }
    if (found.size === 0) for (const t of secondary) found.add(t);
    // İngilizce yol YALNIZ Türkçe cihaz kökü yoksa. Önce AÇIK sözcük ("heating", "shower", "light"); yoksa kavram sözlüğü — kavramlar geniş
    // ("kombi" / "heating" hem ısıtma hem sıcak su kavramıdır; açık sözcük varken ikisi birden eklenseydi tek cihazlı söz konusuz kalırdı).
    if (!sawStem && scopeRaw.length <= MAX_CONCEPT_CHARS) {
      const en = new Set<CommitmentTopic>();
      for (const [t, re] of EN_PLUMBING) if (re.test(scopeFolded)) en.add(t);
      // İngilizce "water" da yan öğedir ("the shower water", "the AC leak").
      if (en.size > 1) en.delete("water");
      if (en.size > 0) {
        for (const t of en) found.add(t);
      } else {
        for (const c of deviceTopicsOf(topicsOf(scopeRaw))) {
          const t = CONCEPT_TO_TOPIC[c];
          if (t) found.add(t);
        }
      }
    }
  } else if (kind === "supplies") {
    for (const [t, re] of SUPPLY_TOPICS) if (re.test(scopeFolded)) found.add(t);
  }
  return found.size === 1 ? [...found][0]! : null;
}
