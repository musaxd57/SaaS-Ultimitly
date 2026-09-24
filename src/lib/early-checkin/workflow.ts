// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — İŞ AKIŞI (09-24). Hassas istek ENGEL değil, doğrulama tetikleyicisi:
// kapı müsaitlik yüzünden kapandıysa ve tüm katmanlarda istenen TEK tür erken girişse bu akış olguları yükler,
// karar verir ve (onaylanabilirse) onay metnini KODDA kurar. Otomatik gönderim yalnız host kuralı "otomatik" iken
// ve kapının geri kalan tüm kontrolleri bu metinle yeniden geçerse olur (çağıran yapar). Aksi hâlde aynı karar
// host'a DOĞRULANMIŞ TASLAK + kontrol listesi olarak gösterilir.
// ---------------------------------------------------------------------------

import { stayRequestKinds, type AvailabilityPolicyOptions } from "@/lib/ai/availability-claims";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import {
  agreeRequestedTime,
  decideEarlyCheckin,
  type EarlyCheckinDecision,
  type EarlyCheckinFacts,
  type EarlyCheckinRule,
} from "./core";
import { loadEarlyCheckinFacts } from "./load";
import { earlyCheckinApprovalText, earlyCheckinLang, formatEarlyCheckinFee } from "./reply";

/** Anlama katmanında erken girişle birlikte cevabı etkilemeyen niyetler (tek konu sayılır). */
const SINGLE_TOPIC_INTENTS: ReadonlySet<string> = new Set(["early_checkin", "checkin_time", "greeting_thanks"]);

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
  if (kinds.size !== 1 || !kinds.has("early_checkin")) return null;
  try {
    const guard = args.policy.guard?.status === "ok" ? args.policy.guard.verdict : null;
    const loaded = await loadEarlyCheckinFacts({
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      reservationId: args.reservationId,
      now: args.now,
      requested: agreeRequestedTime([args.policy.understanding?.checkinTime, guard?.requestedCheckinTime]),
      singleIntent: singleTopicEarlyCheckin(args.understood),
    });
    if (!loaded) return null;
    const decision = decideEarlyCheckin(loaded.facts, loaded.rule);
    const draft = earlyCheckinApprovalText(decision, earlyCheckinLang(args.detectedLanguage), loaded.rule?.note ?? null);
    return { decision, rule: loaded.rule, facts: loaded.facts, draft };
  } catch {
    return null;
  }
}

/** Kanıt özeti (`kbEvidenceJson.ec`): yalnız kapalı-küme kodlar, metin/tutar YOK. */
export function earlyCheckinEvidenceOf(run: EarlyCheckinRun, autoSent: boolean): { s: string; f: string[]; a: "0" | "1" } {
  return { s: run.decision.status, f: [...run.decision.failed], a: autoSent ? "1" : "0" };
}

/** Host'a iş listesine düşen kısa not (otomatik onaydan sonra; ücret tahsili ve temizlik planı için). */
export function earlyCheckinHostNote(decision: EarlyCheckinDecision): string | null {
  if (decision.status !== "approvable" || !decision.approvedTime) return null;
  const fee = decision.fee ? ` · ücret ${formatEarlyCheckinFee(decision.fee, "tr")}` : "";
  return `Erken giriş ${decision.approvedTime} otomatik onaylandı${fee}.`;
}
