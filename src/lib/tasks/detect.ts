import { matchesIntentKeywords, detectRiskType, classifyFallback } from "@/lib/ai/fallback";
import { TASK_TYPE } from "@/lib/constants";

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

// Dedupe day-key timezone. Turkey-focused product; the org default is
// Europe/Istanbul. The key only buckets tasks by calendar day, so an exact
// per-org tz is unnecessary here.
const TZ = "Europe/Istanbul";

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

function firstHit(msg: string, words: string[]): string | null {
  for (const w of words) if (msg.includes(w)) return w;
  return null;
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

  // 2) Explicit physical breakage / fault → maintenance.
  const breakage = firstHit(msg, BREAKAGE_WORDS);
  if (breakage) {
    return { type: "maintenance", priority: "standard", topic: breakage, slaHours: 24 };
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

  // 4) Appliance/amenity complaint → maintenance. Reuses the existing safety-net
  //    "amenity" keywords (klima / buzdolabı / çamaşır makinesi / fırın / tv…).
  if (isComplaint && matchesIntentKeywords(message, "amenity")) {
    return { type: "maintenance", priority: "standard", topic: "cihaz/olanak", slaHours: 24 };
  }

  // 5) Cleanliness complaint → cleaning. Reuses the existing "cleaning" net.
  if (isComplaint && matchesIntentKeywords(message, "cleaning")) {
    return { type: "cleaning", priority: "standard", topic: "temizlik", slaHours: 12 };
  }

  return null;
}

export interface OperationalTaskData {
  type: OperationalTaskType;
  title: string;
  description: string;
  priority: "urgent" | "standard";
  dueAt: Date;
  dedupeKey: string;
}

/** Istanbul "YYYY-MM-DD" of an instant (Postgres-safe, en-CA yields ISO order). */
function dayKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * Build the persistable task fields from a detection. The title is PII-lean —
 * the type label + the matched topic keyword (an appliance/item word from the
 * guest's message, never their name); the full text goes into the description.
 */
export function buildOperationalTaskData(
  detected: DetectedTask,
  ctx: { propertyId: string; message: string; now?: Date },
): OperationalTaskData {
  const now = ctx.now ?? new Date();
  const label = TASK_TYPE.label(detected.type); // "Bakım" | "Eksik Eşya" | "Temizlik"
  return {
    type: detected.type,
    title: `${label}: ${detected.topic}`.slice(0, 200),
    description: ctx.message.slice(0, 500),
    priority: detected.priority,
    dueAt: new Date(now.getTime() + detected.slaHours * 3600_000),
    // Dedupe key includes the TOPIC, not just the type: a repeat of the SAME
    // issue on the same day collapses (guest re-sends "musluk akıtıyor"), but two
    // DISTINCT same-category problems ("klima bozuk" + "musluk akıtıyor", or
    // "havlu eksik" + "şampuan bitti") stay separate, each an actionable task.
    dedupeKey: `${ctx.propertyId}:${detected.type}:${detected.topic.replace(/\s+/g, "-")}:${dayKey(now)}`,
  };
}
