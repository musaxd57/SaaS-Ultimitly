import {
  matchesIntentKeywords,
  detectRiskType,
  classifyFallback,
  firstBreakdownDevice,
  isBreakdownDeviceName,
  reportsDeviceFault,
} from "@/lib/ai/fallback";
import { TASK_TYPE } from "@/lib/constants";
import { hitIsReported, isInquiryOnly, mentionsGuestOwnedItem, splitClauses } from "./report-reading";

// Smart operational-task routing (Faz A). Turns an escalating guest message into
// an ACTIONABLE task (maintenance / restock / cleaning) instead of only flagging
// the conversation "problem". It REUSES the AI classification the caller already
// computed (intent / riskType) and adds two SMALL, TASK-TRIAGE-ONLY word nets
// (breakage, restock) for physical signals the safety net does not classify.
//
// ⚠️ These nets are DELIBERATELY separate from the AI safety gate and the golden
// set. They answer a different question — "does this need a physical action?" —
// not "is this risky / should the AI auto-reply?". Keeping them apart means a
// safety-gate tweak never silently reroutes tasks, and a task-net tweak never
// weakens the gate. Do NOT wire these into passesAutoReplySafetyGate.

// Dedupe day-key timezone: the ORG's zone (caller passes it; default stays
// Europe/Istanbul). The key buckets tasks by the host's calendar day, so an
// org abroad gets its own local-day collapse window.
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export type OperationalTaskType = "maintenance" | "restock" | "cleaning";

export interface DetectedTask {
  type: OperationalTaskType;
  priority: "urgent" | "standard";
  /** Short, PII-free topic word for the title (a matched keyword, never a name). */
  topic: string;
  /** Hours from "now" until the task is due (SLA). */
  slaHours: number;
}

// Physical breakage / fault → maintenance. Fault words + the leak/clog/no-power
// phrasings guests actually use. TR (with ASCII-folded variants) + EN.
const BREAKAGE_WORDS = [
  "bozuk", "bozulmuş", "bozulmus", "arıza", "ariza", "arızalı", "arizali",
  "çalışmıyor", "calismiyor", "çalışmadı", "calismadi", "akıtıyor", "akitiyor",
  "su akıyor", "su akiyor", "sızıntı", "sizinti", "sızıyor", "siziyor",
  "tıkalı", "tikali", "tıkandı", "tikandi", "kırık", "kirik", "kırıldı",
  "kirildi", "patladı", "patladi", "yanmıyor", "yanmiyor", "ısınmıyor",
  "isinmiyor", "soğutmuyor", "sogutmuyor", "açılmıyor", "acilmiyor",
  "kapanmıyor", "kapanmiyor", "kaçak", "kacak", "elektrik yok", "su yok",
  "sıcak su yok", "sicak su yok", "duş akmıyor", "dus akmiyor",
  "broken", "not working", "doesn't work", "does not work", "won't turn on",
  "wont turn on", "leaking", "leak", "clogged", "no hot water", "no water",
  "no electricity", "no power", "out of order",
];

// Consumable missing / depleted → restock. Fires only on an ITEM *and* a LACK
// signal together, so a plain "where are the towels?" question does not trigger.
const RESTOCK_ITEMS = [
  "havlu", "şampuan", "sampuan", "sabun", "tuvalet kağıdı", "tuvalet kagidi",
  "peçete", "pecete", "deterjan", "çöp poşeti", "cop poseti", "kahve", "çay",
  "cay", "şeker", "seker", "mendil", "duş jeli", "dus jeli",
  "towel", "shampoo", "soap", "toilet paper", "toilet roll", "napkin",
  "detergent", "trash bag", "coffee", "tea",
];
const RESTOCK_LACK = [
  "eksik", "bitmiş", "bitmis", "bitti", "kalmamış", "kalmamis", "kalmadı",
  "kalmadi", "tükendi", "tukendi", "yok", "lazım", "lazim", "gerekiyor",
  "out of", "ran out", "missing", "need more", "no more", "empty",
];

/**
 * İngilizce sözcükler yalnız TAM sözcük + İngilizce çekim eki (-s / -es / -ing / -ed); Türkçe (ve ASCII'ye katlanmış Türkçe) sözcükler
 * sözcük BAŞINDA, ek serbest ("havlular", "bozulmuş"). 15 ajan A11 (10-01, ölçüldü): ham `includes` "Our team ran out of patience"
 * mesajından "Eksik Eşya: tea", "steakhouse"tan "tea", "bleak"ten "Bakım: leak" görevi açıyordu.
 */
const ENGLISH_TASK_WORDS: ReadonlySet<string> = new Set([
  "broken", "not working", "doesn't work", "does not work", "won't turn on", "wont turn on", "leaking", "leak", "clogged",
  "no hot water", "no water", "no electricity", "no power", "out of order",
  "towel", "shampoo", "soap", "toilet paper", "toilet roll", "napkin", "detergent", "trash bag", "coffee", "tea",
  "out of", "ran out", "missing", "need more", "no more", "empty",
]);
const WORD_RE = new Map<string, RegExp>();
function wordRe(w: string): RegExp {
  let re = WORD_RE.get(w);
  if (!re) {
    const body = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = ENGLISH_TASK_WORDS.has(w)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?:s|es|ing|ed)?(?![\\p{L}\\p{N}])`, "u")
      : new RegExp(`(?<![\\p{L}\\p{N}])${body}`, "u");
    WORD_RE.set(w, re);
  }
  return re;
}

function firstHit(msg: string, words: string[]): string | null {
  for (const w of words) if (wordRe(w).test(msg)) return w;
  return null;
}

const WORD_RE_GLOBAL = new Map<string, RegExp>();
/** Arıza sözcüğünün BİLDİRİLMİŞ (olumsuzlanmamış / koşul olmayan) ilk geçişi ve konumu; yoksa null (kurucu D4). */
function firstReportedBreakage(msg: string): { word: string; index: number } | null {
  for (const w of BREAKAGE_WORDS) {
    let re = WORD_RE_GLOBAL.get(w);
    if (!re) {
      re = new RegExp(wordRe(w).source, "gu");
      WORD_RE_GLOBAL.set(w, re);
    }
    re.lastIndex = 0;
    for (let m = re.exec(msg); m; m = re.exec(msg)) {
      if (hitIsReported(msg, m.index, m.index + m[0].length)) return { word: w, index: m.index };
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return null;
}

/**
 * ARIZANIN YERİ (Haiku 10-15): konu ve "misafirin kendi eşyası mı?" kontrolü arızanın GEÇTİĞİ cümlecikten okunur, mesajın ilk cihazından değil
 * — "Klima bozuk değil, musluk akmıyor" → musluk (eskiden klima; tekilleştirme anahtarı da gerçek bir klima arızasıyla birleşiyordu);
 * "Valizleri getirdik, mutfak musluğu bozuldu" → musluk (eskiden "getirdik" bütün mesajı misafir eşyası sayıyordu). Cümlecikte cihaz yoksa
 * (cihaz ile fiil ayrı cümleciklerde: "Klimayı açtık, bozuldu") bütün mesaja düşülür. `clauses` küçük harfli / örtülü metnin cümlecikleri;
 * aynı sırada asıl metnin cümleciklerine eşlenir (noktalama değişmez).
 */
function siteOfClause(
  message: string,
  originalClauses: ReturnType<typeof splitClauses>,
  clauseIndex: number,
): { device: string | null; guestOwned: boolean } {
  const original = originalClauses[clauseIndex];
  const device = original ? firstBreakdownDevice(original.text) : null;
  if (original && device) return { device, guestOwned: mentionsGuestOwnedItem(original.text) };
  return { device: firstBreakdownDevice(message), guestOwned: mentionsGuestOwnedItem(message) };
}
function clauseIndexAt(text: string, index: number): number {
  const clauses = splitClauses(text);
  for (let k = clauses.length - 1; k >= 0; k--) if (clauses[k].start <= index) return k;
  return 0;
}
/** Cihaz arızası bildiren İLK cümlecik (en çok 64 cümlecik taranır — doğrusal tavan); yoksa bütün mesaj. */
const MAX_FAULT_CLAUSES = 64;
function deviceFaultSite(message: string, reportText: string): { device: string | null; guestOwned: boolean } {
  const clauses = splitClauses(reportText);
  const originals = splitClauses(message);
  for (let k = 0; k < Math.min(clauses.length, MAX_FAULT_CLAUSES); k++) {
    if (!reportsDeviceFault(clauses[k].text)) continue;
    const site = siteOfClause(message, originals, k);
    if (site.device) return site;
  }
  return { device: firstBreakdownDevice(message), guestOwned: mentionsGuestOwnedItem(message) };
}

/** Bildirilmemiş (olumsuzlanmış / koşul) arıza sözcüğü geçişleri boşlukla örtülmüş metin — sınıflandırıcı "bozuk değil"i şikâyet okumasın. */
function withoutUnreportedBreakage(msg: string): string {
  // Örtülecek aralıklar önce toplanır, metin TEK geçişte kurulur (geçiş başına yeniden kurmak "bozuk değil" × N'de karesel olurdu).
  const blank = new Uint8Array(msg.length);
  let any = false;
  for (const w of BREAKAGE_WORDS) {
    const re = WORD_RE_GLOBAL.get(w) ?? new RegExp(wordRe(w).source, "gu");
    WORD_RE_GLOBAL.set(w, re);
    re.lastIndex = 0;
    for (let m = re.exec(msg); m; m = re.exec(msg)) {
      if (!hitIsReported(msg, m.index, m.index + m[0].length)) {
        blank.fill(1, m.index, m.index + m[0].length);
        any = true;
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  if (!any) return msg;
  let out = "";
  for (let i = 0; i < msg.length; i++) out += blank[i] ? " " : msg[i];
  return out;
}

// Risk signals that are NOT physical operations — those escalate to the host via
// the conversation "problem" flag + email, never a maintenance/cleaning task.
const NON_OPERATIONAL_RISK = new Set([
  "prompt_injection",
  "review_threat",
  "platform_policy",
  "money_refund",
  "cancellation",
  "human_request",
  "discrimination",
]);

/**
 * Decide whether an inbound guest message warrants an operational task, and of
 * what kind. Returns null when there is no physical-operations signal (or the
 * message is a non-operational risk like refund / review-threat / cancellation).
 *
 * `ai` is the classification the caller already holds (avoids re-modeling); only
 * `intent` and `riskType` are read. `riskType` falls back to the deterministic
 * detector when the caller doesn't pass one.
 */
export function detectOperationalTask(
  message: string,
  ai: { intent?: string | null; riskType?: string | null } = {},
): DetectedTask | null {
  const msg = message.toLowerCase();
  const riskType = ai.riskType ?? detectRiskType(message);

  if (riskType && NON_OPERATIONAL_RISK.has(riskType)) return null;

  // 1) Safety emergency (gas / fire / lockout / injury) → urgent, tight SLA.
  if (riskType === "safety_emergency") {
    return { type: "maintenance", priority: "urgent", topic: "acil güvenlik", slaHours: 2 };
  }

  // KURUCU D4 (10-15): gerçek arıza bildirimi ile soru / varsayım / olumsuzlama AYRILIR — yalnız BAKIM kuralları (2, 3b, 4) için. Acil
  // güvenlik (1) ↑ bunlardan ÖNCE ve DEĞİŞMEDİ (şüphede acil). Konuşmanın şikâyet / devir kararı da değişmez (yalnız görev açılmaz).
  //  · Mesaj yalnız soru / varsayım / soru niyetiyse ("Su akmıyor mu acaba, gelmeden sormak istedim") → bakım görevi yok.
  //  · Arıza sözcüğü olumsuzlanmış ya da koşulsa ("Klima bozuk değil", "Kombi bozuksa ne yapmalıyız?") → o geçiş sayılmaz.
  // Öncelik / süre (24 sa) DEĞİŞMEDİ: kurucu "2/24 saat hedeflerini henüz kesinleştirme".
  // Soru sözcüklü cümlecik kendisi arıza anlatıyorsa ("…about the broken dishwasher?") soru sayılmaz.
  const inquiry = isInquiryOnly(message, (clause) => {
    const lower = clause.toLowerCase();
    return firstReportedBreakage(lower) !== null || reportsDeviceFault(withoutUnreportedBreakage(lower));
  });
  const reportText = withoutUnreportedBreakage(msg);

  // 2) Explicit physical breakage / fault → maintenance. Konu: arızanın geçtiği cümlecikteki cihaz (varsa), yoksa eşleşen sözcük. Misafirin
  //    KENDİ eşyası ("Getirdiğimiz kahve makinesi bozulmuş") bakım değildir — o cümlecikte "kendi / getirdiğimiz" varsa görev açılmaz.
  const breakage = inquiry ? null : firstReportedBreakage(msg);
  if (breakage) {
    const site = siteOfClause(message, splitClauses(message), clauseIndexAt(msg, breakage.index));
    if (!site.guestOwned) return { type: "maintenance", priority: "standard", topic: site.device ?? breakage.word, slaHours: 24 };
  }

  // 3) Consumable depletion → restock (item AND lack signal).
  const item = firstHit(msg, RESTOCK_ITEMS);
  if (item && firstHit(msg, RESTOCK_LACK)) {
    return { type: "restock", priority: "standard", topic: item, slaHours: 24 };
  }

  // Rules 4–5 reuse TOPIC nets (amenity / cleaning) that also match neutral
  // questions ("klima nasıl çalışır?", "havlular nerede?"). Those must only
  // become tasks when the message actually reads as a COMPLAINT — otherwise a
  // bare housekeeping question would spawn a task. (Rules 1–3 above are
  // inherently problems — an explicit fault / lack / safety word — so they fire
  // on their own.) `classifyFallback` gives the deterministic complaint verdict.
  const isComplaint = classifyFallback(message).isComplaint;
  const isReportedComplaint = !inquiry && (reportText === msg ? isComplaint : classifyFallback(reportText).isComplaint);

  // 3b) CİHAZ ARIZASI BİLDİRİMİ → bakım (kurucu D4, 10-15). Sınıflandırıcı "Kapının kilidi bozuldu", "Su akmıyor", "Musluktan su gelmiyor",
  //     "Sifon bozuldu" mesajlarını cihaz arızası olarak zaten tanıyor (şikâyet kararının iki cihaz bacağı); görev kuralı bakmıyordu. Cihaz
  //     envanteri ve koşul eki kuralı sınıflandırıcıyla ORTAK (yeni sözcük listesi yok). GENEL şikâyet + mesajda geçen cihaz adı YETMEZ
  //     (ölçüldü: "Merdivenlerde sigara kokusu var" → "merdiven", "I'll sue you" → "su" görevi açıyordu). Misafirin KENDİ eşyası
  //     ("Getirdiğimiz kahve makinesi bozuldu") dairenin bakımı değil. Konu cihaz adı (rakam / ad taşımaz).
  if (!inquiry && reportsDeviceFault(reportText)) {
    const site = deviceFaultSite(message, reportText);
    if (site.device && !site.guestOwned) return { type: "maintenance", priority: "standard", topic: site.device, slaHours: 24 };
  }

  // 4) Appliance/amenity complaint → maintenance. Reuses the existing safety-net
  //    "amenity" keywords (klima / buzdolabı / çamaşır makinesi / fırın / tv…).
  if (isReportedComplaint && !mentionsGuestOwnedItem(message) && matchesIntentKeywords(message, "amenity")) {
    return { type: "maintenance", priority: "standard", topic: "cihaz/olanak", slaHours: 24 };
  }

  // 5) Cleanliness complaint → cleaning. Reuses the existing "cleaning" net.
  if (isComplaint && matchesIntentKeywords(message, "cleaning")) {
    return { type: "cleaning", priority: "standard", topic: "temizlik", slaHours: 12 };
  }

  return null;
}

/** Mesajdan açılan bakım görevinin başlık eki (kurucu D4). Personel görünümü bu biçimi tanır (`staff-view.ts`). */
export const GUEST_REPORT_LABEL = "misafir bildirimi";

export interface OperationalTaskData {
  type: OperationalTaskType;
  title: string;
  description: string;
  priority: "urgent" | "standard";
  dueAt: Date;
  dedupeKey: string;
}

/** Org-local "YYYY-MM-DD" of an instant (Postgres-safe, en-CA yields ISO order). */
function dayKey(now: Date, tz: string): string {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Build the persistable task fields from a detection. The title is PII-lean —
 * the type label + the matched topic keyword (an appliance/item word from the
 * guest's message, never their name); the full text goes into the description.
 */
/** Tekilleştirme konusu: bakımda (acil güvenlik dışında) mesajdaki ilk cihaz; yoksa tespit edilen konu. */
function dedupeTopic(detected: DetectedTask, message: string): string {
  if (detected.type === "maintenance" && detected.priority !== "urgent") {
    // Konu zaten arızanın cümleciğindeki cihazsa o (Haiku 10-15: ilk cihaz değil); değilse mesajdaki ilk cihaz (eski kural).
    if (isBreakdownDeviceName(detected.topic)) return `cihaz:${detected.topic}`;
    const device = firstBreakdownDevice(message);
    if (device) return `cihaz:${device}`;
  }
  return detected.topic;
}

export function buildOperationalTaskData(
  detected: DetectedTask,
  ctx: { propertyId: string; message: string; now?: Date; timezone?: string },
): OperationalTaskData {
  const now = ctx.now ?? new Date();
  const tz = ctx.timezone ?? DEFAULT_TIMEZONE;
  const label = TASK_TYPE.label(detected.type); // "Bakım" | "Eksik Eşya" | "Temizlik"
  return {
    type: detected.type,
    // Bakım başlığı "misafir bildirimi" der (kurucu D4: "doğrulanmış arıza gibi yazma"); eşya / temizlik başlığı değişmedi.
    title: (detected.type === "maintenance" ? `${label} — ${GUEST_REPORT_LABEL}: ${detected.topic}` : `${label}: ${detected.topic}`).slice(0, 200),
    description: ctx.message.slice(0, 500),
    priority: detected.priority,
    dueAt: new Date(now.getTime() + detected.slaHours * 3600_000),
    // Dedupe key includes the TOPIC, not just the type: a repeat of the SAME
    // issue on the same day collapses (guest re-sends "musluk akıtıyor"), but two
    // DISTINCT same-category problems ("klima bozuk" + "musluk akıtıyor", or
    // "havlu eksik" + "şampuan bitti") stay separate, each an actionable task.
    // 🚨 Bakımda konu CİHAZDIR, belirti değil (kurucu 10-15, ölçüldü): "Klima bozuk" ile "Musluk bozuk" ikisi de "bozuk" konusuna düşüp
    // aynı gün TEK görevde birleşiyordu — ikinci arıza kayboluyordu; "Klima bozuk" ile "Klima yine bozuldu" ise ayrı konuya düşüp iki görev
    // açıyordu. Cihaz bulunamazsa eski konu kullanılır; acil güvenlik ayrı kalır. (Başlık kurucu D4 ile "Bakım — misafir bildirimi: <cihaz>".)
    dedupeKey: `${ctx.propertyId}:${detected.type}:${dedupeTopic(detected, ctx.message).replace(/\s+/g, "-")}:${dayKey(now, tz)}`,
  };
}
