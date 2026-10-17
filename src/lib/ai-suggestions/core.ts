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
  "(?:getir(?:ecegim|ecegiz|ecek|ecekler|ilecek|irim|iriz|tecegim|tirecegim|eyim|iyorum|iyoruz)|gonder(?:ecegim|ecegiz|ecek|ilecek|irim|iriz|iyorum|iyoruz)|yolla(?:yacagim|yacagiz|yacak|rim)|birak(?:acagim|acagiz|acak)|yap(?:acagim|acagiz|acak|ilacak)|gel(?:ecek(?!\\s+(?:hafta|ay|yil|sefer|misafir|konuk|kisi|grup|rezervasyon|sezon))|ecekler|ecegim|ecegiz|iyor|iyorlar)|ugra(?:yacak|yacagim|yacagiz)|bak(?:acak|acagim|acagiz|acaklar)|ilgilen(?:ecegim|ecegiz|ecek)|halled(?:ecegim|ecegiz|ecek|ilecek)|hallederim|tamir\\s+(?:edilecek|edecek|edecegim|ettirecegim)|degistir(?:ecegim|ecegiz|ecek|ilecek)|temizle(?:necek|yecek|yecegim|yecegiz)|ayarla(?:yacagim|yacagiz|nacak|rim))";
const PROMISE_EN =
  "(?:i['’]?m\\s+sending|i\\s+am\\s+sending|i['’]?ll|i\\s+will|we['’]?ll|we\\s+will|(?:someone|somebody|(?:(?:the|a|an|our)\\s+)?(?:technician|cleaner|plumber|electrician|engineer|housekeeper)s?|housekeeping|maintenance|he|she|they)\\s+will|(?:is|are)\\s+(?:coming|on\\s+(?:the|his|her|their)\\s+way))";
const PROMISE = new RegExp(`${NL}(?:${PROMISE_TR}|${PROMISE_EN})${NR}`, "u");
/** Teklif / koşul söz değildir ("isterseniz getirebilirim", "if you need I'll bring"). */
const CONDITIONAL = new RegExp(`${NL}(?:eger|isterseniz|istersen|gerekirse|ihtiyac\\p{L}{0,6}\\s+olursa|if|unless)${NR}`, "u");
/** İptal / engel söz değildir ("teknisyen izinli", "won't come", "iptal oldu") — cümlecik boyunca (Haiku 10-12). */
const NEGATION = new RegExp(`${NL}(?:iptal|olmayacak|gelmeyecek|gelemeyecek|izinli|won['’]?t|will\\s+not|cannot|can['’]?t|not\\s+coming|cancel\\p{L}*)${NR}`, "u");
/** Kararsız söz (kurucu 10-17 gece; Opus: "belki / emin değilim" söz sayılıyordu) — cümlecikte varsa söz DEĞİL (görev açılmaz). */
const HEDGE = new RegExp(
  `${NL}(?:belki|galiba|sanirim|umarim|muhtemelen|emin\\s+degil\\p{L}{0,6}|maybe|perhaps|hopefully|probably|not\\s+sure)${NR}`,
  "u",
);
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
 * ("rezervasyon kaydı") → yalnız saat / gün / dilim ardından ("11'e kaydı", "yarına kaydı"); çıplak "değişti" de olmaz ("klima değişti").
 */
const RESCHEDULE = new RegExp(
  `${NL}(?:(?:\\d{1,2}(?:[:.]\\d{2})?\\s*(?:['’]\\s*)?(?:e|a|ye|ya)|yarin\\p{L}{0,2}|bugun\\p{L}{0,2}|sabah\\p{L}{0,3}|aksam\\p{L}{0,3}|ogleden\\s+sonra\\p{L}{0,3})\\s+(?:kaydi|kaydirildi|kaydirdik|alindi)|ertelendi|erteledik|ertelenmistir|saat\\p{L}{0,4}\\s+degis\\p{L}{0,6}|rescheduled|postponed|pushed\\s+back|moved\\s+to)${NR}`,
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
 */
const DAY_TODAY = /(?<![\p{L}\p{N}])(?:bugun\p{L}{0,3}|today|tonight)(?![\p{L}])/u;
const DAY_TOMORROW = /(?<![\p{L}\p{N}])(?:yarin(?:a|ki)?|tomorrow)(?![\p{L}])/u;
const DAY_UNKNOWN = new RegExp(
  `${NL}(?:(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)\\p{L}{0,4}|yarindan\\s+sonra|obur\\s+gun\\p{L}{0,2}|ertesi\\s+gun\\p{L}{0,2}|\\d{1,2}\\s*(?:gun|hafta|ay)\\p{L}{0,3}|(?:bir|iki|uc|dort|bes|birkac)\\s+(?:gun|hafta|ay)\\p{L}{0,3}|onumuzdeki|gelecek\\s+hafta\\p{L}{0,2}|haftaya|hafta\\s+(?:sonu|ici)\\p{L}{0,3}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+(?:week|month)|weekend|day\\s+after\\s+tomorrow|in\\s+(?:\\d+|a|an|one|two|three|a\\s+few|few)\\s+(?:days?|weeks?|months?))${NR}`,
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
const SOON = /(?<![\p{L}\p{N}])(?:birazdan|hemen|az\s+sonra|shortly|right\s+away|soon|asap)(?![\p{L}])/u;
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
  { re: new RegExp(`${NL}(?:aksam\\p{L}{0,5}|evening)${NR}`, "u"), minutes: 19 * 60, half: "pm", code: "evening", end: 23 * 60 + 59 },
  { re: new RegExp(`${NL}gece\\s+yarisi\\p{L}{0,3}${NR}`, "u"), minutes: 23 * 60 + 30, half: "night", code: "midnight", end: 25 * 60 },
  { re: new RegExp(`${NL}(?:gece(?!n(?:de|ler|lerde)?(?![\\p{L}\\p{N}]))\\p{L}{0,5}|tonight)${NR}`, "u"), minutes: 21 * 60, half: "night", code: "night", end: 30 * 60 },
  { re: new RegExp(`${NL}(?:sabah\\p{L}{0,5}|morning)${NR}`, "u"), minutes: 10 * 60, half: "am", code: "morning", end: 12 * 60 },
  { re: new RegExp(`${NL}(?:ogle(?:n|ne|yin|ye)|noon|midday)${NR}`, "u"), minutes: 12 * 60, half: "pm", code: "noon", end: 14 * 60 },
];

/** Açık saat adaylarını gün dilimine göre yorumla: akşam "7:00" → 19:00, öğleden sonra "2:30" → 14:30, gece "2" → 02:00, sabah "9" → 09:00. */
function fitToHalf(candidates: number[], half: DayHalf): number[] {
  const DAY = 24 * 60;
  const out = candidates.map((m) => {
    if (half === "pm" && m < 12 * 60) return m + 12 * 60;
    if (half === "night" && m >= 6 * 60 && m < 12 * 60) return m + 12 * 60; // "gece 11" → 23:00
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
    DAY_PARTS.some((d) => d.re.test(folded)) ||
    durationMinutes(folded) !== null ||
    timeMentions(raw, folded).length > 0
  );
}

/**
 * Ev sahibinin mesajında misafire verilen SÖZ var mı (aynı cümlecikte söz fiili + konu; soru / koşul / teklif değil)? Tür kapalı küme
 * (havlu / malzeme / temizlik / bakım) — konu önce söz fiilinin virgül parçasında aranır ("Klima için teşekkürler, yarın havlu getireceğim"
 * → havlu), yoksa cümlecikte; birden çok konu varsa bakım > temizlik > havlu > malzeme. Gün / saat / süre YALNIZ sözün parçasından (o parçada
 * yoksa soldaki söz fiilsiz parçalardan): "Teknisyen bugün gelecek, yarın havlu getiririm" → bakım BUGÜN; "Teknisyen yarın gelecek, işi
 * 2 saat sürer" → süre son an değil (Haiku 10-12 3. tur). Metin SAKLANMAZ.
 */
export function detectHostPromise(text: string | null | undefined): HostPromise | null {
  if (typeof text !== "string" || text.trim() === "" || text.length > 4_000) return null;
  for (const raw of text.match(RAW_CLAUSES) ?? []) {
    const c = promiseClause(raw);
    if (!c) continue;
    const withTopic = c.verbIdx.find((i) => c.topicIn(c.segments[i]) !== undefined);
    const kind = withTopic !== undefined ? c.topicIn(c.segments[withTopic]) : c.topicIn(c.clause);
    if (!kind) continue;
    const p = promiseAt(c, withTopic ?? c.verbIdx[0], kind);
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
  const out: HostPromise[] = [];
  for (const raw of text.match(RAW_CLAUSES) ?? []) {
    if (out.length >= MAX_PROMISES_PER_MESSAGE) break;
    const c = promiseClause(raw);
    if (!c) continue;
    const topical = c.verbIdx.filter((i) => c.topicIn(c.segments[i]) !== undefined);
    const picks: Array<readonly [number, CommitmentKind]> = topical.length
      ? topical.map((i) => [i, c.topicIn(c.segments[i])!] as const)
      : (() => {
          const k = c.topicIn(c.clause);
          return k ? [[c.verbIdx[0], k] as const] : [];
        })();
    for (const [at, kind] of picks) {
      if (out.length >= MAX_PROMISES_PER_MESSAGE) break;
      const p = promiseAt(c, at, kind);
      if (p === REJECT) continue;
      if (out.some((q) => samePromise(q, p))) continue;
      out.push(p);
    }
  }
  return out;
}

const REJECT = Symbol("reject");

/** Aynı sözün mesaj içinde BİREBİR tekrarı mı (tür, konu, gün ve saat okuması aynı). */
function samePromise(a: HostPromise, b: HostPromise): boolean {
  return (
    a.kind === b.kind &&
    a.topic === b.topic &&
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
  clause: string;
  segments: string[];
  rawSegments: string[];
  verbIdx: number[];
  topicIn: (t: string) => CommitmentKind | undefined;
}

/** Cümlecik söz taşıyabilir mi (soru / koşul / olumsuz değil, söz fiili var) — taşıyorsa parçaları. */
function promiseClause(raw: string): PromiseClause | null {
  const clause = foldTurkishAscii(raw).toLowerCase();
  if (clause.trim() === "" || CONDITIONAL.test(clause)) return null;
  if (!PROMISE.test(clause) && !RESCHEDULE.test(clause)) return null;
  // Soru YALNIZ sözün kapsamında söz bozar (↓ `promiseAt`): "Yarın havlu getireceğim, başka bir ihtiyacınız var mı?" bir söz + ayrı bir
  // sorudur (Haiku 10-17 gece; eskiden cümlecik sonundaki "?" bütün sözü düşürüyordu). İptal / kararsızlık bilerek cümlecik boyunca kalır
  // ("Teknisyen gelecek ama iptal olabilir", "…, galiba").
  if (NEGATION.test(clause) || HEDGE.test(clause)) return null;
  const segments = clause.split(SEGMENT_SPLIT);
  const rawSegments = raw.split(RAW_SEGMENT_SPLIT);
  const verbIdx = segments.map((seg, i) => (PROMISE.test(seg) || RESCHEDULE.test(seg) ? i : -1)).filter((i) => i >= 0);
  if (verbIdx.length === 0 || verbIdx.some((i) => negatedAfterVerb(segments[i]))) return null;
  const topicIn = (t: string) => KIND_TOPICS.find(([, re]) => re.test(t))?.[0];
  return { raw, clause, segments, rawSegments, verbIdx, topicIn };
}

/** `at` parçasındaki söz fiilinin sözü (kapsam, gün, saat, konu). Tanınmayan / belirsiz gün ya da 24 saati aşan süre → REJECT. */
function promiseAt(c: PromiseClause, at: number, kind: CommitmentKind): HostPromise | typeof REJECT {
  const { raw, segments, rawSegments, topicIn } = c;
  // Aktarılan / geçmiş söz (söz fiilinin kendi parçasında) söz değildir.
  if (REPORTED.test(segments[at]) || segments.slice(0, at).some((seg) => REPORTED_LEAD.test(seg))) return REJECT;
  // Kapsam: sözün parçası; bilgi yoksa soldaki (söz fiili TAŞIMAYAN) parçalar. Özgün metin aynı sayıda parçaya bölünemezse cümlecik.
  let from = at;
  const aligned = rawSegments.length === segments.length;
  const sliceOf = (a: number, b: number) => ({
    folded: segments.slice(a, b + 1).join(","),
    raw: aligned ? rawSegments.slice(a, b + 1).join(",") : raw,
  });
  // En fazla 3 parça sola (her adım dilimi yeniden tarar — sınırsız genişleme virgül dizisinde karesel olurdu).
  while (
    from > 0 &&
    at - from < 3 &&
    !hasTimeInfo(sliceOf(from, at).folded, sliceOf(from, at).raw) &&
    !PROMISE.test(segments[from - 1]) &&
    !RESCHEDULE.test(segments[from - 1]) &&
    !PAST_REF.test(segments[from - 1])
  )
    from--;
  // Sağdaki ZAMAN bilgisi taşıyan, söz fiili ve konu TAŞIMAYAN parçalar da sözün parçasıdır ("Teknisyen gelecek, yarın sabah 10 gibi";
  // "The technician will come tomorrow, around 9") — en fazla 2; "havlular yarın" gibi başka konulu parça katılmaz (Haiku 10-12 4. tur).
  // Saat değişikliği bildiren parçanın (söz fiili yok) sağındaki KONUSUZ söz parçası aynı sözün yeni zamanıdır ("Teknisyen saati değişti,
  // 15:00'te gelecek" — kurucu 10-17 gece: "konuyu, değiştirilen şeyi anlamalı").
  const rescheduleOnly = !PROMISE.test(segments[at]) && RESCHEDULE.test(segments[at]);
  let to = at;
  // Süre ("30 dakika içinde") yalnız SÖZÜN parçalarından okunur (Haiku 10-17 gece: "Teknisyen yarın 10'da gelecek, işi 2 saat içinde bitirir"
  // sağdaki işin süresini son an sanıyor, 10:00'ı silip 16:00 uyduruyordu). Saat değişikliğinin devam eden söz parçası sözün parçasıdır.
  let durationTo = at;
  while (to + 1 < segments.length && to - at < 2) {
    const next = sliceOf(to + 1, to + 1);
    const continues = rescheduleOnly && to === at && PROMISE.test(next.folded) && !RESCHEDULE.test(next.folded);
    if (
      (!continues && PROMISE.test(next.folded)) ||
      RESCHEDULE.test(next.folded) ||
      topicIn(next.folded) !== undefined ||
      PAST_REF.test(next.folded) ||
      !hasTimeInfo(next.folded, next.raw)
    )
      break;
    to++;
    if (continues) durationTo = to;
  }
  const scope = sliceOf(from, to);
  // Soru sözün kapsamındaysa söz değil: soru eki ("gelecek mi") ya da cümlecik "?" ile bitiyor ve son parça kapsamda.
  if (QUESTION_PARTICLE.test(scope.folded) || (/[?؟]\s*$/.test(raw) && to === segments.length - 1)) return REJECT;
  // Tanınmayan gün (kapsamda) → öneri yok.
  if (DAY_UNKNOWN.test(scope.folded)) return REJECT;
  // "Bugün ya da yarın" → hangi gün? belirsiz → öneri yok.
  if (DAY_TOMORROW.test(scope.folded) && DAY_TODAY.test(scope.folded)) return REJECT;
  const day: HostPromise["day"] = DAY_TOMORROW.test(scope.folded) ? "tomorrow" : "today";
  // Geçmişe atıf ("dün gece") dilim sayılmaz.
  const part = DAY_PARTS.find((d) => d.re.test(scope.folded.replace(PAST_PART, " ")));
  const inMinutes = durationMinutes(sliceOf(from, durationTo).folded);
  // 24 saati aşan süre ("48 saat içinde") bugün / yarın modelinin dışında → öneri yok (Haiku 10-12 4. tur: saat kipinde yuvarlanıyordu).
  if (inMinutes !== null && inMinutes > 24 * 60) return REJECT;
  let timeCandidates = inMinutes === null ? timeMentions(scope.raw, scope.folded) : [];
  timeCandidates = part ? fitToHalf(timeCandidates, part.half) : preferDaytime(timeCandidates);
  const cue = inMinutes === null && timeCandidates.length === 0 && part ? { minutes: part.minutes, half: part.half, code: part.code, end: part.end } : null;
  const soon = inMinutes === null && timeCandidates.length === 0 && cue === null && SOON.test(scope.folded);
  const reschedule = RESCHEDULE.test(scope.folded);
  // Söz fiili olmayan saat değişikliği cümleciği ("Teknisyen 11'e kaydı") YALNIZ zaman bilgisiyle söz sayılır — "ertelendi" tek başına yeni
  // bir zaman söylemez (hiçbir şey açılmaz / güncellenmez).
  if (!PROMISE.test(segments[at]) && !hasTimeInfo(scope.folded, scope.raw)) return REJECT;
  return { kind, topic: commitmentTopicOf(kind, scope.raw, scope.folded), day, timeCandidates, inMinutes, cue, soon, reschedule };
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
    return { day: future.length > 0 ? "today" : "tomorrow", precision: "time", time: fmt(m), end: m };
  }
  if (p.cue !== null) {
    const early = p.cue.code === "morning" || p.cue.code === "noon" || p.cue.code === "afternoon" || p.cue.code === "late_afternoon";
    const day = p.day === "tomorrow" || (early && p.cue.end <= nowMinutes) ? "tomorrow" : "today";
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
