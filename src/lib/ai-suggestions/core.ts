import { foldTurkishAscii } from "@/lib/ai/fallback";
import { explicitTimeMentions } from "@/lib/early-checkin/text-checks";
import type { CommitmentKind } from "@/lib/guest-commitments-core";

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
  `${NL}(?:(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)\\p{L}{0,4}|yarindan\\s+sonra|obur\\s+gun\\p{L}{0,2}|ertesi\\s+gun\\p{L}{0,2}|\\d{1,2}\\s*gun\\p{L}{0,3}|(?:iki|uc|dort|bes|birkac)\\s+gun\\p{L}{0,3}|onumuzdeki|gelecek\\s+hafta\\p{L}{0,2}|haftaya|hafta\\s+(?:sonu|ici)\\p{L}{0,3}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+(?:week|month)|weekend|day\\s+after\\s+tomorrow|in\\s+\\d+\\s+days)${NR}`,
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
  /** Gün: misafire söylenen ("yarın") ya da varsayılan bugün. */
  day: "today" | "tomorrow";
  /** Açık saat adayları (dakika; "6" → 06:00 ve 18:00) — gün dilimi ya da gündüz tercihiyle süzülmüş; seçim `promiseDue`da. */
  timeCandidates: number[];
  /** Göreli süre ("birazdan" 60, "30 dakika içinde" 30, "1,5 saat sonra" 90, "yarım saat içinde" 30) — açık saat yoksa. */
  inMinutes: number | null;
  /** Açık saat ve süre YOKKEN gün dilimi sözcüğünden varsayılan saat ("sabah" 10:00, "akşam" 19:00 — Haiku 10-12 2. / 3. tur). */
  cue: { minutes: number; half: DayHalf } | null;
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
const UNTIL_HOUR = /(?<![\p{L}\p{N}.:])([01]?\d|2[0-3])\s*'?\s*(?:e|a|ye|ya)\s+kadar(?![\p{L}])/u;

/** Kapsamdaki açık saat adayları: saat okuyucusu + "N'e kadar". */
function timeMentions(raw: string, folded: string): number[] {
  const out = explicitTimeMentions(raw).flat();
  const until = UNTIL_HOUR.exec(folded);
  if (until) {
    const h = Number(until[1]);
    out.push(h * 60);
    if (h > 0 && h < 12) out.push((h + 12) * 60);
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
  return SOON.test(text) ? 60 : null;
}

/**
 * Gün dilimi sözcükleri (ekli biçimler: "akşama", "sabahleyin", "öğlene", "geceleyin") → varsayılan saat + açık saati yorumlama yönü.
 * Sıra önemli: "öğleden sonra" > "öğle"; "akşamüstü" > "akşam"; "gece yarısı" > "gece".
 */
const DAY_PARTS: ReadonlyArray<{ re: RegExp; minutes: number; half: DayHalf }> = [
  { re: new RegExp(`${NL}(?:ogleden\\s+sonra|afternoon)${NR}`, "u"), minutes: 15 * 60, half: "pm" },
  { re: new RegExp(`${NL}aksamustu\\p{L}{0,3}${NR}`, "u"), minutes: 17 * 60, half: "pm" },
  { re: new RegExp(`${NL}(?:aksam\\p{L}{0,5}|evening)${NR}`, "u"), minutes: 19 * 60, half: "pm" },
  { re: new RegExp(`${NL}gece\\s+yarisi\\p{L}{0,3}${NR}`, "u"), minutes: 23 * 60 + 30, half: "night" },
  { re: new RegExp(`${NL}(?:gece\\p{L}{0,5}|tonight)${NR}`, "u"), minutes: 21 * 60, half: "night" },
  { re: new RegExp(`${NL}(?:sabah\\p{L}{0,5}|morning)${NR}`, "u"), minutes: 10 * 60, half: "am" },
  { re: new RegExp(`${NL}(?:ogle(?:n|ne|yin|ye)|noon|midday)${NR}`, "u"), minutes: 12 * 60, half: "pm" },
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
    const clause = foldTurkishAscii(raw).toLowerCase();
    if (clause.trim() === "" || /[?؟]\s*$/.test(raw) || CONDITIONAL.test(clause) || !PROMISE.test(clause)) continue;
    if (QUESTION_PARTICLE.test(clause) || NEGATION.test(clause)) continue;
    const segments = clause.split(SEGMENT_SPLIT);
    const rawSegments = raw.split(RAW_SEGMENT_SPLIT);
    const verbIdx = segments.map((seg, i) => (PROMISE.test(seg) ? i : -1)).filter((i) => i >= 0);
    if (verbIdx.length === 0 || verbIdx.some((i) => negatedAfterVerb(segments[i]))) continue;
    const topicIn = (t: string) => KIND_TOPICS.find(([, re]) => re.test(t))?.[0];
    const withTopic = verbIdx.find((i) => topicIn(segments[i]) !== undefined);
    const kind = withTopic !== undefined ? topicIn(segments[withTopic]) : topicIn(clause);
    if (!kind) continue;
    // Kapsam: sözün parçası; bilgi yoksa soldaki (söz fiili TAŞIMAYAN) parçalar. Özgün metin aynı sayıda parçaya bölünemezse cümlecik.
    const at = withTopic ?? verbIdx[0];
    let from = at;
    const aligned = rawSegments.length === segments.length;
    const sliceOf = (a: number, b: number) => ({
      folded: segments.slice(a, b + 1).join(","),
      raw: aligned ? rawSegments.slice(a, b + 1).join(",") : raw,
    });
    // En fazla 3 parça sola (her adım dilimi yeniden tarar — sınırsız genişleme virgül dizisinde karesel olurdu).
    while (from > 0 && at - from < 3 && !hasTimeInfo(sliceOf(from, at).folded, sliceOf(from, at).raw) && !PROMISE.test(segments[from - 1])) from--;
    // Sağdaki ZAMAN bilgisi taşıyan, söz fiili ve konu TAŞIMAYAN parçalar da sözün parçasıdır ("Teknisyen gelecek, yarın sabah 10 gibi";
    // "The technician will come tomorrow, around 9") — en fazla 2; "havlular yarın" gibi başka konulu parça katılmaz (Haiku 10-12 4. tur).
    let to = at;
    while (to + 1 < segments.length && to - at < 2) {
      const next = sliceOf(to + 1, to + 1);
      if (PROMISE.test(next.folded) || topicIn(next.folded) !== undefined || !hasTimeInfo(next.folded, next.raw)) break;
      to++;
    }
    const scope = sliceOf(from, to);
    // Tanınmayan gün (kapsamda) → öneri yok (bütün mesaj için: aynı mesajda başka söz de yanlış güne bağlanmasın).
    if (DAY_UNKNOWN.test(scope.folded)) return null;
    // "Bugün ya da yarın" → hangi gün? belirsiz → öneri yok.
    if (DAY_TOMORROW.test(scope.folded) && DAY_TODAY.test(scope.folded)) return null;
    const day: HostPromise["day"] = DAY_TOMORROW.test(scope.folded) ? "tomorrow" : "today";
    const part = DAY_PARTS.find((d) => d.re.test(scope.folded));
    const inMinutes = durationMinutes(scope.folded);
    // 24 saati aşan süre ("48 saat içinde") bugün / yarın modelinin dışında → öneri yok (Haiku 10-12 4. tur: saat kipinde yuvarlanıyordu).
    if (inMinutes !== null && inMinutes > 24 * 60) return null;
    let timeCandidates = inMinutes === null ? timeMentions(scope.raw, scope.folded) : [];
    timeCandidates = part ? fitToHalf(timeCandidates, part.half) : preferDaytime(timeCandidates);
    const cue = inMinutes === null && timeCandidates.length === 0 && part ? { minutes: part.minutes, half: part.half } : null;
    return { kind, day, timeCandidates, inMinutes, cue };
  }
  return null;
}

/**
 * Sözün son anı (dakika cinsinden, işletmenin yerel duvar saati): açık saat → aday saatlerden şimdiden sonraki ilki (yoksa yarın ilki);
 * göreli süre → şimdi + süre; gün dilimi ("yarın sabah" 10:00, "bu akşam" 19:00; bugünkü SABAH geçmişse yarın sabah, akşam / gece geçmişse
 * şimdi + 2 saat); "yarın" ipuçsuz → yarın 12:00; hiçbiri → bugün şimdi + 2 saat. Döner: gün + "SS:DD" (ev sahibi onaydan önce değiştirebilir).
 */
export function promiseDue(p: HostPromise, nowMinutes: number): { day: "today" | "tomorrow"; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const inTwoHours = () => ({ day: "today" as const, time: fmt(Math.min(nowMinutes + 120, 23 * 60 + 59)) });
  if (p.inMinutes !== null) {
    const t = nowMinutes + p.inMinutes;
    return t >= 24 * 60 ? { day: "tomorrow", time: fmt(t - 24 * 60) } : { day: p.day, time: fmt(t) };
  }
  if (p.timeCandidates.length > 0) {
    if (p.day === "tomorrow") return { day: "tomorrow", time: fmt(Math.min(...p.timeCandidates)) };
    const future = p.timeCandidates.filter((m) => m > nowMinutes).sort((a, b) => a - b);
    return future.length > 0 ? { day: "today", time: fmt(future[0]) } : { day: "tomorrow", time: fmt(Math.min(...p.timeCandidates)) };
  }
  if (p.cue !== null) {
    if (p.day === "tomorrow") return { day: "tomorrow", time: fmt(p.cue.minutes) };
    if (p.cue.minutes > nowMinutes) return { day: "today", time: fmt(p.cue.minutes) };
    return p.cue.half === "am" ? { day: "tomorrow", time: fmt(p.cue.minutes) } : inTwoHours();
  }
  if (p.day === "tomorrow") return { day: "tomorrow", time: "12:00" };
  return inTwoHours();
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
