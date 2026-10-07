import "server-only";

import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { semanticApiKey, semanticTimeoutMs } from "@/lib/ai/semantic/config";
import { runStayChangeGuard } from "@/lib/ai/semantic/guard";
import type { StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { replyCallParams } from "@/lib/ai";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { decisionMessageText, formatDecisionDay, formatDecisionFee, type DecisionLang } from "./core";
import { checkDecisionText, type DecisionTextFacts, type DecisionTextProblem } from "./text-check";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR MESAJINI YAPAY ZEKÂ YAZAR (kurucu kararı 10-07, Sabah Kararları 62 h; anahtar
// `HOST_DECISION_AI_TEXT_ENABLED` VARSAYILAN KAPALI → bugünkü onaylı 7 dil şablonu).
//
// Ev sahibi Onayla / Reddet'i açınca taslak: doğal, gerekçeli, misafirin dilinde, 1–3 cümle. Yazıcının gördüğü YALNIZ karar kaydı +
// kartın kontrol listesi (misafirin metni yazıcıya GİTMEZ — talimat sokulamaz). Sonra:
//  1. KOD denetimi (`text-check.ts`): saat / gün / ücret karar kaydıyla eşleşmeli; söz, devir, "ev sahibinin kararı", "bilgim yok" yok.
//  2. Yön denetimi (bağımsız bekçi modeli): onay metni izin VERMELİ, ret metni REDDETMELİ; ret / ücretsiz onay fiyat söylemez, ücretli
//     onay yalnız kayıtlı tutarı söyler. Bekçi koşmadıysa / düştüyse taslak KULLANILMAZ (yön doğrulanamadı).
// Herhangi biri geçmezse onaylı şablon gelir (yedek ve doğrulama zemini, kurucu kararı 4) — ev sahibi her durumda görür ve düzenler.
// Asla fırlatmaz.
// ---------------------------------------------------------------------------

export function decisionAiTextEnabled(): boolean {
  return process.env.HOST_DECISION_AI_TEXT_ENABLED === "1";
}

export type DecisionDraftFallback =
  | "disabled"
  | "no_template"
  | "no_key"
  | "model_failed"
  | "check_failed"
  | "guard_failed"
  | "guard_disagrees";

export type DecisionDraftResult =
  | { source: "ai"; text: string }
  | { source: "template"; text: string | null; why: DecisionDraftFallback; problems?: DecisionTextProblem[] };

export interface DecisionDraftInput extends DecisionTextFacts {
  /** Talebin misafir mesajı — YALNIZ bekçiye (yönü doğrulamak için; bekçi kendi redaksiyonu ve ayraçlarıyla okur). */
  guestRequest: string | null;
  /** Mülkün standart giriş / çıkış saatleri (bekçi). */
  stayTimes: { checkIn: string | null; checkOut: string | null };
  fetchImpl?: typeof fetch;
}

const LANGUAGE_NAMES: Record<DecisionLang, string> = {
  tr: "Turkish",
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  ru: "Russian",
  ar: "Arabic",
};

export const DECISION_WRITER_SYSTEM_PROMPT = [
  "You write a short message from a short-term rental host to their guest. The host has ALREADY DECIDED on the guest's early check-in or late check-out request; the message tells the guest that decision.",
  "Rules:",
  "- Write in the language named in the input. 1 to 3 sentences, warm and natural, in the host's voice. No greeting line, no sign-off, no emojis.",
  "- Address the guest formally (siz, Sie, vous, usted, Вы, حضرتكم-level politeness). No well-wishes or filler ('enjoy your stay', 'I hope this helps', 'keyifli bir konaklama'), no feelings.",
  "- State the decision clearly and first. An approval says the guest can check in / check out at the decided time on the given day. A decline says it is not possible and gives the standard time.",
  "- Use ONLY the facts in the input. Keep every time, date and amount exactly as given (same digits). Do not add any other number, date, time, price, discount or condition.",
  "- For a decline you may give ONE short reason, but only if the host's checklist states it and it concerns the guest's timing: cleaning still in progress / not finished, the previous guest checks out at a given time, a new guest arrives the same day. If no such reason is stated, give no reason. Never invent one.",
  "- The checklist is internal and written in Turkish for the host. Never mention staff, tasks, settings, rules, automation, the checklist itself, other guests' names, or anything about the calendar beyond the reason above.",
  "- If an approval comes with a fee, state the fee exactly as given. Otherwise never mention money, fees, free of charge, or discounts.",
  "- Never say the decision is up to the host or anyone else, never say you will check, ask, confirm or get back, never say a message was forwarded or recorded.",
  "- Do not include the host's note; it is added after your message automatically.",
  "- A reference message with all the required facts is given. Do not copy its wording; write naturally, but keep its facts.",
  'Return JSON: {"message": "<the message>"}.',
].join("\n");

const WRITER_SCHEMA = {
  name: "host_decision_message",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { message: { type: "string" } },
    required: ["message"],
  },
};

/** Yazıcının kullanıcı içeriği — kod verisi; misafir metni YOK. */
export function buildDecisionWriterInput(input: DecisionTextFacts): string {
  const approve = input.resolution === "approve";
  const lines = [
    `Language: ${LANGUAGE_NAMES[input.lang]}`,
    `Request: ${input.kind === "early_checkin" ? "early check-in" : "late check-out"}`,
    `Decision: ${approve ? "APPROVED" : "DECLINED"}`,
    `Day: ${input.dayKey ? formatDecisionDay(input.dayKey, input.lang) : "(not given)"}`,
    `Time the guest asked for: ${normalizeHhmm(input.requestedTime) ?? "(not given)"}`,
    ...(approve ? [`Decided time: ${normalizeHhmm(input.time) ?? "(not given)"}`] : []),
    `Standard ${input.kind === "early_checkin" ? "check-in" : "check-out"} time: ${normalizeHhmm(input.standardTime) ?? "(not given)"}`,
  ];
  const fee = approve && input.kind === "early_checkin" && input.fee && input.fee.amount > 0 ? input.fee : null;
  lines.push(`Fee: ${fee ? formatDecisionFee(fee, input.lang) : "none"}`);
  if (input.checklist.length > 0) {
    lines.push("Host's checklist (internal, Turkish):", ...input.checklist.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 300)}`));
  }
  const reference = decisionMessageText({ ...input, note: null });
  lines.push(`Reference message: ${reference ?? "(none)"}`);
  return lines.join("\n");
}

/** Bekçinin hükmü karar yönüyle ve kayıtlı ücretle uyumlu mu. */
export function guardAgreesWithDecision(v: StayGuardVerdict, input: DecisionTextFacts): boolean {
  const fee = input.resolution === "approve" && input.kind === "early_checkin" && input.fee && input.fee.amount > 0 ? input.fee : null;
  if (input.resolution === "approve") {
    if (!v.replyGrantsChange || v.replyRefuses || v.replyDefersToHost) return false;
  } else if (v.replyGrantsChange || v.replyDefersToHost || !(v.replyRefuses || v.replyStatesCalendar)) {
    // Bekçinin "refuses" tanımı takvim sözü İÇERMEYEN reddir; gerekçeli ret ("önceki misafir 11:00'de çıkıyor") takvim sözüdür.
    return false;
  }
  if (!fee) return v.replyAmounts.length === 0 && !v.replyPriceTerms;
  return v.replyAmounts.every((a) => a.amount === fee.amount && (a.currency === null || a.currency === fee.currency));
}

function template(input: DecisionTextFacts, why: DecisionDraftFallback, problems?: DecisionTextProblem[]): DecisionDraftResult {
  return { source: "template", text: decisionMessageText(input), why, ...(problems ? { problems } : {}) };
}

export async function draftDecisionMessage(input: DecisionDraftInput): Promise<DecisionDraftResult> {
  try {
    if (!decisionAiTextEnabled()) return template(input, "disabled");
    if (!decisionMessageText(input)) return template(input, "no_template");
    const apiKey = semanticApiKey();
    if (!apiKey) return template(input, "no_key");
    const { model, effort } = replyCallParams();
    const res = await callStructuredJson({
      apiKey,
      model,
      system: DECISION_WRITER_SYSTEM_PROMPT,
      user: buildDecisionWriterInput(input),
      schema: WRITER_SCHEMA,
      timeoutMs: semanticTimeoutMs(model),
      maxTokens: 400,
      maxCompletionTokens: 4_000,
      ...(effort ? { reasoningEffort: effort } : {}),
      fetchImpl: input.fetchImpl,
    });
    const raw = res.ok && res.data && typeof (res.data as { message?: unknown }).message === "string" ? (res.data as { message: string }).message.trim() : "";
    if (!raw) return template(input, "model_failed");
    const note = input.resolution === "approve" && input.kind === "early_checkin" ? input.note?.trim() : "";
    const text = note ? `${raw} ${note}` : raw;
    const check = checkDecisionText(text, input);
    if (!check.ok) return template(input, "check_failed", check.problems);
    const guard = await runStayChangeGuard({
      guestMessages: [input.guestRequest],
      reply: text,
      stayTimes: input.stayTimes,
      fetchImpl: input.fetchImpl,
    });
    if (!guard || guard.status !== "ok") return template(input, "guard_failed");
    if (!guardAgreesWithDecision(guard.verdict, input)) return template(input, "guard_disagrees");
    return { source: "ai", text };
  } catch {
    return template(input, "model_failed");
  }
}
