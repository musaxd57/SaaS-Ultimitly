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
  "(?:getir(?:ecegim|ecegiz|ecek|ecekler|ilecek|iririm|iririz|tecegim|tirecegim|eyim|iyorum|iyoruz)|gonder(?:ecegim|ecegiz|ecek|ilecek|irim|iriz|iyorum|iyoruz)|yolla(?:yacagim|yacagiz|yacak|rim)|birak(?:acagim|acagiz|acak)|yap(?:acagim|acagiz|acak|ilacak)|gel(?:ecek(?!\\s+(?:hafta|ay|yil|sefer|misafir|konuk|kisi|grup|rezervasyon|sezon))|ecekler|ecegim|ecegiz|iyor|iyorlar)|ugra(?:yacak|yacagim|yacagiz)|bak(?:acak|acagim|acagiz|acaklar)|ilgilen(?:ecegim|ecegiz|ecek)|halled(?:ecegim|ecegiz|ecek|ilecek)|hallederim|tamir\\s+(?:edilecek|edecek|edecegim|ettirecegim)|degistir(?:ecegim|ecegiz|ecek|ilecek)|temizle(?:necek|yecek|yecegim|yecegiz)|ayarla(?:yacagim|yacagiz|nacak|rim))";
const PROMISE_EN =
  "(?:i['’]?m\\s+sending|i\\s+am\\s+sending|i['’]?ll|i\\s+will|we['’]?ll|we\\s+will|(?:someone|somebody|the\\s+technician|a\\s+technician|the\\s+cleaner|our\\s+cleaner|housekeeping|maintenance|the\\s+plumber|an\\s+electrician|he|she|they)\\s+will|(?:is|are)\\s+(?:coming|on\\s+(?:the|his|her|their)\\s+way))";
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
/** Virgül parçası ayracı (karşıtlık bağlacı da parça başlatır). */
const SEGMENT_SPLIT = /,|(?<![\p{L}\p{N}])(?:ama|fakat|ancak|but)(?![\p{L}\p{N}])/u;
/** Gün sözcükleri: tanınan (bugün / yarın) ve TANINMAYAN (haftanın günleri, "öbür gün", "gelecek hafta") — tanınmayanda öneri YOK
 *  (yanlış son tarih tek tıkla yazılmasın — Haiku 10-12). */
const DAY_TOMORROW = /(?<![\p{L}\p{N}])(?:yarin|tomorrow)(?![\p{L}])/u;
const DAY_UNKNOWN = new RegExp(
  `${NL}(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|obur\\s+gun|ertesi\\s+gun|gelecek\\s+hafta|haftaya|hafta\\s+sonu|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+week|weekend|day\\s+after\\s+tomorrow)${NR}`,
  "u",
);

const KIND_TOPICS: ReadonlyArray<readonly [CommitmentKind, RegExp]> = [
  [
    "maintenance",
    new RegExp(
      `${NL}(?:teknisyen|tamir|usta|tesisatci|elektrikci|servis|ariza|bakim|klima|kombi|sofben|petek|bulasik\\s+makinesi|camasir\\s+makinesi|buzdolabi|(?:technician|repair|fix|plumber|electrician|maintenance|engineer|heater|boiler)${NR})`,
      "u",
    ),
  ],
  ["cleaning", new RegExp(`${NL}(?:temizlik|temizlikci|temizle|(?:cleaning|cleaner|housekeeping|clean)${NR})`, "u")],
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
  /** Açık saat adayları (dakika; "6" → 06:00 ve 18:00) — seçim yükleyicide (gelecekteki ilk aday). Gün dilimi sözcüğü adayları süzer. */
  timeCandidates: number[];
  /** Göreli süre ("birazdan" 60, "30 dakika" 30, "1,5 saat içinde" 90) — açık saat yoksa. */
  inMinutes: number | null;
  /** Açık saat ve süre YOKKEN gün dilimi sözcüğünden varsayılan saat ("sabah" 10:00, "akşam" 19:00 — Haiku 10-12 2. tur). */
  cueMinutes: number | null;
}

/** Cümlecik + ayracı ("?" soru ayırt edilsin diye ayraç cümleciğe dahil). İki rakam arasındaki nokta ayraç DEĞİLDİR ("09.30", "1.5"). */
const RAW_CLAUSES = /(?:[^.!?;\n…؟。]|(?<=\d)\.(?=\d))+[.!?;\n…؟。]*/gu;
/** Söz fiilinden sonra soru eki ("gelecek mi", "getirecek misiniz"). */
const QUESTION_PARTICLE = /(?<![\p{L}\p{N}])m[iu](?:s[iu]n[iu]z|s[iu]n|y[iu]m)?(?![\p{L}])/u;
/** Göreli süre: "30 dakika", "2 saat içinde", "1,5 saat sonra" (ondalık süre dakikaya yuvarlanır). */
const RELATIVE_DURATION =
  /(?<![\p{L}\p{N}])(\d{1,3})\s*(?:dakika|dk|minutes?|mins?)(?![\p{L}])|(?<![\p{L}\p{N}.,])(\d{1,2}(?:[.,]\d)?)\s*(?:saat|hours?|hrs?)(?![\p{L}])/u;
const SOON = /(?<![\p{L}\p{N}])(?:birazdan|hemen|az\s+sonra|shortly|right\s+away|soon|asap)(?![\p{L}])/u;
/** Gün dilimi sözcükleri → varsayılan saat + açık saat süzgeci (öğleden sonra / akşam / gece → 12:00 sonrası; sabah → öncesi). */
const DAY_PARTS: ReadonlyArray<{ re: RegExp; minutes: number; half: "am" | "pm" }> = [
  { re: new RegExp(`${NL}(?:ogleden\\s+sonra|afternoon)${NR}`, "u"), minutes: 15 * 60, half: "pm" },
  { re: new RegExp(`${NL}(?:aksam(?:ustu|leyin)?|evening)${NR}`, "u"), minutes: 19 * 60, half: "pm" },
  { re: new RegExp(`${NL}(?:gece|tonight)${NR}`, "u"), minutes: 21 * 60, half: "pm" },
  { re: new RegExp(`${NL}(?:sabah(?:leyin)?|morning)${NR}`, "u"), minutes: 10 * 60, half: "am" },
  { re: new RegExp(`${NL}(?:ogle(?:n|yin)|noon|midday)${NR}`, "u"), minutes: 12 * 60, half: "pm" },
];

/** Söz fiilinin bulunduğu parçada fiilden SONRA "değil" / "yok" var mı. */
function negatedAfterVerb(segment: string): boolean {
  const m = PROMISE.exec(segment);
  return m !== null && NEGATION_AFTER_VERB.test(segment.slice(m.index + m[0].length));
}

/**
 * Ev sahibinin mesajında misafire verilen SÖZ var mı (aynı cümlecikte söz fiili + konu; soru / koşul / teklif değil)? Tür kapalı küme
 * (havlu / malzeme / temizlik / bakım) — konu önce söz fiilinin virgül parçasında aranır ("Klima için teşekkürler, yarın havlu getireceğim"
 * → havlu), yoksa cümlecikte; birden çok konu varsa bakım > temizlik > havlu > malzeme. Metin SAKLANMAZ.
 */
export function detectHostPromise(text: string | null | undefined): HostPromise | null {
  if (typeof text !== "string" || text.trim() === "" || text.length > 4_000) return null;
  for (const raw of text.match(RAW_CLAUSES) ?? []) {
    const clause = foldTurkishAscii(raw).toLowerCase();
    if (clause.trim() === "" || /[?؟]\s*$/.test(raw) || CONDITIONAL.test(clause) || !PROMISE.test(clause)) continue;
    if (QUESTION_PARTICLE.test(clause) || NEGATION.test(clause)) continue;
    const verbSegments = clause.split(SEGMENT_SPLIT).filter((seg) => PROMISE.test(seg));
    if (verbSegments.length === 0 || verbSegments.some(negatedAfterVerb)) continue;
    const topicIn = (t: string) => KIND_TOPICS.find(([, re]) => re.test(t))?.[0];
    const kind = verbSegments.map(topicIn).find((k) => k !== undefined) ?? topicIn(clause);
    if (!kind) continue;
    // Gün YALNIZ bu cümlecikten ("Teknisyen bugün gelecek. Yarın havlu getiririm." → bakım bugün — Haiku 10-12). Tanınmayan gün → öneri yok.
    if (DAY_UNKNOWN.test(clause)) return null;
    const day: HostPromise["day"] = DAY_TOMORROW.test(clause) ? "tomorrow" : "today";
    const part = DAY_PARTS.find((d) => d.re.test(clause));
    let inMinutes: number | null = null;
    const rel = RELATIVE_DURATION.exec(clause);
    if (rel) inMinutes = rel[1] ? Number(rel[1]) : Math.round(Number(rel[2].replace(",", ".")) * 60);
    else if (SOON.test(clause)) inMinutes = 60;
    let timeCandidates = inMinutes === null ? [...new Set(explicitTimeMentions(raw).flat())] : [];
    if (part && timeCandidates.length > 1) {
      const fitting = timeCandidates.filter((m) => (part.half === "pm" ? m >= 12 * 60 : m < 12 * 60));
      if (fitting.length > 0) timeCandidates = fitting; // "akşam 6" → 18:00 (06:00 değil)
    }
    const cueMinutes = inMinutes === null && timeCandidates.length === 0 && part ? part.minutes : null;
    return { kind, day, timeCandidates, inMinutes, cueMinutes };
  }
  return null;
}

/**
 * Sözün son anı (dakika cinsinden, işletmenin yerel duvar saati): açık saat → aday saatlerden şimdiden sonraki ilki (yoksa yarın ilki);
 * göreli süre → şimdi + süre; gün dilimi ("yarın sabah" 10:00, "bu akşam" 19:00; bugünkü dilim geçmişse şimdi + 2 saat); "yarın" ipuçsuz →
 * yarın 12:00; hiçbiri → bugün şimdi + 2 saat. Döner: gün + "SS:DD" (ev sahibi onaylamadan önce değiştirebilir).
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
  if (p.cueMinutes !== null) {
    if (p.day === "tomorrow") return { day: "tomorrow", time: fmt(p.cueMinutes) };
    return p.cueMinutes > nowMinutes ? { day: "today", time: fmt(p.cueMinutes) } : inTwoHours();
  }
  if (p.day === "tomorrow") return { day: "tomorrow", time: "12:00" };
  return inTwoHours();
}

// ── B · Wi-Fi ────────────────────────────────────────────────────────────────

/** Şifre / ağ adı sözcüğünden sonra gelebilecek, değer OLMAYAN sözcükler ("şifre yanlış", "Wi-Fi adı yok", "password is wrong"). */
const NOT_A_VALUE =
  /^(?:yanlis|dogru|degisti|degistirildi|degismedi|degistirdim|guncellendi|asagida|asagidaki|yukarida|yukaridaki|nedir|ne|su|bu|kartta|kartin|duvarda|modemin|modemde|altinda|etikette|etiketteki|ekte|ektedir|ayni|aynidir|yazili|yaziyor|gonderdim|gonderildi|yok|var|gorunmuyor|bulunmuyor|wrong|correct|incorrect|below|above|attached|unchanged|on|the|is|was|changed|printed|written|same|not|missing)$/u;
/**
 * Değer biçimi (Haiku 10-12: "şifre değişmedi" / "şifre çalışmazsa" değer sanılıyordu): şifre en az bir RAKAM içerir; ağ adı rakam ya da
 * büyük harf ya da "-" / "_" içerir. Sözcük gibi görünen değer öneri üretmez (temkinli: kaçabilir, yanlış değer yazdırmaz) — İSTİSNA: açık
 * ":" / "=" ayracından sonra satırı / parçayı BİTİREN değer ("Şifre: lalehouse", "Ağ adı: Lale"); ardından sözcük gelirse ("Şifre: modemin
 * altında yazıyor") yine sayılmaz (Haiku 10-12 2. tur).
 */
const looksLikePassword = (v: string) => /\d/.test(v);
const looksLikeNetwork = (v: string) => /[\d\p{Lu}_-]/u.test(v);
/** Değerden sonra yalnız satır / metin sonu ya da noktalama → değer parçayı bitiriyor. */
const ENDS_SEGMENT = /^["'”»]?[ \t]*(?:$|[\n,;.!)])/u;

/**
 * Wi-Fi şifresi değeri (WPA: 8–63 karakter, boşluksuz). Türkçe / İngilizce: "Wi-Fi şifresi: X", "yeni şifre X", "password is now X".
 * ÖZGÜN metinde koşar (büyük-küçük harf korunur); Türkçe harfler sınıfla kabul edilir (katlama YOK — konum kayması olmasın).
 */
const PASSWORD_VALUE = new RegExp(
  `${NL}(?:[şs]ifre(?:si|miz|niz|yi|yı)?|parola(?:s[ıi]|y[ıi])?|password)${NR}\\s*(?:(?:yeni|art[ıi]k|now|is|olarak|ise|changed\\s+to)\\s*){0,3}(?<sep>[:=\\-–])?[*_~\`]*\\s*["'“”«]?(?<v>[^\\s"'“”»,;]{8,63})`,
  "iu",
);
/** Ağ adı (SSID): "Ağ adı: X", "Wi-Fi adı X", "ağ adımız X", "network name is X", "SSID: X". */
const NETWORK_VALUE = new RegExp(
  `${NL}(?:(?:a[ğg](?:[ıi]n)?|wi-?fi|kablosuz\\s+a[ğg])\\s+(?:ad[ıi](?:m[ıi]z|n[ıi]z)?|ismi)|network(?:\\s+name)?|ssid)${NR}\\s*(?:(?:is|now|art[ıi]k)\\s*){0,2}(?<sep>[:=\\-–])?[*_~\`]*\\s*["'“”«]?(?<v>[^\\s"'“”»,;]{2,32})`,
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
const squash = (t: string) => t.replace(/[^\S\n]+/g, " ").replace(/[*_~`]+(?=\s*[:=])/g, "");

/** Eşleşmeden geçerli değer (etiket Wi-Fi değilse / biçim tutmazsa null). */
function valueOf(m: RegExpMatchArray, t: string, field: "password" | "network"): string | null {
  const start = m.index ?? 0;
  if (NON_WIFI_LABEL.test(t.slice(Math.max(0, start - 24), start))) return null;
  const v = cleanValue(m.groups?.v);
  if (!v) return null;
  const min = field === "password" ? 8 : 2;
  if (v.length < min) return null;
  if (field === "password" ? looksLikePassword(v) : looksLikeNetwork(v)) return v;
  // Sözcük biçimli değer: yalnız açık ":" / "=" ayracı + parçayı bitiren değer (ağ adı en az 3 harf).
  const sep = m.groups?.sep;
  const relaxed = (sep === ":" || sep === "=") && (field === "password" || v.length >= 3) && ENDS_SEGMENT.test(t.slice(start + m[0].length));
  return relaxed ? v : null;
}

function wifiMatches(text: string, field: "password" | "network"): string[] {
  const t = squash(text);
  const re = new RegExp((field === "password" ? PASSWORD_VALUE : NETWORK_VALUE).source, "giu");
  const out: string[] = [];
  for (const m of t.matchAll(re)) {
    const v = valueOf(m, t, field);
    if (v) out.push(v);
  }
  return out;
}

/** Ev sahibinin metninden Wi-Fi şifresi / ağ adı (değer biçimi tutarsa; Wi-Fi olmayan etiket atlanır). Şifre BÜYÜK-KÜÇÜK harf korunur. */
export function extractWifiValues(text: string | null | undefined): { password: string | null; network: string | null } {
  if (typeof text !== "string" || text.length > 4_000) return { password: null, network: null };
  return { password: wifiMatches(text, "password")[0] ?? null, network: wifiMatches(text, "network")[0] ?? null };
}

/**
 * Metinde bu alan için KAÇ değer var (bilgi tabanı kaleminde ana ağ + misafir ağı gibi iki şifre → hangisinin değişeceği belirsiz →
 * öneri YOK — Haiku 10-12). Modem / kapı şifresi sayılmaz.
 */
export function wifiValueCount(text: string, field: "password" | "network"): number {
  return wifiMatches(text, field).length;
}

/** Değerin bilgi tabanı metninde AYNEN geçip geçmediği (şifre büyük-küçük harfe duyarlı; ağ adı duyarsız). */
export function kbContainsValue(kbContent: string, value: string, caseSensitive: boolean): boolean {
  return caseSensitive ? kbContent.includes(value) : kbContent.toLocaleLowerCase("tr").includes(value.toLocaleLowerCase("tr"));
}

/**
 * Bilgi tabanı metninde eski değeri yenisiyle değiştir: aynı kalıpla bulunan değer yerine yazılır; bulunamazsa satır olarak eklenir
 * ("Şifre: X" / "Ağ adı: X"). Saf — onaydan ÖNCE önizleme de bununla kurulur.
 */
export function applyWifiValue(kbContent: string, field: "password" | "network", value: string): string {
  const current = extractWifiValues(kbContent)[field];
  if (current === value) return kbContent;
  // YALNIZ ilk geçiş (aynı değer metinde başka bir yerde anlamlı olabilir — Haiku 10-12: `split/join` hepsini değiştiriyordu).
  if (current) {
    const i = kbContent.indexOf(current);
    if (i >= 0) return kbContent.slice(0, i) + value + kbContent.slice(i + current.length);
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
