/* ---------------------------------------------------------------------------
 * MÜSAİTLİK VETOSU — doğrulanmamış müsaitlik iddiası / izni OTOMATİK GÖNDERİLMEZ (09-24).
 *
 * 🚨 KURUCU KARARI (09-24, /loop): "kontrol etmeden cevap vermesini engelle". Ölçülen açık
 * (`docs/MUSAITLIK-MOTORU-2026-09-24.md`): "Evet, 14 Ekim gecesi daire boş; bir gece daha
 * kalabilirsiniz." · "Yes, next weekend is available." · "Unfortunately we're fully booked that
 * night." — üçü de iki gönderim kapısından GEÇİYORDU (güven ≥0.75, risk none). Model takvimi
 * GÖRMÜYOR: istemdeki komşuluk satırları veritabanımızın kaydıdır, bayat olabilir; müsaitlik motoru
 * bugün köprüye bağlı mülkte dürüstçe "bilinmiyor" der. Yani bugün modelin her müsaitlik cümlesi
 * TANIM GEREĞİ doğrulanmamıştır. Sonuç çift rezervasyon, ücretsiz fazladan gece ya da kaybedilen gelir.
 *
 * ── KURAL (iki bacak, yalnız KISITLAYICI) ──────────────────────────────────────────────────────
 *  1. İDDİA: cevap takvim DURUMU söylüyorsa ("o gece boş / doluyuz / başka rezervasyon yok /
 *     available / fully booked") ya da konaklama DEĞİŞİKLİĞİNE İZİN veriyorsa ("bir gece daha
 *     kalabilirsiniz / erken giriş mümkün / late checkout is fine") → gönderilmez
 *     (`availability_claim`). Ertelemeyle birlikte olsa bile: "O gece boş ama ev sahibiniz teyit
 *     etsin" yine takvim iddiasıdır.
 *  2. İSTEK: misafirin cevapsız mesajlarından biri müsaitliğe BAĞLI bir istekse (ek gece · uzatma ·
 *     erken giriş · geç çıkış · tarih değişikliği · "şu tarihte boş mu") cevap ancak kararı açıkça
 *     ERTELİYORSA ve bu İKİ BAĞIMSIZ MODELLE doğrulandıysa gider (↓"BELİRSİZLİK GÜVENLİ DEĞİLDİR").
 *     Ertelemeyen / doğrulanamayan cevap → `availability_unconfirmed`. Bu bacak kelime listesinin
 *     kaçırdığı dolaylı izni de kapatır ("Tabii, sizi bir gece daha ağırlarız!" · "Olur, bekliyoruz").
 *  Host'un tanımladığı GEÇ ÇIKIŞ TEKLİFİ bloğu çalışmaya devam eder: istem o teklifi "uygunluğu ev
 *  sahibinizin kararıdır" ile paylaştırır; erteleyen cevapta teklif metni iddia sayılmaz. Bilgi sorusuna
 *  eklenen teklif gider; geç çıkış İSTEĞİNE teklif aktarımı ise bekçi kapalıyken taslakta kalır (↓).
 *
 * ── BELİRSİZLİK GÜVENLİ DEĞİLDİR (kurucu 09-24, değişmez) ───────────────────────────────────────
 * "Bekçi çöktü → kelime ağı bir şey bulamadı → cevap gitti" açığı kapatıldı. Kural:
 *   HASSAS İSTEK (herhangi bir katman: kelime ağı · cevap modelinin beyanı ya da niyet etiketi · bekçi ·
 *   anlama katmanı) + herhangi bir güvenlik sinyali YOK / düştü / tanınmıyor / çelişiyor → OTOMATİK
 *   GÖNDERİM YOK. Ayrı ayrı kapanan üç durum:
 *    · bekçi YOK (bayrak kapalı) ya da DÜŞTÜ (zaman aşımı / bozuk JSON) → hassas istek insana;
 *    · cevap modelinin beyanı YOK / tanınmıyor / kendi niyet etiketiyle ÇELİŞİYOR + hassas istek → insana;
 *    · kelime ağının SESSİZLİĞİ hiçbir zaman izin değildir; kelime ağının erteleme cümlesi de izin
 *      değildir (yalnız kanıta yazılır). Kelime ağı yalnız ENGELLER.
 * Hassas olmayan soru ("Check-in saat kaçta?") bekçi yokken de cevaplanır — her arızada her mesajı
 * durdurmak gereksizdir; bilgi sorusu ile izin talebini ayıran, katmanların İSTEK sinyalidir.
 *
 * ── DOĞRULANMIŞ TAKVİM GELİNCE (kurucu sorusu 09-24, Airbnb Direct) ─────────────────────────────
 * Kural "iddia yasak" değil "iddia yalnız DOĞRULANMIŞ takvim sonucuyla eşleşirse" demektir. Bugün
 * modele doğrulanmış sonuç VERİLMİYOR (motor AI'ya bağlı değil), bu yüzden her iddia durur. Airbnb
 * Direct takvimi + motorun `verified` kararı `verifiedToolResults` olarak isteme girdiğinde, iddia
 * bacağı o sonuçla eşleşen cümleyi geçirecek şekilde genişletilir (ayrı dilim + golden set). "KABUL"
 * ise ayrı: Airbnb'de uzatma, misafirin platformdan gönderdiği değişiklik talebini host'un
 * onaylamasıyla kesinleşir — sohbetteki "kalabilirsiniz" rezervasyonu DEĞİŞTİRMEZ, o gece başka
 * birine satılabilir. Otomatik onay = V3 Aksiyonlar (host kuralı + güvenli yürütücü).
 *
 * ── MİMARİ (kurucu düzeltmesi 09-24: "kelimeye takılma, anlamı modelle çıkar") ─────────────────
 * Bu dosyanın kelime ağı ARTIK YALNIZ YEDEKTİR. Kör batarya ölçtü (uygulamayı görmeyen ajan,
 * `evals/stay-change.json` dev): ağ izinlerin 19/60'ını, takvim iddialarının 31/57'sini, isteklerin
 * 77/125'ini yakalıyor — insan dili kalıpla kapatılamaz, kalıp eklemek görülen bataryaya aşırı uyum
 * üretir. Karar `evaluateAvailability`te DÖRT katmanın birleşimidir, hepsi yalnız SIKILAŞTIRIR:
 *   1. deterministik yedek (bu dosya; model yokken/arızadayken de çalışır — BÜYÜTÜLMEZ,
 *      tabanı `stay-change-backstop-floor.test.ts` circirinde);
 *   2. cevap modelinin şema beyanı (`stayChangeAsked` + `replyStance`, ana JSON'da);
 *   3. bağımsız bekçi (ikinci model, `semantic/guard.ts`, bayrak `AI_STAY_GUARD_ENABLED`);
 *   4. anlama katmanı (`semantic/understand.ts`, bayrak `AI_UNDERSTANDING_ENABLED`).
 * Model saati ÇIKARIR, standart saatle kıyası KOD yapar. ERTELEME kanıtı izin yönlüdür: YALNIZ iki
 * bağımsız modelin (güvenilir beyan + koşmuş bekçi) "erteliyor" hükmü — tek model yetmez, kelime ağı
 * sayılmaz. Tasarım + açma sırası: `docs/ANLAM-KATMANI-2026-09-24.md`.
 *
 * ── SINIRLAR (bilinçli) ───────────────────────────────────────────────────────────────────────
 *  · Kelime ağı: iddia TR/EN'de geniş, DE/FR/ES/RU/AR'da temel; istek yedi dilde. Kaçan iddia
 *    yukarıdaki model katmanlarının işidir; yanlış pozitif = host'a taslak (güvenli yön).
 *  · SAF: DB yok, ağ yok, LLM yok, `server-only` yok. Girdi yalnız metin + kodun verdiği sinyaller.
 * ------------------------------------------------------------------------- */

import { foldTurkishAscii, restrictiveMatchForms } from "@/lib/ai/fallback";
import {
  declaredClaim,
  declaredRequest,
  hhmmToMinutes,
  normalizeHhmm,
  slotTimesShifted,
  stayReplyIntentOf,
  type StayChangeDeclaration,
  type StayReplyIntent,
  type StayGuardOutcome,
  type StayGuardVerdict,
  type StayTimes,
  type UnderstandingStaySignal,
} from "@/lib/ai/semantic/stay-change";

/** Kapalı küme — `RiskEvent.reason` ile aynı sözleşme (PII taşımaz). */
export const AVAILABILITY_VETO_REASONS = ["availability_claim", "availability_unconfirmed"] as const;
export type AvailabilityVetoReason = (typeof AVAILABILITY_VETO_REASONS)[number];

export type AvailabilityRequestKind = "extend" | "early" | "late" | "date_change" | "availability";

// ─── yardımcı kalıp parçaları ─────────────────────────────────────────────────

/** Unicode-farkında kelime sınırları (JS `\b` yalnız ASCII bilir). */
const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";
/** Türkçe ek kuyruğu. */
const L = "\\p{L}*";
/** Cümlecik içi sözcük (cümlecikler önceden bölündüğü için sınır aşmaz). */
const T = "\\S+";
/** İki sözcük arasına en fazla `n` sözcük girebilir (sınırlı → geri izleme patlaması yok). */
const gap = (n: number) => `(?:\\s+${T}){0,${n}}\\s+`;
const CI = "check[\\s\\-\\u2010\\u2011]?in";
const CO = "check[\\s\\-\\u2010\\u2011]?out";
/** Saat: "15:00", "15.00", "3 pm" — tarih değil. */
const CLOCK_AHEAD = "(?!\\s+(?:from|after|at|until|till|between|by)\\s+\\d{1,2}(?:[:.]\\d{2}|\\s*(?:am|pm|a\\.m\\.|p\\.m\\.|o'?clock|h)(?![\\p{L}\\p{N}])))";

/**
 * İngilizce kısaltmalar (ikinci inceleme 09-24, DOĞRULUK düzeltmesi — kapsam genişletme değil): eski kalıplar
 * "'re / 'll"i `you\\s+` / `we\\s+` ARDINA koyuyordu, yani "you're" / "we'll" HİÇ eşleşemiyordu ("You're welcome
 * to stay another night", "We'll extend your stay" izin olduğu hâlde geçiyordu). Kesme düz ya da kıvrık olabilir;
 * katlanmış biçimde kesme boşluğa dönüşür ("you re").
 */
// U+02BC (değiştirici harf kesmesi) da kesmedir (son denetim 09-24: "youʼre" / "weʼll" eşleşmiyordu).
const AP = "['’ʼ]";
const RE = `(?:${AP}\\s*|\\s+)re`;
const LL = `(?:${AP}\\s*|\\s+)ll`;
const VE = `(?:${AP}\\s*|\\s+)ve`;
/** "'s" = "is" kısaltması ("Nobody's checking in", "there's"). */
const S_IS = `(?:${AP}\\s*|\\s+)s`;
const rx = (parts: readonly string[]) => parts.map((p) => new RegExp(p, "iu"));

/**
 * GÖMÜLÜ SORU / KOŞUL İDDİA DEĞİLDİR (ilk ölçüm, 09-24): istemin KENDİ İngilizce standart cümlesi
 * "Whether an early check-in is possible is the host's call" içinde "early check-in is possible"
 * geçiyor. "whether / if / once / when / until / ask" ile açılan yan cümlecikteki durum cümlesi bir
 * iddia değil, sorunun kendisidir. (Değişken uzunluklu geri bakış — V8 destekler.)
 */
// ⚠️ Geri bakış VİRGÜLÜ AŞMAZ (ikinci inceleme 09-24, doğruluk düzeltmesi): "If you want, you can stay another
// night." / "Once you confirm, early check-in is possible." — koşul cümleciği virgülde biter, ANA cümlecikteki
// izin iddiadır; eski `\S+` belirteci "want," üzerinden geçip izni gömülü soru sanıyordu.
const NOT_EMBEDDED_EN = "(?<!(?:whether|[iı]f|once|when|until|ask|ask[iı]ng)\\s+(?:[^\\s,;:]+\\s+){0,3})";
/** Türkçe karşılığı: "boş OLUP OLMADIĞI", "müsait Mİ" — soru/gömülü soru, iddia değil. "değil" İDDİADIR. */
const NOT_QUESTIONED_TR = "(?!\\s+(?:olup|olmad\\p{L}*|m[iıuü])(?![\\p{L}\\p{N}]))";

// ─── İSTEK (misafir mesajı) ──────────────────────────────────────────────────

const TR_MONTHS = "ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik";

const REQUEST_PATTERNS: Record<AvailabilityRequestKind, RegExp[]> = {
  extend: rx([
    // TR (ASCII katlanmış biçimde yazılır; tüm katlamalar sınanır)
    `${NL}(?:bir|bi|1|iki|2|uc|3|birkac|bi\\s*kac|ekstra|fazladan|ilave)\\s+(?:gece|gun|aksam)(?:lik|luk)?\\s+(?:daha|fazla|ekstra|ilave)${NR}`,
    `${NL}(?:fazladan|ekstra|ilave|ek)\\s+(?:bir\\s+|1\\s+|iki\\s+|2\\s+)?(?:gece|gun)${L}`,
    `${NL}(?:konaklama|rezervasyon|kalis|kalma|tatil|sure|cikis\\s+tarih|tarih)${L}${gap(3)}uzat`,
    `${NL}uzat(?:abilir|abilecek|abilme|mak|mamiz|mayi|alim|sak|tirabilir|irsak|ir\\s+mi|ilabilir|ilir\\s+mi)${L}`,
    `${NL}(?:daha\\s+(?:fazla|uzun)|biraz\\s+daha|bir\\s+sure\\s+daha|bir\\s*kac\\s+gun\\s+daha)\\s+(?:kal|konakla)${L}`,
    `${NL}ertesi\\s+gun${L}${gap(1)}(?:kadar\\s+)?kal${L}`,
    `${T}\\s+(?:kadar|dek)\\s+kal(?:abil|sak|mak|mamiz|alim|ir\\s+mi|ma\\s+imkan)${L}`,
    // EN
    `${NL}(?:one|1|two|2|three|3|an|another|a\\s+few|few|a\\s+couple(?:\\s+of)?|couple(?:\\s+of)?|some)\\s+(?:more|extra|additional)\\s+(?:night|nights|day|days)${NR}`,
    `${NL}(?:extra|additional)\\s+(?:night|nights|day|days)${NR}`,
    `${NL}another\\s+(?:night|day)${NR}`,
    `${NL}(?:night|nights|day|days)\\s+(?:longer|more)${NR}`,
    `${NL}extend(?:ing|ed)?${gap(1)}(?:stay|booking|reservation|visit|trip|rental|${CO}|nights?)${NR}`,
    `${NL}extend${NR}`,
    `${NL}(?:stay|booking|reservation)\\s+extension${NR}`,
    `${NL}extension\\s+(?:of|to|for)${gap(1)}(?:stay|booking|reservation|nights?)${NR}`,
    `${NL}(?:stay|remain)${gap(2)}(?:longer|until|till|through|past)${NR}`,
    `${NL}keep\\s+the\\s+(?:apartment|flat|place|room|unit|house|keys?)${gap(1)}(?:longer|until|till|another|extra|past)${NR}`,
    // DE / FR / ES / RU / AR
    `${NL}(?:noch\\s+)?(?:eine|einen|1|zwei|2)\\s+(?:weitere[n]?\\s+|zus(?:ä|a)tzliche[n]?\\s+)?(?:nacht|n(?:ä|a)chte|tag|tage)\\s+(?:l(?:ä|a)nger|mehr)${NR}`,
    `${NL}noch\\s+(?:eine|einen|1|zwei|2)\\s+(?:nacht|n(?:ä|a)chte|tag|tage)${NR}`,
    `${NL}verl(?:ä|a)nger${L}`,
    `${NL}l(?:ä|a)nger\\s+bleiben${NR}`,
    `${NL}(?:une|1|deux|2)\\s+nuits?\\s+(?:de\\s+plus|suppl(?:é|e)mentaires?)${NR}`,
    `${NL}nuits?\\s+suppl(?:é|e)mentaires?${NR}`,
    `${NL}prolong(?:er|ation|ons|ez|ar)${L}`,
    `${NL}rester\\s+(?:plus\\s+longtemps|une\\s+nuit|un\\s+jour)${NR}`,
    `${NL}(?:una|1|dos|2)\\s+noches?\\s+m(?:á|a)s${NR}`,
    `${NL}noches?\\s+(?:extra|adicional(?:es)?)${NR}`,
    `${NL}(?:extender|alargar|ampliar)${L}`,
    `${NL}quedar(?:nos|me|se|te)?\\s+(?:m(?:á|a)s|una\\s+noche|otro\\s+d(?:í|i)a)${NR}`,
    `ещ[её]\\s+(?:одн[ау]\\s+|на\\s+одну\\s+|две\\s+|на\\s+две\\s+|пару\\s+|на\\s+пару\\s+|на\\s+)?(?:ноч|сут|дн|ден)`,
    `продл`,
    `дополнительн${L}\\s+(?:ноч|сут|ден|дн)`,
    `остаться\\s+(?:ещ[её]|подольше|дольше|на\\s+(?:ноч|день|сут))`,
    `ليل(?:ة|ه)\\s+(?:إضافية|اضافية|أخرى|اخرى|ثانية)`,
    `ليلتين\\s+(?:إضافيتين|اضافيتين)`,
    `تمديد`,
  ]),
  early: rx([
    `${NL}erken\\s+(?:giris|check|gir|gel|var|yerles|teslim|ulas)${L}`,
    `${NL}daha\\s+erken\\s+(?:gir|gel|var|yerles|check|teslim)${L}`,
    // Fiil ÇEKİMLİ olmak zorunda: çıplak "var"/"al" "Girişten önce market VAR mı?" · "…ALışveriş…"
    // sorularını erken giriş isteği sayıyordu (ilk ölçüm).
    `${NL}(?:${CI}|giris)${L}${gap(2)}(?:erken|once|oncesi|one|erkene)${gap(2)}(?:gir(?:ebil|sek|mek|elim|meyi)|gel(?:ebil|sek|mek|elim|meyi)|yerles(?:ebil|sek|mek|elim)|yap(?:abil|sak|mak)|al(?:abil|sak|mak|inabil)|cek(?:ebil|sek|mek|il)|mumkun|olur${NR}|olabilir|var(?:abil|sak|mak))`,
    `${NL}sabah${L}\\s+(?:erken\\s+)?(?:gir|gel|yerles)(?:ebilir|sek|mek|ebil)${L}`,
    `${NL}early\\s+${CI}${NR}`,
    `${NL}(?:check|checking|get|getting)\\s+in\\s+(?:early|earlier|before)${NR}`,
    `${NL}(?:arrive|arriving|arrival|come|coming|drop\\s+(?:by|off))${gap(2)}(?:early|earlier|sooner)${NR}`,
    `${NL}earlier\\s+(?:${CI}|arrival|access|entry)${NR}`,
    `${NL}early\\s+(?:arrival|access|entry)${NR}`,
    `${NL}(?:access|enter|get\\s+into)\\s+(?:the\\s+)?(?:apartment|flat|place|property|room|unit|house)${gap(1)}(?:early|earlier|before)${NR}`,
    `${NL}fr(?:ü|u)h(?:er)?(?:e|en|es)?\\s+(?:einchecken|anreisen|ankommen|${CI}|einziehen|anreise|ankunft)${NR}`,
    `${NL}(?:arriv${L}|entrer|${CI})\\s+plus\\s+t(?:ô|o)t${NR}`,
    `${NL}(?:${CI}|arriv(?:é|e)e)\\s+anticip(?:é|e)e?${NR}`,
    `${NL}(?:llegar|entrar|hacer\\s+(?:el\\s+)?${CI}|registrarnos)\\s+(?:m(?:á|a)s\\s+)?(?:temprano|antes)${NR}`,
    `${NL}${CI}\\s+(?:anticipado|temprano)${NR}`,
    `ранн${L}\\s+(?:заезд|заселен|въезд|check)`,
    `(?:заселит|заехат|въехат|приехат)${L}\\s+(?:раньше|пораньше)`,
    `(?:دخول|وصول|تسجيل\\s+(?:ال)?دخول)\\s+(?:مبكر|مبكرا|مبكراً|أبكر|ابكر)`,
    `(?:الوصول|الدخول|نصل|ندخل)\\s+(?:مبكرا|مبكراً|أبكر|ابكر)`,
  ]),
  late: rx([
    `${NL}gec\\s+(?:cikis|check|cik|ayril|birak|teslim)${L}`,
    `${NL}daha\\s+gec\\s+(?:cik|ayril|birak)${L}`,
    `${NL}(?:cikis|${CO})${L}${gap(3)}(?:geciktir|ertele|uzat|sonraya|daha\\s+gec)${L}`,
    `\\d{1,2}(?:[:.]\\d{2})?(?:\\s*['’]?\\s*\\p{L}{1,3})?\\s+(?:kadar|dek)${gap(1)}kal${L}`,
    `${NL}late\\s+${CO}${NR}`,
    `${NL}(?:check|checking)\\s+out\\s+(?:late|later|after)${NR}`,
    `${NL}(?:leave|leaving|depart|departing)${gap(2)}(?:later|late)${NR}`,
    `${NL}later\\s+(?:${CO}|departure)${NR}`,
    `${NL}late\\s+departure${NR}`,
    `${NL}sp(?:ä|a)t(?:er)?(?:e|en|es)?\\s+(?:auschecken|abreisen|${CO}|abreise|auszug)${NR}`,
    `${NL}(?:partir|quitter|d(?:é|e)part|${CO}|lib(?:é|e)rer)${L}${gap(3)}plus\\s+tard${NR}`,
    `${NL}(?:d(?:é|e)part|${CO})\\s+tardif${NR}`,
    `${NL}(?:salir|irnos|dejar\\s+el\\s+apartamento|hacer\\s+(?:el\\s+)?${CO})\\s+(?:m(?:á|a)s\\s+)?tarde${NR}`,
    `${NL}(?:salida|${CO})\\s+tard(?:í|i)[oa]${NR}`,
    `поздн${L}\\s+(?:выезд|выселен|check)`,
    `(?:выехат|выселит|уехат|съехат)${L}\\s+(?:позже|попозже)`,
    `(?:خروج|مغادرة|تسجيل\\s+(?:ال)?خروج)\\s+(?:متأخر|متاخر|متأخرا|متأخراً)`,
    `(?:المغادرة|الخروج|نغادر|نخرج)\\s+(?:متأخرا|متأخراً|لاحقا|لاحقاً)`,
  ]),
  date_change: rx([
    `${NL}tarih${L}${gap(2)}(?:degis|kaydir|ertele|one\\s+al|one\\s+cek|guncelle)${L}`,
    `${NL}(?:rezervasyon|giris\\s+tarih|cikis\\s+tarih)${L}${gap(2)}(?:degistir|ertele|kaydir|one\\s+cek|one\\s+al)${L}`,
    `${NL}(?:bir|1|iki|2)\\s+gun\\s+(?:erken|once|sonra|gec)\\s+(?:gel|gir|cik|ayril|var)${L}`,
    `${NL}(?:change|move|shift|modify|reschedule|push\\s+back|bring\\s+forward)${gap(1)}(?:dates?|booking|reservation|arrival|departure|stay|${CI}\\s+date|${CO}\\s+date)${NR}`,
    `${NL}(?:arrive|come|check\\s+in)\\s+(?:a|one|1|two|2)\\s+days?\\s+(?:early|earlier|before|sooner)${NR}`,
    `${NL}(?:leave|depart|check\\s+out)\\s+(?:a|one|1|two|2)\\s+days?\\s+(?:later|after)${NR}`,
    `${NL}different\\s+dates${NR}`,
  ]),
  // Genel "şu tarih boş mu" soruları YALNIZ mesajda bir TARİH sözcüğü de varsa (↓`DATE_WORD`):
  // "Otopark müsait mi?" / "Is the pool available?" müsaitlik isteği DEĞİLDİR.
  availability: rx([
    `${NL}(?:musait|bos|uygun|mevcut)${L}\\s+(?:mi|mu|misiniz|musunuz|miyiz|midir|mudur)${NR}`,
    `${NL}musaitli[kg]${L}`,
    `${NL}(?:yer|yeriniz|oda|odaniz|daire|daireniz)\\s+(?:var|kaldi|bulunur|mevcut)\\s*(?:mi|mu)${NR}`,
    `${NL}(?:rezervasyon\\s+yap|rezerve\\s+et|kirala|tutabilir|ayirt)${L}`,
    `${NL}(?:is|are)\\s+(?:the\\s+|your\\s+|this\\s+|that\\s+)?(?:apartment|flat|place|property|house|room|unit|it|you)\\s+(?:still\\s+)?(?:available|free|open|vacant|booked)${NR}`,
    `${NL}(?:availability|vacancy|vacancies)${NR}`,
    `${NL}(?:available|free|open|vacant)\\s+(?:on|for|from|between|next|this|that|in|during|over)${NR}`,
    `${NL}(?:book|reserve|rent)${gap(2)}(?:again|for|from|on|next|this|that|nights?)${NR}`,
    `${NL}(?:frei|verf(?:ü|u)gbar)${NR}`,
    `${NL}(?:disponib${L}|libre)${NR}`,
    `свобод${L}`,
    `(?:متاح|متاحة|متوفر|متوفرة|شاغر|شاغرة)`,
  ]),
};

/**
 * ÜÇÜNCÜ TARAF YAPILARI (ikinci inceleme 09-24; son denetimde DARALTILDI). "Is the supermarket open on Sunday?",
 * "Yarın için taksi ayırtabilir miyiz?", "Can I book a taxi for tomorrow morning?" konaklama değişikliği DEĞİLDİR
 * ama tarih sözcüğüyle genel kalıba düşüyordu. İlk sürüm nesne sözcüğü mesajın HERHANGİ bir yerinde geçince
 * genel kalıbı susturuyordu ve GERÇEK istekleri düşürüyordu (son denetim, ölçüldü): "Do you have availability on
 * Oct 14? We love the BEACH." · "We will come by CAR, is it free on 14-16 Oct?" · "Hafta sonu müsait mi?
 * OTOPARK var mı?" · "Taksit" (taksi-t) · "aracılığıyla" (araç-ılığıyla) · "Masal" (masa-l).
 * Şimdi YALNIZ nesnenin müsaitlik fiiline/yüklemine BİTİŞİK olduğu yapı silinir ("book a taxi", "is the
 * supermarket open", "taksi ayırt-", "otopark müsait mi", "restoranda yer var mı") ve genel kalıp KALAN metinde
 * yeniden aranır: kalan metinde isabet varsa istek YİNE istektir. Hiçbir şey silinmediyse sonuç eskisiyle birebir.
 * 🚨 Silme İZİN yönlüdür (isteği düşürür) → tek kanonik biçimde (`permissiveForm`) yapılır; gizlenmiş bir yapı
 * tanınmazsa istek kalır (güvenli yön). YALNIZ genel `availability` türüne uygulanır.
 * ⚠️ Kapalı sınıf, genişletme listesi DEĞİL: yanlış alarmı kapatmak için buraya kelime eklenmez — anlam katmanı
 * açıldığında karar onundur. Bilinen sınır (güvenli yön): nesnesi önceki yan cümlede kalan fiil ("araba
 * kiralamak istiyoruz, nereden kiralayabiliriz?") istek sayılır.
 */
const OBJ_EN =
  "(?:taxis?|cabs?|ubers?|cars?|rental\\s+cars?|bikes?|bicycles?|scooters?|restaurants?|tables?|supermarkets?|markets?|shops?|stores?|pharmac(?:y|ies)|museums?|tours?|tickets?|transfers?|shuttles?|boats?|parking(?:\\s+(?:spots?|spaces?|lots?|places?))?|car\\s+parks?|garages?|pools?|swimming\\s+pools?|gym|spa|sauna|beach|bars?|bakery|dinner|lunch|breakfast|caf(?:é|e)s?|laundry)";
/** Türkçe nesneler (ASCII katlanmış) + kapalı hâl/çoğul/iyelik ekleri; "taksit", "masal", "aracılığıyla" DIŞARIDA. */
const OBJ_TR =
  "(?:taksi|araba|arac|bisiklet|scooter|restoran|lokanta|masa|market|supermarket|dukkan|magaza|eczane|muze|bilet|transfer|tekne|otopark|park\\s+yeri|garaj|havuz|plaj|firin|kafe|kahvalti)(?:[yns]?[iu]|y?[ae]|n[iu]n|[dt][ae]n?|l[ae]r\\p{L}{0,4}|m[iu]z\\p{L}{0,3}|n[iu]z\\p{L}{0,3}|y?l[ae])?";
const THIRD_PARTY_CONSTRUCTIONS = new RegExp(
  [
    // EN: fiil + nesne ("book a taxi", "rent bikes", "book us a table")
    `${NL}(?:book|reserve|rent|hire|order|call|get|arrange|find)(?:ing)?\\s+(?:(?:us|me|you|them|him|her)\\s+)?(?:(?:a|an|the|some|two|2|three|3|a\\s+couple\\s+of)\\s+)?${OBJ_EN}${NR}`,
    // EN: yüklem öznesi nesne ("is the supermarket open", "are there any restaurants open", "is parking free")
    `${NL}(?:is|are|was|were|will|would)\\s+(?:there\\s+)?(?:(?:the|a|an|any|your|this|that|some)\\s+)?(?:nearby\\s+|local\\s+)?${OBJ_EN}\\s+(?:still\\s+|also\\s+|usually\\s+)?(?:be\\s+)?(?:open|available|free|closed|busy|vacant)${NR}`,
    `${NL}${OBJ_EN}\\s+(?:is|are)\\s+(?:still\\s+|also\\s+|usually\\s+)?(?:open|available|free|closed)${NR}`,
    `${NL}(?:availability|vacancy|vacancies)\\s+(?:for|at|of|on)\\s+(?:(?:the|a|an|any)\\s+)?${OBJ_EN}${NR}`,
    `${NL}${OBJ_EN}\\s+(?:availability|reservations?|bookings?|rentals?)${NR}`,
    // TR (katlanmış): nesne + ayırtma/kiralama fiili ya da müsaitlik yüklemi; "restoranda yer var mı"
    `${NL}${OBJ_TR}\\s+(?:(?:icin|de|da|bir|iki|2)\\s+)?(?:rezervasyon\\p{L}*\\s+(?:yap|olustur|ayarla)\\p{L}*|rezerve\\s+et\\p{L}*|kirala\\p{L}*|ayirt\\p{L}*|tut(?:abil|mak|alim|sak|ar\\s+m)\\p{L}*)`,
    `${NL}${OBJ_TR}\\s+(?:(?:hala|yarin|bugun|aksam|sabah)\\s+)?(?:musait|bos|uygun|mevcut|acik|kapali)\\p{L}*\\s+(?:mi|mu|misiniz|midir|mudur)${NR}`,
    `${NL}${OBJ_TR}\\s+yer\\s+(?:var|kaldi|bulunur|mevcut)`,
    // DE / FR / ES: nesne + en fazla üç sözcük + serbest/müsait (RU/AR yapısı YOK → istek kalır, güvenli yön)
    `${NL}(?:taxi|auto|fahrrad|fahrr(?:ä|a)der|restaurant|tisch|supermarkt|laden|apotheke|museum|parkplatz|garage|pool|schwimmbad|strand)(?:\\s+\\S+){0,3}\\s+(?:frei|verf(?:ü|u)gbar)${NR}`,
    `${NL}(?:voiture|v(?:é|e)lo|restaurant|table|supermarch(?:é|e)|magasin|pharmacie|mus(?:é|e)e|parking|piscine|plage)s?(?:\\s+\\S+){0,3}\\s+(?:disponib\\p{L}*|libres?)${NR}`,
    `${NL}(?:coche|bici|bicicleta|restaurante|mesa|supermercado|tienda|farmacia|museo|aparcamiento|parking|piscina|playa)s?(?:\\s+\\S+){0,3}\\s+(?:disponib\\p{L}*|libres?)${NR}`,
  ].join("|"),
  "giu",
);

/** Tarih sözcüğü (genel müsaitlik sorusunun şartı). */
const DATE_WORD = new RegExp(
  [
    `${NL}(?:gece|tarih|hafta\\s*sonu|haftasonu|hafta|bayram|yilbasi|yarin|bugun|ertesi|${TR_MONTHS}|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)${L}`,
    `${NL}(?:night|nights|tonight|date|dates|weekend|week|month|tomorrow|today|january|february|march|april|june|july|august|september|october|november|december|jan|feb|apr|jun|jul|aug|sep|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|christmas|easter)${NR}`,
    `${NL}(?:nacht|n(?:ä|a)chte|datum|termin|wochenende|woche|januar|februar|m(?:ä|a)rz|mai|juni|juli|oktober|dezember|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)${NR}`,
    `${NL}(?:nuit|nuits|semaine|week-?end|demain|janvier|f(?:é|e)vrier|mars|avril|juin|juillet|ao(?:û|u)t|septembre|octobre|novembre|d(?:é|e)cembre|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)${NR}`,
    `${NL}(?:noche|noches|fecha|fechas|fin\\s+de\\s+semana|semana|ma(?:ñ|n)ana|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo)${NR}`,
    `(?:ноч|дат|выходн|недел|завтра|январ|феврал|март|апрел|июн|июл|август|сентябр|октябр|ноябр|декабр)`,
    `(?:ليلة|ليالي|تاريخ|عطلة|أسبوع|اسبوع|غدا|غداً)`,
    `\\d{1,2}\\s*[./-]\\s*\\d{1,2}`,
    `\\d{1,2}(?:st|nd|rd|th)${NR}`,
  ].join("|"),
  "iu",
);

// ─── İDDİA (cevap) ───────────────────────────────────────────────────────────

// Doğruluk düzeltmesi (inceleme 09-24, kapsam genişletme DEĞİL): "park yeri boş" ve olanak "kapalı"
// (havuz/ısıtma) takvim durumu değildir — rutin bilgi cevapları tutuluyordu.
const SUBJ_TR = `(?:gece|geceler|tarih|tarihler|gun|gunler|hafta\\s*sonu|haftasonu|hafta|donem|takvim|daire|ev|oda|mulk|(?<!park\\s)yer|konut|apart|\\d{1,2}\\s*(?:${TR_MONTHS}))${L}`;
const STATE_TR = `(?:musait|musaitiz|musaittir|bos|bostur|bosuz|bostu|dolu|doluyuz|doludur|doluydu|rezerve|kapaliyiz|uygundur|uygunuz|kiralik|tutulmus|ayrilmis)${NR}${NOT_QUESTIONED_TR}`;
const SUBJ_EN = `(?:night|nights|date|dates|weekend|week|days?|period|calendar|apartment|flat|place|property|unit|house|room|home|studio|villa|\\d{1,2}(?:st|nd|rd|th))`;
const STATE_EN = `(?:available|free|open|vacant|unbooked|booked|fully\\s+booked|taken|reserved|unavailable|blocked|occupied|sold\\s+out)`;

const CALENDAR_CLAIMS = rx([
  // TR
  `${NL}${SUBJ_TR}${gap(4)}${STATE_TR}`,
  `${NL}(?:musait|bos|dolu|rezerve)\\s+(?:${T}\\s+)?(?:gece|geceler|tarih|tarihler|gun|gunler|hafta|donem)${L}`,
  `${NL}musaitli[kg]${L}${gap(1)}(?:var|mevcut|bulunuyor|bulunmaktadir|goruluyor|gorunuyor|gozukuyor|yok|bulunmuyor|kalmadi|kalmamis)${NR}`,
  `${NL}(?:doluyuz|musaitiz|bosuz)${NR}`,
  `${NL}(?:(?:bir\\s+)?sonraki|baska|ardinizdan|arkanizdan|sizden\\s+(?:once|sonra)(?:ki)?|sonra\\s+gelecek|sonrasinda|oncesinde|takip\\s+eden)${gap(1)}(?:misafir|rezervasyon|konuk|kiraci|giris)${L}${gap(2)}(?:yok|var|bulunmuyor|bulunuyor|gelmiyor|geliyor|gorunmuyor|gozukmuyor|gorunuyor|mevcut|olmadig|oldug)${L}`,
  `${NL}takvim${L}${gap(3)}(?:acik|bos|musait|kapali|dolu|bloke)${L}`,
  // EN
  `${NOT_EMBEDDED_EN}${NL}${SUBJ_EN}${gap(5)}(?:is|are|looks|seems|appears|shows|remains|stays)\\s+(?:still\\s+|currently\\s+|completely\\s+|fully\\s+|also\\s+|now\\s+)?${STATE_EN}${NR}${CLOCK_AHEAD}`,
  `${NOT_EMBEDDED_EN}${NL}${SUBJ_EN}${AP}s\\s+(?:still\\s+|currently\\s+)?${STATE_EN}${NR}${CLOCK_AHEAD}`,
  `${NOT_EMBEDDED_EN}${NL}${STATE_EN}\\s+(?:on|for|that|this|those|these|next|from|between|during|over)\\s+(?:the\\s+)?(?:night|nights|date|dates|weekend|week|\\d{1,2}(?:st|nd|rd|th)?${NR}(?!\\s*(?:am|pm|a\\.m|p\\.m|:|\\.\\d|h${NR}|hours?|hrs?|minutes?|mins?|people|guests|persons|adults)))`,
  `${NOT_EMBEDDED_EN}${NL}fully\\s+booked${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:no|any|some|limited)\\s+(?:availability|vacancy|vacancies)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:we|i)(?:\\s+(?:do\\s+)?(?:have|got)|${VE}\\s+got)\\s+(?:no\\s+|some\\s+|limited\\s+)?(?:availability|vacancy|vacancies|openings?)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}we(?:${RE}|\\s+are)\\s+(?:fully\\s+|completely\\s+|all\\s+)?(?:booked|sold\\s+out)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}we(?:${RE}|\\s+are)\\s+(?:still\\s+)?(?:available|free|open)\\s+(?:on|for|that|this|those|next|from)\\s+(?:the\\s+)?(?:night|nights|date|dates|weekend|week|\\d)`,
  // Kısaltmalar (son denetim 09-24, DOĞRULUK): "there're" / "we've" açık biçimleri ("there are" / "we have")
  // zaten kapsıyordu; kısaltılmış biçim kaçıyordu.
  `${NOT_EMBEDDED_EN}${NL}(?:there\\s+is|there${S_IS}|there\\s+are|there${RE}|we\\s+have|we${VE})\\s+(?:no|another|a|one)\\s+(?:other\\s+|new\\s+|next\\s+)?(?:guest|guests|booking|bookings|reservation|reservations|${CI}s?|arrivals?)${gap(3)}(?:after|before|following|coming|arriving)${NR}`,
  // "Nobody's checking in" = "nobody is checking in" (kısaltma).
  `${NOT_EMBEDDED_EN}${NL}(?:nobody|no\\s+one|no\\s+other\\s+guests?|no\\s+guests?|another\\s+guest|the\\s+next\\s+guests?|next\\s+guests?)(?:\\s+(?:is\\s+|are\\s+|will\\s+be\\s+)?|${AP}s\\s+|${RE}\\s+)(?:checking\\s+in|arriving|coming|booked|staying|scheduled)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:next|following)\\s+(?:guest|guests|booking|reservation|${CI}|arrival)\\s+(?:is|isn(?:${AP}\\s*|\\s+)t|is\\s+not|arrives?|comes?|checks?\\s+in|starts?)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:calendar|schedule)${gap(1)}(?:is|looks|shows|seems)\\s+(?:open|free|clear|empty|blocked|full|available)${NR}`,
  // DE / FR / ES / RU / AR (temel; erteleme şartı ↓ ikinci bacakta)
  `${NL}(?:nacht|n(?:ä|a)chte|datum|termin|wochenende|wohnung|apartment|zimmer|unterkunft)${gap(3)}(?:ist|sind|w(?:ä|a)re)(?:\\s+(?!uhr${NR})\\S+){0,4}\\s+(?:frei|verf(?:ü|u)gbar|ausgebucht|belegt|besetzt|reserviert)${NR}`,
  `${NL}(?:nuit|nuits|date|dates|week-?end|appartement|logement|chambre)${gap(4)}(?:est|sont)\\s+(?:encore\\s+|toujours\\s+|malheureusement\\s+)?(?:libres?|disponibles?|compl(?:è|e)te?s?|r(?:é|e)serv(?:é|e)e?s?|occup(?:é|e)e?s?)${NR}`,
  `${NL}(?:noche|noches|fecha|fechas|fin\\s+de\\s+semana|apartamento|piso|alojamiento|habitaci(?:ó|o)n)${gap(4)}(?:est(?:á|a)n?|queda[n]?)\\s+(?:todav(?:í|i)a\\s+|a(?:ú|u)n\\s+)?(?:libres?|disponibles?|ocupad[oa]s?|reservad[oa]s?|complet[oa]s?)${NR}`,
  `(?:ночь|ночи|даты|дата|выходные|квартира|апартаменты|номер)${gap(4)}(?:свободн${L}|занят${L}|забронирован${L})`,
  `(?:الليلة|الليالي|التاريخ|التواريخ|الشقة|عطلة\\s+نهاية\\s+الأسبوع)${gap(4)}(?:متاحة|متاح|متوفرة|شاغرة|محجوزة|محجوز|مشغولة)`,
]);

const GRANT_CLAIMS = rx([
  // TR
  `${NL}(?:erken|gec)\\s+(?:giris|cikis|${CI}|${CO}|varis|ayrilis)${L}${gap(4)}(?:yapabilirsiniz|yapabilirsin|mumkun|mumkundur|olabilir|olur|uygundur|sorun\\s+olmaz|sorun\\s+(?:degil|yok)|sorun\\s+teskil\\s+etmez|ayarlayabiliriz|ayarladik|ayarlandi|saglayabiliriz|sagladik|verebiliriz|onaylandi|onaylanmistir|onayliyoruz|onayladik|gerceklestirebilirsiniz)${NR}(?!\\s+(?:degil|olup|olmay|olmadig|mi|mu)${L})`,
  `${NL}(?:bir|bi|1|iki|2|uc|3|birkac|fazladan|ekstra|ilave)\\s+(?:gece|gun)\\s+(?:daha\\s+)?(?:kalabilirsiniz|kalabilirsin|konaklayabilirsiniz|kalmanizda\\s+(?:bir\\s+)?(?:sakinca|sorun)\\s+yok|kalmaniz\\s+(?:mumkun|uygun|sorun\\s+olmaz))${NR}`,
  `${NL}(?:daha\\s+(?:fazla|uzun)|biraz\\s+daha)\\s+(?:kalabilirsiniz|konaklayabilirsiniz)${NR}`,
  `${NL}kalmaya\\s+devam\\s+edebilirsiniz${NR}`,
  `${NL}(?:konaklama|rezervasyon|kalis|tatil)${L}${gap(2)}(?:uzatabilirsiniz|uzatabiliriz|uzattik|uzatildi|uzatilmistir|uzatiyoruz|uzatmaniz\\s+(?:mumkun|uygun))${NR}`,
  `${NL}(?:uzatabiliriz|uzattik|uzatmanizda\\s+(?:bir\\s+)?(?:sorun|sakinca)\\s+yok)${NR}`,
  `\\d{1,2}(?:[:.]\\d{2})?(?:\\s*['’]?\\s*\\p{L}{1,3})?\\s+(?:kadar|dek)\\s+(?:dairede\\s+|evde\\s+|odada\\s+)?(?:kalabilirsiniz|konaklayabilirsiniz)${NR}`,
  `${NL}(?:sizi|sizleri)${gap(1)}(?:bir|1|iki|2)\\s+(?:gece|gun)\\s+daha\\s+(?:agirla|bekle|misafir\\s+et)${L}`,
  `${NL}(?:bir|1|iki|2)\\s+(?:gece|gun)\\s+daha\\s+(?:agirlamaktan|misafir\\s+etmekten|agirlariz|bekleriz)${L}`,
  `${NL}(?:erken|gec)\\s+(?:gelebilirsiniz|girebilirsiniz|cikabilirsiniz|ayrilabilirsiniz|yerlesebilirsiniz)${NR}`,
  `${NL}(?:talebiniz|isteginiz|uzatma(?:niz)?|erken\\s+girisiniz|gec\\s+cikisiniz)${gap(1)}(?:onaylandi|onaylanmistir|kabul\\s+edildi|kabul\\s+edilmistir|uygundur|mumkundur)${NR}`,
  // EN
  `${NOT_EMBEDDED_EN}${NL}(?:early\\s+${CI}|late\\s+${CO}|earlier\\s+${CI}|later\\s+${CO}|early\\s+arrival|late\\s+departure|(?:an\\s+|the\\s+)?extension|(?:an\\s+)?extra\\s+night|(?:an\\s+)?additional\\s+night|another\\s+night|one\\s+more\\s+night|(?:the\\s+)?extra\\s+nights)${gap(2)}(?:is|are|would\\s+be|will\\s+be|should\\s+be|seems|looks)\\s+(?:totally\\s+|absolutely\\s+|perfectly\\s+|definitely\\s+|probably\\s+|likely\\s+|most\\s+likely\\s+|also\\s+)?(?:possible|fine|ok|okay|no\\s+problem|available|confirmed|approved|arranged|doable|granted|free|feasible|allowed|great|guaranteed)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:early\\s+${CI}|late\\s+${CO}|(?:an\\s+)?extra\\s+night|one\\s+more\\s+night)${AP}s\\s+(?:totally\\s+|absolutely\\s+)?(?:possible|fine|ok|okay|no\\s+problem|available|confirmed)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}you(?:\\s+(?:can|may|could|are\\s+(?:welcome|free|able)\\s+to|will\\s+be\\s+able\\s+to)|${RE}\\s+(?:welcome|free|able)\\s+to|${LL}\\s+be\\s+able\\s+to)\\s+(?:definitely\\s+|certainly\\s+|of\\s+course\\s+)?(?:stay\\s+(?:an?\\s+|one\\s+|another\\s+|two\\s+|a\\s+few\\s+|the\\s+)?(?:extra|more|additional|longer|another|until|till|through|over|one|two|night)|extend|check\\s+in\\s+(?:early|earlier|before)|check\\s+out\\s+(?:late|later|after)|arrive\\s+(?:early|earlier)|leave\\s+(?:later|late)|keep\\s+the\\s+(?:apartment|room|place|flat|unit|keys?)\\s+(?:until|till|longer))${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:happy|glad|pleased|delighted|able)\\s+to\\s+(?:extend|offer\\s+(?:you\\s+)?(?:an?\\s+)?(?:early|late|extra|additional)|accommodate\\s+(?:your|an?|the)\\s+(?:early|late|extra|extension)|host\\s+you\\s+(?:for\\s+)?(?:another|an?\\s+extra|one\\s+more)|have\\s+you\\s+(?:stay\\s+)?(?:for\\s+)?(?:another|an?\\s+extra|one\\s+more|longer))${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:we|i)(?:\\s+(?:can|could|will|would\\s+be\\s+able\\s+to|are\\s+able\\s+to)|${LL})\\s+(?:extend|arrange\\s+(?:an?\\s+)?(?:early|late)|offer\\s+(?:you\\s+)?(?:an?\\s+)?(?:early|late|extra)|add\\s+(?:an?|another|one\\s+more|the)\\s+(?:extra\\s+)?night|accommodate\\s+(?:your|an?|the)\\s+(?:early|late|extra|extension))${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:we${VE}|we\\s+have|i${VE}|i\\s+have)\\s+(?:extended|added|arranged|approved|confirmed|booked|blocked)\\s+(?:your|the|an?|another)\\s+(?:stay|booking|reservation|night|extra|early|late|extension|dates?)${NR}`,
  `${NOT_EMBEDDED_EN}${NL}(?:your|the)\\s+(?:extension|early\\s+${CI}|late\\s+${CO}|request)\\s+(?:is|has\\s+been)\\s+(?:approved|confirmed|accepted|granted)${NR}`,
  // DE / FR / ES / RU / AR
  `${NL}(?:sie|ihr)\\s+(?:k(?:ö|o)nnen|k(?:ö|o)nnt|d(?:ü|u)rfen)\\s+(?:gerne\\s+)?(?:noch\\s+)?(?:eine\\s+nacht\\s+)?(?:l(?:ä|a)nger|fr(?:ü|u)her|sp(?:ä|a)ter)\\s+(?:bleiben|einchecken|auschecken|anreisen|abreisen|kommen)${NR}`,
  `${NL}(?:fr(?:ü|u)he[rs]?|sp(?:ä|a)te[rs]?)\\s+(?:${CI}|${CO}|anreise|abreise)${gap(1)}(?:ist|w(?:ä|a)re|ist\\s+gerne)\\s+(?:kein\\s+problem|m(?:ö|o)glich|in\\s+ordnung|ok)${NR}`,
  `${NL}vous\\s+pouvez\\s+(?:rester|prolonger|arriver\\s+plus\\s+t(?:ô|o)t|partir\\s+plus\\s+tard|faire\\s+(?:le\\s+)?(?:${CI}|${CO})\\s+(?:plus\\s+t(?:ô|o)t|plus\\s+tard))`,
  `${NL}(?:${CI}\\s+anticip(?:é|e)|d(?:é|e)part\\s+tardif|arriv(?:é|e)e\\s+anticip(?:é|e)e|nuit\\s+suppl(?:é|e)mentaire)${gap(1)}(?:est|sera)\\s+(?:possible|accept(?:é|e)e?|confirm(?:é|e)e?|ok)${NR}`,
  `${NL}(?:puede|pueden|pod(?:é|e)is)\\s+(?:quedarse|quedaros|quedarte|extender|prolongar|llegar\\s+(?:antes|temprano)|salir\\s+(?:m(?:á|a)s\\s+)?tarde)`,
  `${NL}(?:${CI}\\s+(?:anticipado|temprano)|salida\\s+tard(?:í|i)a|${CO}\\s+tard(?:í|i)o|noche\\s+(?:extra|adicional))${gap(1)}(?:es|ser(?:á|a)|est(?:á|a))\\s+(?:posible|confirmad[oa]|aprobad[oa]|bien)${NR}`,
  `(?:можете|можно)\\s+(?:остаться|продлить|заселиться\\s+(?:раньше|пораньше)|выехать\\s+(?:позже|попозже)|приехать\\s+(?:раньше|пораньше))`,
  `(?:ранний\\s+заезд|поздний\\s+выезд|продление)${gap(1)}(?:возможен|возможно|подтвержд${L}|одобрен${L})`,
  `(?:يمكنكم|يمكنك|بإمكانكم|بإمكانك)\\s+(?:البقاء|تمديد|الوصول\\s+مبكرا|المغادرة\\s+متأخرا|تسجيل\\s+(?:ال)?(?:دخول|خروج))`,
  `(?:تسجيل\\s+(?:ال)?دخول\\s+مبكر|تسجيل\\s+(?:ال)?خروج\\s+متأخر|التمديد)${gap(1)}(?:ممكن|متاح|مؤكد)`,
]);

// ─── ERTELEME (cevap) ────────────────────────────────────────────────────────
// 🚨 "Mesajınız kaydedildi" / "your request has been recorded" ERTELEME DEĞİLDİR (inceleme 09-24):
// kaydın varlığı kararın kime ait olduğunu söylemez. "Of course, we'd love to have you another night.
// Your request has been recorded." örtük izin + kayıt cümlesiydi ve yalnız "recorded" yüzünden
// gidiyordu. Erteleme = kararı AÇIKÇA ev sahibine / platforma bırakan cümle.

const DEFERRALS = rx([
  // TR — istemin kendi standart cümlesi ve türevleri
  // 🚨 YALNIZ KARARI EV SAHİBİNE BIRAKAN biçimler (inceleme 09-24): "ev sahibiniz onaylayacaktır" bir
  // ONAY TAHMİNİDİR (yarı-söz), erteleme DEĞİL; "onay" yalnız bağımlılık/gereklilik biçiminde sayılır.
  `${NL}ev\\s+sahib${L}(?:\\s+${T}){0,3}\\s+(?:karar${L}|degerlendir${L}|takdir${L}|kontrol${L}|belirle${L}|bildir${L}|bilgi\\s+ver${L}|haber\\s+ver${L})`,
  // Ters dizilim: "karar ev sahibinizindir", "kararı ev sahibiniz verir".
  `${NL}karar${L}\\s+ev\\s+sahib${L}`,
  // "teyit" ünlüyle başlayan ekte YUMUŞAR ("teyidine") — doğruluk düzeltmesi (ikinci inceleme 09-24).
  `${NL}ev\\s+sahib${L}(?:\\s+${T}){0,3}\\s+(?:onay|teyi[td])(?:ina|ine|i|ı)?\\s+(?:bagli${L}|tabi${L}|gerek${L})`,
  `${NL}ev\\s+sahib${L}(?:\\s+${T}){0,3}\\s+teyit\\s+(?:edebilir|edecek|etmesi\\s+gerek|etmeli)${L}`,
  `${NL}(?:musaitli[kg]|uygunlu[kg]|takvim)${L}(?:\\s+${T}){0,4}\\s+(?:bagli${L}|bagl${L}|karar${L})`,
  `${NL}(?:onay|teyi[td])${L}(?:\\s+${T})?\\s+(?:bagli${L}|gerek${L}|sonra${L})`,
  `${NL}(?:platform|airbnb|booking|uygulama)${L}(?:\\s+${T}){0,3}\\s+(?:degisiklik|uzatma|talep)${L}`,
  // EN
  `${NL}(?:host|owner|property\\s+manager)(?:'s|’s)?\\s+(?:call|decision|discretion)${NR}`,
  `${NL}(?:up\\s+to|at\\s+the\\s+discretion\\s+of|decided\\s+by|for)\\s+(?:your|the)\\s+host(?:\\s+to\\s+(?:decide|confirm))?${NR}`,
  // Ev sahibi KARAR VEREN/KONTROL EDEN özne: "your host will check / decides / will let you know".
  `${NL}(?:your|the)\\s+host\\s+(?:will\\s+|'ll\\s+|can\\s+|should\\s+)?(?:check|review|confirm|decide|decides|confirms|verify|let\\s+you\\s+know)${NR}`,
  `${NL}who\\s+decides${NR}`,
  `${NL}(?:needs?|requires?)\\s+(?:your|the)\\s+host['’]?s\\s+approval${NR}`,
  // "approved/confirmed by your host" yalnız BEKLEYEN biçimde: "has been approved by your host" bir İDDİADIR.
  `${NL}(?:to\\s+be|must\\s+be|needs?\\s+to\\s+be|has\\s+to\\s+be|would\\s+need\\s+to\\s+be)\\s+(?:confirmed|approved)\\s+by\\s+(?:your|the)\\s+host${NR}`,
  `${NL}(?:subject\\s+to|depends\\s+on|depending\\s+on|dependent\\s+on|pending)\\s+(?:availability|approval|host|the\\s+host|your\\s+host|confirmation|the\\s+cleaning|cleaning)${NR}`,
  `${NL}(?:host|owner)\\s+(?:will\\s+need\\s+to|needs\\s+to|has\\s+to|must|would\\s+need\\s+to|will\\s+have\\s+to)\\s+(?:confirm|approve|check|decide)${NR}`,
  `${NL}(?:send|submit|make|request)\\s+(?:a|an)\\s+(?:change|alteration|modification|extension)\\s+request${NR}`,
  // DE / FR / ES / RU / AR
  `${NL}entscheidung\\s+(?:des|ihres|deines|vom)\\s+(?:gastgeber|vermieter)${L}`,
  `${NL}(?:liegt|obliegt)\\s+(?:beim|bei\\s+ihrem|bei\\s+deinem)\\s+(?:gastgeber|vermieter)${L}`,
  `${NL}(?:gastgeber|vermieter)${L}\\s+(?:muss|wird|m(?:ü|u)sste)(?:\\s+${T})?\\s+(?:best(?:ä|a)tigen|entscheiden|pr(?:ü|u)fen)${NR}`,
  `${NL}(?:entscheidet|best(?:ä|a)tigt|pr(?:ü|u)ft)\\s+(?:ihr|der|dein|euer)\\s+(?:gastgeber|vermieter)${L}`,
  `${NL}(?:vorbehaltlich|je\\s+nach\\s+verf(?:ü|u)gbarkeit)${NR}`,
  `${NL}d(?:é|e)cision\\s+de\\s+(?:l['’]h(?:ô|o)te|votre\\s+h(?:ô|o)te)`,
  `${NL}(?:revient|appartient)\\s+(?:à|a)\\s+(?:l['’]h(?:ô|o)te|votre\\s+h(?:ô|o)te)`,
  `${NL}(?:sous\\s+r(?:é|e)serve|selon\\s+(?:les\\s+)?disponibilit)`,
  `${NL}(?:votre|l['’])\\s*h(?:ô|o)te\\s+qui\\s+d(?:é|e)cide`,
  `${NL}(?:à|a)\\s+la\\s+discr(?:é|e)tion\\s+de\\s+(?:votre|l['’])\\s*h(?:ô|o)te`,
  `${NL}(?:à|a)\\s+confirmer\\s+par\\s+(?:votre|l['’])\\s*h(?:ô|o)te`,
  `${NL}decisi(?:ó|o)n\\s+(?:del|de\\s+su)\\s+anfitri(?:ó|o)n${NR}`,
  `${NL}(?:la\\s+|lo\\s+)?(?:confirma|decide|confirmar(?:á|a))\\s+su\\s+anfitri(?:ó|o)n${NR}`,
  `${NL}depende\\s+del\\s+anfitri(?:ó|o)n${NR}`,
  `${NL}(?:sujeto\\s+a|seg(?:ú|u)n)\\s+(?:la\\s+)?disponibilidad${NR}`,
  `решени${L}\\s+(?:хозя|владель|арендодател)`,
  `на\\s+усмотрени${L}\\s+(?:хозя|владель|арендодател)`,
  `(?:хозя|владел|арендодател)${L}\\s+(?:долж|подтверд|решит|решает)`,
  `(?:решает|решит|подтвердит|подтверждает)\\s+(?:ваш\\s+)?(?:хозя|владел|арендодател)`,
  `решение\\s+принимает\\s+(?:хозя|владел|арендодател)`,
  `(?:قرار\\s+المضيف|القرار\\s+(?:لل|ل)مضيف|يعود\\s+(?:لقرار|إلى)\\s+المضيف|حسب\\s+(?:التوفر|توفر)|(?:موافقة|تأكيد)\\s+المضيف)`,
]);

// ─── çekirdek ────────────────────────────────────────────────────────────────

/** Cümleciklere böl: nokta (rakam arası değil), ünlem, soru, noktalı virgül, satır. */
function clausesOf(form: string): string[] {
  return form.split(/(?:(?<!\d)\.(?!\d)|[!?;\n…؟]|。)+/u).map((c) => c.trim()).filter(Boolean);
}

function anyClauseMatches(text: string, patterns: readonly RegExp[]): boolean {
  for (const form of restrictiveMatchForms(text)) {
    for (const clause of clausesOf(form)) {
      for (const re of patterns) if (re.test(clause)) return true;
    }
  }
  return false;
}

function anyFormMatches(text: string, patterns: readonly RegExp[]): boolean {
  for (const form of restrictiveMatchForms(text)) {
    for (const re of patterns) if (re.test(form)) return true;
  }
  return false;
}

/**
 * 🚨 İZİN YÖNLÜ tespit için TEK biçim: küçük harf + Türkçe ASCII katlama + boşluk. Erteleme bulunması
 * gönderime İZİN verir; `restrictiveMatchForms`un ek adayları (homoglif sökme, görünmez karakter silme,
 * kesme bölme) izin yüzeyini GENİŞLETİRDİ — CLAUDE.md katlama kuralı: genişletici katlama yalnız
 * KISITLAYICI dedektörlerde. Gizlenmiş bir erteleme ifadesi tanınmazsa sonuç taslaktır (güvenli yön).
 */
function permissiveForm(text: string): string {
  return foldTurkishAscii(text.replace(/\s+/g, " "));
}

/**
 * Tür önceliği: ÖZGÜL olan önce. "Çıkışı saat 2'ye uzatabilir miyiz" hem çıplak "uzat" (extend) hem
 * "çıkış … uzat" (late) kalıbına uyar; doğru tür geç çıkıştır. Tür bilgi amaçlıdır — veto yalnız
 * "istek var mı"ya bakar (`vetoAvailability`).
 */
const REQUEST_KIND_ORDER = ["date_change", "late", "early", "extend"] as const;

/**
 * Misafir mesajı müsaitliğe BAĞLI bir istek mi? Türü ya da `null`. Kısıtlayıcı: yalnız gönderimi
 * ERTELEME ŞARTINA bağlar, hiçbir cevabı yetkilendirmez.
 */
export function detectAvailabilityRequest(message: string | null | undefined): AvailabilityRequestKind | null {
  if (typeof message !== "string" || message.trim() === "") return null;
  for (const kind of REQUEST_KIND_ORDER) {
    if (anyClauseMatches(message, REQUEST_PATTERNS[kind])) return kind;
  }
  if (
    anyClauseMatches(message, REQUEST_PATTERNS.availability) &&
    anyFormMatches(message, [DATE_WORD]) &&
    !onlyThirdPartyAvailability(message)
  ) {
    return "availability";
  }
  return null;
}

/**
 * Genel müsaitlik isabetlerinin HEPSİ üçüncü taraf yapılardan mı geliyor? Yapılar tek kanonik biçimde silinir,
 * genel kalıp KALAN metinde yeniden aranır; hiçbir şey silinmediyse `false` (eski davranış birebir).
 */
function onlyThirdPartyAvailability(message: string): boolean {
  const form = permissiveForm(message);
  const residual = form.replace(THIRD_PARTY_CONSTRUCTIONS, " ");
  if (residual === form) return false;
  return !anyClauseMatches(residual, REQUEST_PATTERNS.availability);
}

/** Cevap takvim durumu söylüyor ya da konaklama değişikliğine izin veriyor mu? */
export function detectAvailabilityClaim(reply: string | null | undefined): "calendar" | "grant" | null {
  if (typeof reply !== "string" || reply.trim() === "") return null;
  if (anyClauseMatches(reply, CALENDAR_CLAIMS)) return "calendar";
  if (anyClauseMatches(reply, GRANT_CLAIMS)) return "grant";
  return null;
}

/** Cevap müsaitlik kararını açıkça ev sahibine / platforma bırakıyor mu? */
export function hasAvailabilityDeferral(reply: string | null | undefined): boolean {
  if (typeof reply !== "string" || reply.trim() === "") return false;
  const form = permissiveForm(reply);
  return DEFERRALS.some((re) => re.test(form));
}

// ─── POLİTİKA: dört katmanın birleşimi (yalnız SIKILAŞTIRIR) ──────────────────

export interface AvailabilityPolicyOptions {
  // (09-24: `handoff` muafiyeti KALDIRILDI — devir cevabı "Tabii. Mesajınız kaydedildi…" bir konaklama isteğine EVET
  // gibi okunur; devir de iki model ertelemesi ister. Konaklama konusu olmayan saf devir zaten hassas değildir.)
  /** Cevap modelinin şema beyanı (`SuggestReplyResult.stayChange`); yok = modelin konaklama görüşü YOK (F01). */
  declared?: StayChangeDeclaration | null;
  /**
   * Cevap modelinin KENDİ niyet etiketi (`SuggestReplyResult.intent`). `early_checkin` / `late_checkout` hassas
   * isteğe SAYILIR (birleşim değişmezi 09-24): bekçi ya da beyan "istek yok" dese de silinmez. İstem etiketi konu
   * SORULARINA da verdiği için bilgi sorusunu da taslağa düşürebilir — bilinçli bedel (yalnız sıkılaştırır).
   */
  replyIntent?: string | null;
  /**
   * Cevap BİZİM deterministik şablonumuz (yedek yol, `source: "fallback"`), model metni DEĞİL: "modelin duruşu
   * bilinmiyor" kuralı uygulanmaz (ortada model yok). Varsayılan `false` = model metni (fail-closed). Yedek cevap
   * zaten otomatik gönderilmez; bu bayrak host'a gösterilen taslak uyarısının DOĞRU cümleyi seçmesi içindir.
   */
  deterministicReply?: boolean;
  /** Bağımsız bekçinin sonucu; `undefined` = bekçi koşmadı (bayrak kapalı ya da aday değil). */
  guard?: StayGuardOutcome;
  /**
   * Anlama katmanı açıktı ama BAŞARISIZ oldu (kanıtta `u: "failed"`; kararı değiştirmez — sinyal yokmuş gibi).
   * Eskiden "kapalı" ile aynı görünüyordu (ikinci inceleme 09-24).
   */
  understandingFailed?: boolean;
  /** Anlama katmanının konaklama sinyali; `undefined`/`null` = katman kapalı ya da başarısız. */
  understanding?: UnderstandingStaySignal | null;
  /** Mülkün standart saatleri — model yuvalarındaki saat KODDA bunlarla kıyaslanır. */
  stayTimes?: StayTimes | null;
  /**
   * Ev sahibinin TANIMLI geç çıkış / uzatma teklifi (Ayarlar; istemde aynen aktarılabilir). Metnin
   * kendisi EV SAHİBİNİN sözüdür, modelin doğrulanmamış iddiası değil: cevaptaki birebir geçişi iddia
   * taramasından çıkarılır (inceleme 09-24 — "Müsaitlik varsa … 13:00'e kadar uzatabiliriz" aktarımı her
   * seferinde izin sayılıp tutuluyordu). Model teklifi DEĞİŞTİRİR ya da kendi sözünü eklerse ("uzattım")
   * tarama yine yakalar; istek varsa erteleme şartı AYNEN geçerlidir.
   */
  hostOfferText?: string | null;
  /**
   * DOĞRULANMIŞ ERKEN GİRİŞ ONAYI (09-24, `lib/early-checkin`): koddan, doğrulanmış olgulardan kurulan onay metni.
   * YALNIZ cevap bu metne BİREBİR eşitse ve tüm katmanlarda istenen TEK tür erken girişse muaftır — başka her metin
   * ve başka her tür normal kurallarla değerlendirilir (model metni hiçbir zaman bu yoldan geçemez).
   */
  verifiedGrant?: { text: string } | null;
}

/** Konaklama değişikliği TÜRLERİ — birleşim: hangi katman hangi türü gördü ("yalnız erken giriş mi?" sorusu için). */
export type StayRequestKind = "early_checkin" | "late_checkout" | "extend" | "date_change" | "availability" | "unknown";

const LEXICAL_KIND: Record<AvailabilityRequestKind, StayRequestKind> = {
  early: "early_checkin",
  late: "late_checkout",
  extend: "extend",
  date_change: "date_change",
  availability: "availability",
};

/**
 * Tüm katmanların gördüğü istek türlerinin BİRLEŞİMİ (kelime ağı · beyan · niyet etiketi · anlama katmanı · bekçi;
 * KODDA kaydırılmış saatler dahil). Tanınmayan / türü belirsiz istek `unknown` olarak girer — "yalnız erken giriş"
 * sorusuna asla evet dedirtmez.
 */
export function stayRequestKinds(
  guestTexts: readonly (string | null | undefined)[],
  opts: AvailabilityPolicyOptions,
): Set<StayRequestKind> {
  const kinds = new Set<StayRequestKind>();
  for (const t of guestTexts) {
    const k = detectAvailabilityRequest(t);
    if (k) kinds.add(LEXICAL_KIND[k]);
  }
  const d = opts.declared;
  if (d && d.asked !== "none") kinds.add(d.asked);
  const ri = stayReplyIntentOf(opts.replyIntent);
  if (ri) kinds.add(ri);
  const slots = (s: { kind: string; checkinTime: string | null; checkoutTime: string | null }, requested: boolean) => {
    if (s.kind !== "none") kinds.add(s.kind as StayRequestKind);
    else if (requested) kinds.add("unknown");
    if (slotTimesShifted({ checkinTime: s.checkinTime }, opts.stayTimes)) kinds.add("early_checkin");
    if (slotTimesShifted({ checkoutTime: s.checkoutTime }, opts.stayTimes)) kinds.add("late_checkout");
  };
  if (opts.understanding) slots(opts.understanding, opts.understanding.requested);
  if (opts.guard?.status === "ok") {
    const v = opts.guard.verdict;
    slots({ kind: v.kind, checkinTime: v.requestedCheckinTime, checkoutTime: v.requestedCheckoutTime }, v.guestRequestsChange);
  }
  return kinds;
}

/** Cevaptan ev sahibinin teklif metninin BİREBİR geçişlerini çıkarır (boşluk farkı tolere edilir). */
function withoutHostOffer(reply: string, offer: string | null | undefined): string {
  const o = typeof offer === "string" ? offer.replace(/\s+/g, " ").trim() : "";
  if (o.length < 8) return reply;
  return reply.replace(/\s+/g, " ").split(o).join(" ");
}

/**
 * "11", "11:00", "11.30", "11am", "1 pm" → gün içi dakika; geçersizse null. am/pm yoksa 1–6 arası saat öğleden
 * sonradır — dakikalı yazımda da ("until 1:00", "2:30"; kimse gece 1'de çıkmaz). 12am / 00:00 / 24:00 → 0.
 */
function untilMinutes(h: string, mm: string | undefined, ap: string | undefined): number | null {
  let hour = Number(h);
  const min = mm ? Number(mm) : 0;
  if (hour > 24 || min > 59) return null;
  const pm = ap ? /^p/i.test(ap) : hour >= 1 && hour <= 6;
  if (ap && /^a/i.test(ap) && hour === 12) hour = 0;
  if (pm && hour < 12) hour += 12;
  return (hour % 24) * 60 + min;
}

/** Cümlecik sınırları (`clausesOf` ile aynı) — ayraçlar korunarak bölmek için yakalayan grup. */
const CLAUSE_SPLIT = /((?:(?<!\d)\.(?!\d)|[!?;\n…؟]|。)+)/u;
const EN_UNTIL = /(?<![\p{L}\p{N}])(?:until|till)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?))?(?![\p{L}\p{N}])/giu;
// Türkçe yönelme eki YALNIZ ('e/'a/'ye/'ya): eski `\p{L}{1,3}` yuvası "8 GÜN kadar" / "Ayın 10'UNA kadar" yutuyordu.
const TR_UNTIL = /(?<![\p{L}\p{N}])(\d{1,2})(?:[:.](\d{2}))?(?:\s*['’ʼ]?\s*y?[ae])?\s+(?:kadar|dek)(?![\p{L}\p{N}])/giu;
/** Öğleden sonra / akşam / gece: rakam standart çıkışla aynı olsa da saat öğleden sonrasıdır ("11 in the evening"). */
const EVENING_CUE = new RegExp(
  [`${NL}(?:evening|night|nights|tonight|afternoon|midnight|p\\.?\\s?m\\.?)${NR}`, `${NL}(?:aksam|gece|ogleden|oglen|ogle|ikindi)${L}`].join("|"),
  "iu",
);
/** Başka bir gün / uzatma işareti: o cümlecikteki saat standart bilgi DEĞİLDİR ("until 11 the next day"). */
const STAY_SHIFT_CUE = new RegExp(
  [
    `${NL}(?:next|following|another|extra|additional|more|longer|later|late|extend\\p{L}*|extension|day|days)${NR}`,
    `${NL}(?:sonraki|ertesi|obur|daha|ekstra|fazladan|ilave|gec|uzat\\p{L}*|gun\\p{L}*)`,
  ].join("|"),
  "iu",
);
/** Standart çıkış GÜNÜNÜ adlandıran öbek ("on your departure day", "çıkış günü") gün işareti sayılmaz. */
const CHECKOUT_DAY_PHRASE = new RegExp(
  [
    `${NL}(?:(?:your|the)\\s+)?(?:departure|check[\\s-]?out|leaving|last|final)\\s+day${NR}`,
    `${NL}day\\s+of\\s+(?:your\\s+)?(?:departure|check[\\s-]?out)${NR}`,
    `${NL}day\\s+you\\s+(?:leave|depart|check\\s+out)${NR}`,
    // Katlama biçimlerinin HEPSİNDE silinebilmeli ("cıkıs gunu": noktasız ı ayrışmaz) — yoksa o biçimdeki "gun"
    // ayıklamayı engeller (engel HERHANGİ bir biçimde aranır).
    `${NL}(?:[cç][iı]k[iı][sş]|ayr[iı]l[iı][sş]|son)\\s+g[uü]n${L}`,
  ].join("|"),
  "giu",
);
/** Olumlu cevap ("Sure!", "Tabii") — standart saati söyleyen cümle bir talebe EVET olabilir: ayıklama yapılmaz. */
const AFFIRMATION_CUE = new RegExp(
  [
    `${NL}(?:yes|yeah|sure|certainly|absolutely|definitely|of\\s+course|no\\s+problem|no\\s+worries|happy\\s+to|glad\\s+to|good\\s+news|great\\s+news|we${AP}d\\s+love|we\\s+would\\s+love)${NR}`,
    `${NL}(?:evet|tabii|tabi|elbette|memnuniyetle|kesinlikle|olur|sorun\\s+(?:degil|yok|olmaz)|harika|guzel\\s+haber)${NR}`,
  ].join("|"),
  "iu",
);

function stripStandardCheckoutClause(clause: string, co: number): string {
  const replaced = clause
    .replace(EN_UNTIL, (m, h: string, mm?: string, ap?: string) => (untilMinutes(h, mm, ap) === co ? " " : m))
    .replace(TR_UNTIL, (m, h: string, mm?: string) => (untilMinutes(h, mm, undefined) === co ? " " : m));
  if (replaced === clause) return clause;
  // Kalan cümlecik günü ya da gün içi saati KAYDIRIYORSA öbek standart bilgi değildir → dokunma. İşaret araması
  // KISITLAYICI yönde (ayıklamayı engeller) → tüm katlama biçimleri.
  for (const form of restrictiveMatchForms(replaced)) {
    const rest = form.replace(CHECKOUT_DAY_PHRASE, " ");
    if (DATE_WORD.test(rest) || EVENING_CUE.test(rest) || STAY_SHIFT_CUE.test(rest)) return clause;
  }
  return replaced;
}

/**
 * STANDART ÇIKIŞ SAATİ BİLGİSİ İZİN DEĞİLDİR ("Çıkış günü 11:00'e kadar kalabilirsiniz" / "you can stay until 11:00
 * on your departure day"): saat KODDA mülkün çıkışıyla kıyaslanır. YALNIZ İZİN kalıplarına uygulanır (takvim
 * kalıplarının `CLOCK_AHEAD` bastırması saat öbeğini görmeli). Son denetim (09-24, ölçülmüş gevşeme) sonrası dar:
 *  · saat standart çıkışa BİREBİR eşit olmalı ("≤" dakikalı öğleden sonrayı, 12am/00:00'ı ve "10.10" gibi TARİHLERİ
 *    standart sanıyordu: "until 2:30", "Akşam 7'ye kadar", "until 10 October" izinleri gidiyordu);
 *  · cümlecikte tarih / gün / akşam / uzatma işareti olmamalı ("until 11:00 on Sunday", "ertesi gün 11'e kadar");
 *  · cevapta olumlu onay olmamalı ("Sure! You can stay until 11:00." bir talebe evet olabilir).
 * Mülkün çıkış saati bilinmiyorsa metin aynen döner. Kaçan ayıklama = taslak (güvenli yön).
 */
function withoutStandardCheckoutUntil(text: string, stayTimes: StayTimes | null | undefined): string {
  const co = hhmmToMinutes(normalizeHhmm(stayTimes?.checkOut));
  if (co === null) return text;
  if (anyFormMatches(text, [AFFIRMATION_CUE])) return text;
  return text
    .split(CLAUSE_SPLIT)
    .map((part, i) => (i % 2 === 1 ? part : stripStandardCheckoutClause(part, co)))
    .join("");
}

/** Deterministik iddia: takvim kalıpları METNİN KENDİSİNDE, izin kalıpları standart çıkış bilgisi ayıklanmış metinde. */
function lexicalClaim(text: string, stayTimes: StayTimes | null | undefined): boolean {
  if (anyClauseMatches(text, CALENDAR_CLAIMS)) return true;
  return anyClauseMatches(withoutStandardCheckoutUntil(text, stayTimes), GRANT_CLAIMS);
}

/** Kanıt için PII'siz sinyal özeti (kapalı küme kodlar; metin taşımaz). */
export interface AvailabilitySignals {
  /** Deterministik yedek: c = iddia/izin, r = istek, d = erteleme ("-" = hiçbiri). */
  lx: string;
  /** Beyan: "asked/stance" ya da "absent". */
  d: string;
  /** Bekçi: koşmadı / ok / başarısız. */
  g: "off" | "ok" | "failed";
  /** Bekçi hükmü: q = istek, s = takvim, a = izin, d = erteleme, x = ret, t = kaydırılmış saat. */
  gv?: string;
  /** Anlama katmanı: koşmadı / istek var / istek yok / açıktı ama başarısız. */
  u: "off" | "req" | "none" | "failed";
  /** Cevap modelinin niyet etiketi konaklama değişikliği adlandırıyorsa o etiket (yoksa alan YOK). */
  ri?: StayReplyIntent;
}

export interface AvailabilityEvaluation {
  /** Uygulanan karar. */
  reason: AvailabilityVetoReason | null;
  /**
   * 09-24'ten beri `reason`a EŞİT (birleşim değişmezi gölge kipi kaldırdı). Kanıt şeması (`sc.ev`) ve geçmiş karar
   * kayıtlarıyla kıyas bozulmasın diye alan korunur; ayrı bir karar DEĞİLDİR.
   */
  enforceReason: AvailabilityVetoReason | null;
  signals: AvailabilitySignals;
}

function guardFlags(v: StayGuardVerdict, stay: StayTimes | null | undefined): string {
  const f =
    (v.guestRequestsChange ? "q" : "") +
    (v.replyStatesCalendar ? "s" : "") +
    (v.replyGrantsChange ? "a" : "") +
    (v.replyDefersToHost ? "d" : "") +
    (v.replyRefuses ? "x" : "") +
    (slotTimesShifted({ checkinTime: v.requestedCheckinTime, checkoutTime: v.requestedCheckoutTime }, stay) ? "t" : "");
  return f || "-";
}

/**
 * Misafire GİDECEK cevabın müsaitlik denetimi — dört katman, tek karar, hepsi yalnız SIKILAŞTIRIR:
 *
 *  HASSAS İSTEK = TÜM katmanların BİRLEŞİMİ (09-24 üçüncü tur): kelime ağının isteği · bekçinin isteği (ret ya da
 *    KODDA kaydırılmış saat dahil) · beyan edilen istek (tanınmayan dahil) ya da ret · anlama katmanının isteği ·
 *    cevap modelinin niyet etiketi (`early_checkin`/`late_checkout`). Hiçbir katmanın "istek yok"u başka bir katmanın
 *    isteğini SİLEMEZ. Bedeli bilinçli ve ölçülecek: istem etiketi konu SORULARINA da verdiği için ("erken check-in
 *    ücretli mi?") o bilgi soruları da insana gider — yanlış otomatik izin çok kötü, gereksiz inceleme kabul edilebilir.
 *  1. İDDİA (devirde de) → `availability_claim`: deterministik iddia/izin · beyan edilen `grants`/`states_calendar` ·
 *     bekçinin takvim/izin hükmü · TANINMAYAN duruş (her durumda) · beyan HİÇ yok ve hassas istek var (F01).
 *  2. Hassas istek → ERTELEME kanıtlanmadıysa `availability_unconfirmed` (bekçi kapalı / düştü / koştu, devirde de).
 *  ERTELEME = güvenilir `defers` beyanı VE bekçinin "erteliyor" hükmü (iki bağımsız model). Bekçi yoksa erteleme
 *  kanıtlanamaz. Kelime ağının erteleme cümlesi İZİN DEĞİLDİR — yalnız kanıta yazılır (`lx` içinde `d`). Kip YOK.
 * Hassas istek yoksa (bilgi sorusu) bekçi yokken de karar yalnız iddia bacağına kalır: her arızada her mesaj
 * durmaz.
 */
export function evaluateAvailability(
  reply: string | null | undefined,
  guestTexts: readonly (string | null | undefined)[],
  opts: AvailabilityPolicyOptions = {},
): AvailabilityEvaluation {
  const g: AvailabilitySignals["g"] = opts.guard === undefined ? "off" : opts.guard.status;
  // Model "istek yok" dese bile `kind` bir değişiklik adlandırıyorsa ya da KODDA saat kaymışsa istek
  // sayılır (yalnız sıkılaştırır; inceleme 09-24).
  const u: AvailabilitySignals["u"] = !opts.understanding
    ? opts.understandingFailed
      ? "failed"
      : "off"
    : opts.understanding.requested || opts.understanding.kind !== "none" || slotTimesShifted(opts.understanding, opts.stayTimes)
      ? "req"
      : "none";
  const d = opts.declared ? `${opts.declared.asked}/${opts.declared.stance}` : "absent";
  const ri = stayReplyIntentOf(opts.replyIntent);
  if (typeof reply !== "string" || reply.trim() === "") {
    return { reason: null, enforceReason: null, signals: { lx: "-", d, g, u, ...(ri ? { ri } : {}) } };
  }
  const guard = opts.guard?.status === "ok" ? opts.guard.verdict : null;
  const declared = opts.declared ?? null;

  // BEYANIN GÜVENİLİRLİĞİ (F01 — eksik / tanınmayan ≠ temiz). Yedek (şablon) cevapta ortada model duruşu yoktur →
  // bu kural uygulanmaz. Niyet etiketi ile beyanın "çelişkisi" burada DEĞİL ↓ hassas istek birleşiminde ele alınır
  // (etiket isteğe sayılır, iddiaya DEĞİL): istem etiketi konu SORULARINA da verir, çelişkiyi iddia saymak bekçiyi
  // hiç çağırtmıyordu (düşmanca inceleme 09-24, P2-2).
  const stanceUnknown = !opts.deterministicReply && (declared === null || declared.stance === "unknown");
  // 🚨 ERTELEME = İKİ BAĞIMSIZ MODEL: güvenilir `defers` beyanı VE koşmuş bekçinin "erteliyor" hükmü. Bekçi yoksa ya
  // da düştüyse erteleme KANITLANAMAZ. Kelime ağının erteleme cümlesi izin sayılmaz (kurucu 09-24: kelime ağı yalnız
  // engeller) — eskiden beyan yokken tek başına, beyan `defers` iken ikinci anahtar olarak sayılıyordu.
  const trustedDefers = declared !== null && declared.stance === "defers";
  const deferred = trustedDefers && guard?.replyDefersToHost === true;

  // ERTELEME ev sahibinin teklif metninin DIŞINDA aranır: teklifin kendi "müsaitlik varsa"sı kendini onaylayamaz.
  const withoutOffer = withoutHostOffer(reply, opts.hostOfferText);
  const lexDeferral = hasAvailabilityDeferral(withoutOffer);
  // EV SAHİBİ TEKLİFİ MUAFİYETİ YALNIZ ERTELEMEYLE (ikinci inceleme 09-24, P1): teklifi aynen aktarıp hiçbir şeyi
  // ertelemeyen cevap ("Late checkout until 13:00 is possible for 20 EUR.") belirli bir gün için izin gibi okunur.
  // Bekçi koştuysa erteleme ONUN hükmüyle (iki model); koşmadıysa (kapalı / düştü / ilk geçiş) güvenilir `defers` beyanı
  // + erteleme cümlesi yalnız teklif metnini iddia taramasından çıkarır — İZİN DEĞİLDİR: hassas istek bekçisiz yine
  // tutulur (↓), bilgi sorusuna eklenen teklif ise eskisi gibi gider. Bu ayrım bekçiye ULAŞILMASI için de şarttır:
  // ilk geçiş teklif metnini iddia sayarsa bekçi hiç çağrılmaz (iddia tutuşu bekçiyi tetiklemez).
  // STANDART ÇIKIŞ SAATİ bilgisi izin DEĞİLDİR — ↑`withoutStandardCheckoutUntil`.
  const offerExempt = guard !== null ? deferred : trustedDefers && lexDeferral;
  const lexClaim = lexicalClaim(offerExempt ? withoutOffer : reply, opts.stayTimes);
  const lexRequest = guestTexts.some((t) => detectAvailabilityRequest(t) !== null);
  const signals: AvailabilitySignals = {
    lx: (lexClaim ? "c" : "") + (lexRequest ? "r" : "") + (lexDeferral ? "d" : "") || "-",
    d,
    g,
    ...(guard ? { gv: guardFlags(guard, opts.stayTimes) } : {}),
    u,
    ...(ri ? { ri } : {}),
  };

  // DOĞRULANMIŞ ERKEN GİRİŞ ONAYI (09-24): yalnız koddan kurulan metin (birebir) + tek tür erken giriş → muaf.
  if (opts.verifiedGrant && reply === opts.verifiedGrant.text) {
    const kinds = stayRequestKinds(guestTexts, opts);
    if (kinds.size === 1 && kinds.has("early_checkin")) return { reason: null, enforceReason: null, signals };
  }

  const guardRequest =
    guard !== null &&
    (guard.guestRequestsChange ||
      guard.kind !== "none" ||
      guard.replyRefuses ||
      slotTimesShifted({ checkinTime: guard.requestedCheckinTime, checkoutTime: guard.requestedCheckoutTime }, opts.stayTimes));
  // 🚨 HASSAS İSTEK = TÜM KATMANLARIN BİRLEŞİMİ (kurucu + dış inceleme, 09-24 üçüncü tur): kelime ağı · bekçi · beyanın
  // `asked` alanı (tanınmayan da istek) · ret duruşu · anlama katmanının yuvası · cevap modelinin niyet etiketi. Hiçbir
  // katmanın "istek yok"u başka bir katmanın isteğini SİLEMEZ. Bedeli bilinçli: konu etiketi `early_checkin` olan bilgi
  // sorusu da insana gider ("yanlış otomatik izin çok kötü; gereksiz insan incelemesi kabul edilebilir").
  const sensitive =
    lexRequest || guardRequest || declaredRequest(declared) || declared?.stance === "refuses" || u === "req" || ri !== undefined;

  const claim =
    lexClaim ||
    declaredClaim(declared) ||
    // TANINMAYAN duruş, geçerli bir izin duruşundan gevşek olamaz → her durumda iddia (F01; düşmanca inceleme 09-24,
    // P2-3: "Grants" yazım hatası konaklama bağlamı yokken kendiliğinden verilen izni geçiriyordu).
    (!opts.deterministicReply && declared !== null && declared.stance === "unknown") ||
    // Beyan HİÇ yoksa: hassas istek varken duruş bilinmiyor → iddia (F01). Hassas istek yoksa hiçbir katman konaklama
    // konusu görmüyor; bütün eksik-alan çıktılarını tutmak ölçülmemiş toptan bir durdurma olurdu.
    (stanceUnknown && sensitive) ||
    (guard !== null && (guard.replyStatesCalendar || guard.replyGrantsChange));
  if (claim) return { reason: "availability_claim", enforceReason: "availability_claim", signals };
  // 🚨 Hassas istek ancak İKİ BAĞIMSIZ MODEL ertelemeyi doğruladıysa gider. Bekçi yoksa ya da düştüyse erteleme hiç
  // kanıtlanamaz → hassas istek her durumda insana. Kip yok (09-24'e kadarki `AI_STAY_POLICY` gölge kipi birleşim
  // değişmeziyle KALDIRILDI); devir cevabı da muaf değil (P1-2). Kanıttaki `ev` şema kararlılığı için `v`ye eşittir.
  const reason: AvailabilityVetoReason | null = sensitive && !deferred ? "availability_unconfirmed" : null;
  return { reason, enforceReason: reason, signals };
}

/** Karar kaydı için PII'siz özet (`grounding.ts` `sc` alanı; kapalı küme kodlar). */
export function stayEvidenceOf(e: AvailabilityEvaluation): {
  v: string;
  ev: string;
  lx: string;
  d: string;
  g: string;
  gv?: string;
  u: string;
  ri?: string;
} {
  return { v: e.reason ?? "-", ev: e.enforceReason ?? "-", ...e.signals };
}

/** `evaluateAvailability(...).reason` — kapıların kullandığı tek karar (`null` = temiz). */
export function vetoAvailability(
  reply: string | null | undefined,
  guestTexts: readonly (string | null | undefined)[],
  opts: AvailabilityPolicyOptions = {},
): AvailabilityVetoReason | null {
  return evaluateAvailability(reply, guestTexts, opts).reason;
}
