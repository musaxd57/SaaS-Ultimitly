// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — İŞ AKIŞI (09-24). Hassas istek ENGEL değil, doğrulama tetikleyicisi:
// kapı müsaitlik yüzünden kapandıysa ve tüm katmanlarda istenen TEK tür erken girişse bu akış olguları yükler,
// karar verir ve (onaylanabilirse) onay metnini KODDA kurar. Otomatik gönderim yalnız host kuralı "otomatik" iken
// ve kapının geri kalan tüm kontrolleri bu metinle yeniden geçerse olur (çağıran yapar). Aksi hâlde aynı karar
// host'a DOĞRULANMIŞ TASLAK + kontrol listesi olarak gösterilir.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { stayRequestKinds, type AvailabilityPolicyOptions, type StayRequestKind } from "@/lib/ai/availability-claims";
import { durableOutboxEnabled } from "@/lib/outbox/flag";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import {
  agreeRequestedTime,
  decideEarlyCheckin,
  type EarlyCheckinDecision,
  type EarlyCheckinFacts,
  type EarlyCheckinRule,
} from "./core";
import { UNDERSTANDING_WINDOW } from "@/lib/ai/semantic/understand";
import { GUARD_WINDOW } from "@/lib/ai/semantic/guard";
import { loadEarlyCheckinFacts } from "./load";
import { earlyCheckinApprovalText, earlyCheckinLang } from "./reply";
import { mentionsAnotherDay, timeMismatchInTexts } from "./text-checks";
import type { EarlyCheckinAutoBlocker } from "./core";

/** İki model katmanının ORTAK penceresi: bundan fazla / uzun cevapsız mesajın bir kısmı modellerce görülmedi. */
const MODEL_WINDOW = {
  maxMessages: Math.min(UNDERSTANDING_WINDOW.maxMessages, GUARD_WINDOW.maxMessages),
  messageCap: Math.min(UNDERSTANDING_WINDOW.messageCap, GUARD_WINDOW.messageCap),
};

/**
 * Otomatik gönderimi engelleyen metin koşulları (saf; `core.ts` `autoBlockers`). YALNIZ engeller: taslak yine hazırlanır.
 */
export function earlyCheckinAutoBlockers(args: {
  guestTexts: readonly string[];
  requestedTime: string | null;
  now: Date;
  timeZone: string;
  /** Teslim kalıcı kuyruktan mı (bayrak) — kuyruk onayı yeniden doğrulamadığı için otomatik onay yok. */
  queuedDelivery?: boolean;
}): EarlyCheckinAutoBlocker[] {
  const out: EarlyCheckinAutoBlocker[] = [];
  if (args.queuedDelivery) out.push("queued_delivery");
  if (mentionsAnotherDay(args.guestTexts, args.now, args.timeZone)) out.push("day_unverified");
  if (args.guestTexts.length > MODEL_WINDOW.maxMessages || args.guestTexts.some((t) => t.length > MODEL_WINDOW.messageCap)) {
    out.push("not_fully_read");
  }
  if (timeMismatchInTexts(args.guestTexts, args.requestedTime)) out.push("time_mismatch_text");
  return out;
}

/** Anlama katmanında erken girişle birlikte cevabı etkilemeyen niyetler (tek konu sayılır). */
const SINGLE_TOPIC_INTENTS: ReadonlySet<string> = new Set(["early_checkin", "checkin_time", "greeting_thanks"]);

/**
 * Cevap modelinin kendi niyet etiketi de konuyu erken giriş / giriş olarak görmeli (inceleme 09-24, P1-2): tek konu
 * yalnız anlama katmanına bırakılırsa, o katmanın kaçırdığı "insanla görüşmek istiyorum" gibi bir ikinci istek
 * onayın arkasında kaybolur. Etiket başka bir şeyse (insan talebi, şikâyet, …) cevap host'a taslak kalır.
 */
const REPLY_TOPIC_INTENTS: ReadonlySet<string> = new Set(["early_checkin", "checkin"]);

export interface EarlyCheckinRun {
  decision: EarlyCheckinDecision;
  rule: EarlyCheckinRule | null;
  /** Host panelinin gösterdiği olgular (kimlik/metin yok; saatler ve durumlar). */
  facts: EarlyCheckinFacts;
  /** Onaylanabilirse koddan kurulan onay metni (misafirin dilinde); aksi hâlde `null`. */
  draft: string | null;
  /** Karar kaydı için dayanaklar (kimlik + an + kural sürümü; metin/tutar/PII YOK). */
  trace?: EarlyCheckinTrace;
}

/** "Neden evet/hayır dedi" sonradan kurulabilsin: hangi devir, hangi "hazır" kaydı, hangi kural sürümü. */
export interface EarlyCheckinTrace {
  referenceId: string | null;
  readyMarkId: string | null;
  readyAt: Date | null;
  ruleHash: string | null;
}

/** Kuralın içerik parmak izi (12 hex): kural sonradan değişirse kayıttaki karar hangi sürüme dayandığını gösterir. */
export function earlyCheckinRuleHash(rule: EarlyCheckinRule | null): string | null {
  if (!rule) return null;
  return createHash("sha256").update(JSON.stringify(rule)).digest("hex").slice(0, 12);
}

/** Anlama katmanı cevapsız mesajlarda YALNIZ erken giriş (± giriş saati sorusu / selam) gördüyse true. */
export function singleTopicEarlyCheckin(understood: MessageUnderstanding | null | undefined): boolean {
  if (!understood || !Array.isArray(understood.requests) || understood.requests.length === 0) return false;
  return understood.requests.some((r) => r.intent === "early_checkin") && understood.requests.every((r) => SINGLE_TOPIC_INTENTS.has(r.intent));
}

/**
 * Akış uygulanabilir mi: tüm katmanların gördüğü istek türü TEK ve erken giriş. Değilse `null` (çağıran bugünkü
 * yola — insana — devam eder). Uygulanabilirse olguları yükler ve karar verir; hata fırlatmaz (hata = `null`).
 */
export async function runEarlyCheckinWorkflow(args: {
  organizationId: string;
  propertyId: string;
  reservationId: string | null;
  now: Date;
  guestTexts: readonly string[];
  policy: AvailabilityPolicyOptions;
  understood: MessageUnderstanding | null | undefined;
  detectedLanguage: string | null | undefined;
}): Promise<EarlyCheckinRun | null> {
  const kinds = stayRequestKinds(args.guestTexts, args.policy);
  // Anlama katmanının istek LİSTESİNDEKİ konaklama niyetleri de türe sayılır (inceleme 09-24: yuva tek tür taşır).
  for (const r of args.understood?.requests ?? []) {
    const k = UNDERSTOOD_STAY_KIND[r.intent];
    if (k) kinds.add(k);
  }
  if (kinds.size !== 1 || !kinds.has("early_checkin")) return null;
  try {
    const guard = args.policy.guard?.status === "ok" ? args.policy.guard.verdict : null;
    const u = args.policy.understanding;
    // Saat kaynağı yalnız o model erken giriş İSTEĞİ gördüyse sayılır ("istek yok" diyen modelin saati kanıt değildir).
    const understoodTime = u && u.requested && u.kind === "early_checkin" ? u.checkinTime : null;
    const guardTime = guard && guard.guestRequestsChange && guard.kind === "early_checkin" ? guard.requestedCheckinTime : null;
    const replyTopic = REPLY_TOPIC_INTENTS.has(args.policy.replyIntent ?? "");
    const requested = agreeRequestedTime([understoodTime, guardTime]);
    const loaded = await loadEarlyCheckinFacts({
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      reservationId: args.reservationId,
      now: args.now,
      requested,
      singleIntent: singleTopicEarlyCheckin(args.understood) && replyTopic,
    });
    if (!loaded) return null;
    // Bavul bırakma/alma isteği erken giriş onayıyla cevaplanamaz (üç istem bavulu erken girişe katlıyor — inceleme 09-24).
    loaded.facts.luggage = (args.understood?.requests ?? []).some((r) => r.intent === "luggage");
    loaded.facts.autoBlockers = earlyCheckinAutoBlockers({
      guestTexts: args.guestTexts,
      requestedTime: requested.time,
      now: args.now,
      timeZone: loaded.timeZone,
      queuedDelivery: durableOutboxEnabled(),
    });
    const decision = decideEarlyCheckin(loaded.facts, loaded.rule);
    const draft = earlyCheckinApprovalText(decision, earlyCheckinLang(args.detectedLanguage), loaded.rule?.note ?? null, loaded.facts.todayKey);
    const trace: EarlyCheckinTrace = {
      referenceId: loaded.referenceId,
      readyMarkId: loaded.readyMark?.id ?? null,
      readyAt: loaded.readyMark?.at ?? null,
      ruleHash: earlyCheckinRuleHash(loaded.rule),
    };
    return { decision, rule: loaded.rule, facts: loaded.facts, draft, trace };
  } catch {
    return null;
  }
}

/** Anlama katmanı istek niyeti → konaklama değişikliği türü (yalnız takvime bağlı olanlar). */
const UNDERSTOOD_STAY_KIND: Readonly<Record<string, StayRequestKind>> = {
  early_checkin: "early_checkin",
  late_checkout: "late_checkout",
  extend_stay: "extend",
  date_change: "date_change",
  availability: "availability",
};

/** Karar kaydının `ec` alanı (`grounding.ts` yeniden doğrular). */
export interface EarlyCheckinEvidence {
  s: string;
  f: string[];
  a: "0" | "1";
  /** Hazırlığın ölçüldüğü devrin rezervasyon kimliği. */
  dr?: string;
  /** Hazır hükmünü veren "bitti" kaydının kimliği ve anı (dakika). */
  rm?: string;
  rt?: string;
  /** Kural içerik parmak izi. */
  rh?: string;
  /** İstenen saati okuyan model sayısı ("0" | "1" | "2"). */
  n?: string;
  /** Hazırlık çıkıştan önceki kanıtlı işarete dayandı → önceki misafirin çıkışı doğrulandı. */
  dc?: "1";
}

/**
 * Kanıt özeti (`kbEvidenceJson.ec`): kapalı-küme kodlar + dayanak KİMLİKLERİ, zaman damgası ve kural sürümü (kanıt
 * modeli U). Saat / tutar / metin / PII YOK — onaylanan saat ve tutar giden mesajdadır.
 */
export function earlyCheckinEvidenceOf(run: EarlyCheckinRun, autoSent: boolean): EarlyCheckinEvidence {
  const t = run.trace;
  return {
    s: run.decision.status,
    f: [...run.decision.failed],
    a: autoSent ? "1" : "0",
    ...(t?.referenceId ? { dr: t.referenceId } : {}),
    ...(t?.readyMarkId ? { rm: t.readyMarkId } : {}),
    ...(t?.readyAt ? { rt: `${t.readyAt.toISOString().slice(0, 16)}Z` } : {}),
    ...(t?.ruleHash ? { rh: t.ruleHash } : {}),
    n: String(Math.min(2, Math.max(0, run.facts.requested.sources))),
    ...(run.facts.departureConfirmed ? { dc: "1" as const } : {}),
  };
}

/**
 * Giriş hazırlığı görevine düşen kısa not (otomatik onaydan sonra; temizlik planı için). Ücret TUTARI YOK: görev
 * geçmişini temizlik de görür (kurucu: temizlikçi paraya dokunmaz, görmez). Ücret misafire giden mesajdadır.
 * (Kuyruklu teslimde otomatik onay yok — `queued_delivery` — bu yüzden "gönderime alındı" notu da yok.)
 */
export function earlyCheckinHostNote(decision: EarlyCheckinDecision): string | null {
  if (decision.status !== "approvable" || !decision.approvedTime) return null;
  return `Erken giriş ${decision.approvedTime} otomatik onaylandı.`;
}
