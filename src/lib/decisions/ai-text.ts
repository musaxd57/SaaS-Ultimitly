import "server-only";

import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { semanticApiKey, semanticTimeoutMs } from "@/lib/ai/semantic/config";
import { runStayChangeGuard } from "@/lib/ai/semantic/guard";
import type { StayGuardVerdict } from "@/lib/ai/semantic/stay-change";
import { replyCallParams } from "@/lib/ai";
import { isReasoningModel, layerReasoningEffort } from "@/lib/ai/model-family";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { ANTHROPIC_EFFORTS, anthropicApiKey, callAnthropicStructuredJson, isAnthropicModel, type AnthropicEffort } from "@/lib/ai/anthropic-structured";
import { reportError } from "@/lib/report-error";
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

/**
 * Yazıcının modeli + GÖNDERİLEN düşünme çabası (katman ayarı, 10-09 kurucu yokken karar #8): `AI_DECISION_TEXT_MODEL` /
 * `AI_DECISION_TEXT_REASONING_EFFORT`; boşken cevap modelinin ayarı (`replyCallParams`) BİREBİR. Çaba katman değişkeninden, yoksa
 * cevap modelinin çabasından; kapalı küme (tanınmayan = gönderilmez), yalnız reasoning modelinde gönderilir. Ölçerin koşu kimliği
 * (`tests/eval/run-meta.ts`) de bunu okur.
 */
export function decisionWriterCallParams(): { model: string; effort: string | null } {
  const model = process.env.AI_DECISION_TEXT_MODEL?.trim() || replyCallParams().model;
  // Kurucu 11-04 "Haikuya geçelim": `claude-` modeli Anthropic'e gider, ölçülen ayar düşünme KAPALI + çaba `low` (yalnız low / medium / high
  // seçilebilir; tanınmayan değer ölçülen değere düşer).
  if (isAnthropicModel(model)) {
    const asked = process.env.AI_DECISION_TEXT_REASONING_EFFORT?.trim();
    return { model, effort: (ANTHROPIC_EFFORTS as readonly string[]).includes(asked ?? "") ? (asked as string) : "low" };
  }
  const effort = layerReasoningEffort(process.env.AI_DECISION_TEXT_REASONING_EFFORT?.trim() || process.env.OPENAI_REASONING_EFFORT);
  return { model, effort: effort && isReasoningModel(model) ? effort : null };
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
  // Ölçüm 11-04 (Haiku kolu): "talebinizi onayladık" çıktı vetosunda yapay zekânın yapmadığı eylemi beyan etmek (`unverified_commitment`)
  // sayılıp metin şablona düşüyordu; edilgen "talebiniz onaylandı" geçer. Veto GEVŞETİLMEZ — yazıcı kararı edilgen bildirir.
  "- State the decision impersonally, as a fact about the request ('Erken giriş talebiniz onaylandı', 'Your early check-in is approved', 'mümkün değil'). Never write that you or 'we' approved, accepted, arranged or confirmed it ('onayladık', 'kabul ettik', 'ayarladık', 'we have approved').",
  // Ölçüm 11-04 (Haiku kolu): Fransızca "13h00" kod denetiminde saat sayılmadı (`time_missing`) → şablon. Saat biçimi girdidekiyle aynı.
  "- Use ONLY the facts in the input. Keep every time, date and amount exactly as given (same digits). Write every time with a colon exactly as in the input (13:00), in every language: never 13h00, 13h or 1 pm. Do not add any other number, date, time, price, discount or condition.",
  // Ölçüm 11-04 (Haiku kolu): eski "the previous guest checks out at a given time" ifadesi saati yazmaya izin gibi okundu ("Önceki misafirin
  // çıkışı 13:00 olarak beklenmektedir") — aşağıdaki "başka misafirin saatini yazma" kuralıyla çelişiyordu. Kod da tutar (`other_guest_time`).
  "- For a decline you may give ONE short reason, but only if the host's checklist states it and it concerns the guest's timing: cleaning still in progress / not finished, the previous guest has not checked out yet at that time, a new guest arrives the same day. Give the reason without any time. If no such reason is stated, give no reason. Never invent one.",
  "- The checklist is internal and written in Turkish for the host. Never copy or quote a checklist line. Never mention staff, tasks, settings, rules, automation, the checklist itself, other guests' names, or anything about the calendar beyond the reason above.",
  "- Never state another guest's times, requests or approvals (not 'the next guest arrives at 12:00', not 'another guest's early check-in was approved'): say only that the previous guest is still checking out / the apartment is being cleaned / a new guest arrives the same day.",
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
  // Ölçüm 11-04 (Haiku kolu, d-38): Türkçe kontrol listesinden sonra İngilizce misafire Türkçe yazdı (dil denetimi tuttu → şablon). Dil
  // girdinin SONUNDA bir kez daha söylenir.
  lines.push(`Write the whole message in ${LANGUAGE_NAMES[input.lang]}.`);
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

/**
 * Claude yazıcısının KALICI arızası alarmı (ajan turu 11-04, doğrulandı): anahtar yok ya da Anthropic isteği kalıcı reddetti (kimlik /
 * yetki / kredi / model adı — geçici olmayan HTTP hatası) → her karar metni sessizce onaylı şablona düşüyordu; kurucunun açtığı Haiku geçişi
 * fark edilmeden hiç çalışmayabilirdi. Metin YİNE şablondur (misafire giden değişmez); yalnız görünür olur. Geçici hata / zaman aşımı / kesik
 * çıktı tek seferlik sayılır, alarm vermez. `reportError` bağlam adıyla kısıtlanır (aynı bağlam 10 dk'da bir); hata metni anahtar ya da
 * yanıt gövdesi TAŞIMAZ.
 */
export const DECISION_WRITER_ANTHROPIC_ALARM = "decision-writer anthropic";

function template(input: DecisionTextFacts, why: DecisionDraftFallback, problems?: DecisionTextProblem[]): DecisionDraftResult {
  return { source: "template", text: decisionMessageText(input), why, ...(problems ? { problems } : {}) };
}

export async function draftDecisionMessage(input: DecisionDraftInput): Promise<DecisionDraftResult> {
  try {
    if (!decisionAiTextEnabled()) return template(input, "disabled");
    if (!decisionMessageText(input)) return template(input, "no_template");
    const apiKey = semanticApiKey();
    if (!apiKey) return template(input, "no_key");
    const { model, effort } = decisionWriterCallParams();
    // Yazıcı Claude ise kendi anahtarı gerekir (bekçi yine OpenAI anahtarıyla — ↑semanticApiKey); yoksa onaylı şablon.
    const claudeKey = isAnthropicModel(model) ? anthropicApiKey() : null;
    if (isAnthropicModel(model) && !claudeKey) {
      void reportError(
        DECISION_WRITER_ANTHROPIC_ALARM,
        new Error("AI_DECISION_TEXT_MODEL is a Claude model but ANTHROPIC_API_KEY is not set — decision messages use the approved template"),
      );
      return template(input, "no_key");
    }
    const res = claudeKey
      ? await callAnthropicStructuredJson({
          apiKey: claudeKey,
          model,
          system: DECISION_WRITER_SYSTEM_PROMPT,
          user: buildDecisionWriterInput(input),
          schema: WRITER_SCHEMA.schema,
          timeoutMs: semanticTimeoutMs(model),
          maxTokens: 1_000,
          effort: (effort ?? "low") as AnthropicEffort,
          fetchImpl: input.fetchImpl,
        })
      : await callStructuredJson({
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
    if (claudeKey && !res.ok && res.error === "http" && res.transient !== true) {
      void reportError(
        DECISION_WRITER_ANTHROPIC_ALARM,
        new Error("Anthropic rejected the decision-writer call (non-transient HTTP error: key, permission, credit or model) — decision messages use the approved template"),
      );
    }
    const raw = res.ok && res.data && typeof (res.data as { message?: unknown }).message === "string" ? (res.data as { message: string }).message.trim() : "";
    if (!raw) return template(input, "model_failed");
    const note = input.resolution === "approve" && input.kind === "early_checkin" ? input.note?.trim() : "";
    const text = note ? `${raw} ${note}` : raw;
    // Yazıcı kipi: kontrol listesinin saati (önceki / sonraki misafirin saati) taslakta geçemez — ev sahibinin kendi metni bu kısıtı taşımaz.
    const check = checkDecisionText(text, input, { writer: true });
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
