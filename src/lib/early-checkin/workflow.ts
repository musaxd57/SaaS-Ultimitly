// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — İŞ AKIŞI (09-24). Hassas istek ENGEL değil, doğrulama tetikleyicisi:
// kapı müsaitlik yüzünden kapandıysa ve tüm katmanlarda istenen TEK tür erken girişse bu akış olguları yükler,
// karar verir ve (onaylanabilirse) onay metnini KODDA kurar. Otomatik gönderim yalnız host kuralı "otomatik" iken
// ve kapının geri kalan tüm kontrolleri bu metinle yeniden geçerse olur (çağıran yapar). Aksi hâlde aynı karar
// host'a DOĞRULANMIŞ TASLAK + kontrol listesi olarak gösterilir.
// ---------------------------------------------------------------------------

import { stayRequestKinds, type AvailabilityPolicyOptions, type StayRequestKind } from "@/lib/ai/availability-claims";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import {
  agreeRequestedTime,
  decideEarlyCheckin,
  type EarlyCheckinDecision,
  type EarlyCheckinFacts,
  type EarlyCheckinRule,
} from "./core";
import { loadEarlyCheckinFacts } from "./load";
import { earlyCheckinApprovalText, earlyCheckinLang } from "./reply";

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
    const loaded = await loadEarlyCheckinFacts({
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      reservationId: args.reservationId,
      now: args.now,
      requested: agreeRequestedTime([understoodTime, guardTime]),
      singleIntent: singleTopicEarlyCheckin(args.understood) && replyTopic,
    });
    if (!loaded) return null;
    const decision = decideEarlyCheckin(loaded.facts, loaded.rule);
    const draft = earlyCheckinApprovalText(decision, earlyCheckinLang(args.detectedLanguage), loaded.rule?.note ?? null, loaded.facts.todayKey);
    return { decision, rule: loaded.rule, facts: loaded.facts, draft };
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

/** Kanıt özeti (`kbEvidenceJson.ec`): yalnız kapalı-küme kodlar, metin/tutar YOK. */
export function earlyCheckinEvidenceOf(run: EarlyCheckinRun, autoSent: boolean): { s: string; f: string[]; a: "0" | "1" } {
  return { s: run.decision.status, f: [...run.decision.failed], a: autoSent ? "1" : "0" };
}

/**
 * Giriş hazırlığı görevine düşen kısa not (otomatik onaydan sonra; temizlik planı için). Ücret TUTARI YOK: görev
 * geçmişini temizlik de görür (kurucu: temizlikçi paraya dokunmaz, görmez). Ücret misafire giden mesajdadır.
 * Kuyruk yolunda teslim henüz doğrulanmadı → "gönderime alındı".
 */
export function earlyCheckinHostNote(decision: EarlyCheckinDecision, queued = false): string | null {
  if (decision.status !== "approvable" || !decision.approvedTime) return null;
  return queued
    ? `Erken giriş ${decision.approvedTime} için onay mesajı gönderime alındı.`
    : `Erken giriş ${decision.approvedTime} otomatik onaylandı.`;
}
