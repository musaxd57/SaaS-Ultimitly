import "server-only";
import { REPLY_SYSTEM_PROMPT, buildReplyPrompt } from "./prompts";
import { suggestReplyFallback, classifyFallback } from "./fallback";
import { timeStatedInMessage } from "./stated-time";
import type { ClassifyResult, LlmUsage, SuggestReplyInput, SuggestReplyResult } from "./types";
import { auditClaimsSafe } from "./claim-support";
import { parseStayChangeDeclaration } from "./semantic/stay-change";
import type { Priority } from "@/lib/constants";
import { DEFAULT_OPENAI_MODEL, isReasoningModel } from "./model-family";
import { reportError } from "@/lib/report-error";
import {
  classifyModelProviderFailure,
  noteModelProviderPersistentFailure,
  noteModelProviderSuccess,
} from "./provider-health";

export type { SuggestReplyInput, SuggestReplyResult, ClassifyResult } from "./types";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** Kapalı riskLevel kümesi — parser YALNIZ bunlardan birini geçirir (F01). */
const RISK_LEVELS = ["none", "low", "medium", "high"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];
/** Host'a gösterilen sebep: modelin güvenlik alanları geçerli değildi (F01). */
const SCHEMA_VIOLATION_RISK_NOTE =
  "Model yanıtı güvenlik alanlarını (riskLevel/confidence) geçerli biçimde taşımadı — şema ihlali; otomatik gönderilmedi, insan incelemesi gerekir.";

// The 14 intents the prompt defines. The auto-send gate works with an intent
// BLOCKLIST, so a novel/unknown intent string from the model would sail past
// it — clamp unknowns to "general" AND cap their confidence below the 0.75
// auto-send floor, so an off-taxonomy answer can never be sent unreviewed.
/** The closed riskType label set (WHY risky). A LABEL only — the send decision
 * stays in code; the gate may tighten on these but never loosen. Unknown model
 * output clamps to null so a novel label can never carry meaning downstream.
 * SINGLE SOURCE: defined in risk-events.ts (the persistence layer that also feeds
 * shadow-ai's clamp) and re-exported here so the two can never drift apart. */
import { RISK_TYPES } from "@/lib/risk-events";
export { RISK_TYPES };

/**
 * Evidence claims are VERIFIED against the actual request context — the model
 * can only cite a kb category / property field / reservation / history that
 * really existed in its input. Unverifiable claims are silently dropped, so
 * the UI never presents an invented source as fact.
 */
function verifyUsedSources(list: string[], input: SuggestReplyInput): string[] {
  const kbCats = new Set(input.knowledgeBase.map((k) => k.category));
  return list.filter((src) => {
    if (src.startsWith("kb:")) return kbCats.has(src.slice(3));
    if (src === "property:address") return Boolean(input.property.address);
    if (src.startsWith("property:")) {
      // Whitelist the REAL property fields — a blanket `true` let the model inject
      // a fabricated source (e.g. "property:door_code") that then showed as a
      // "used context" chip, contradicting the invented-source-dropped guarantee.
      const field = src.slice("property:".length);
      return field === "checkInTime" || field === "checkOutTime" || field === "name" || field === "city";
    }
    if (src.startsWith("reservation:")) {
      // Whitelist the REAL reservation-context fields (same rationale as the
      // property:* whitelist): the model sees guestName / arrivalDate /
      // departureDate / status — any other suffix ("reservation:door_code") is
      // an invented source and must drop.
      const field = src.slice("reservation:".length);
      return (
        input.reservation != null &&
        (field === "guestName" || field === "arrivalDate" || field === "departureDate" || field === "status")
      );
    }
    // "history" also covers the host style guide BY CONTRACT — the prompt says
    // facts taken from EV SAHİBİ REHBERİ are tagged "history" too.
    if (src === "history") return Boolean(input.history && input.history.length > 0) || Boolean(input.styleProfile);
    return false; // unknown shape → drop
  });
}

/** Max evidence entries / entry length — the model must never flood the DB/UI. */
function sanitizeStringList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => x.trim().slice(0, maxLen));
}

const KNOWN_INTENTS = new Set([
  "complaint", "refund", "early_checkin", "late_checkout", "early_departure",
  "human_request", "checkin", "checkout", "wifi", "parking", "location",
  "cleaning", "amenity", "general",
]);

// Re-exported so existing importers keep working; the predicate itself lives in a
// leaf module (see model-family.ts) because request-body shaping is needed by
// callers that must not depend on this module.
export { isReasoningModel } from "./model-family";

/** The model used for the main guest-reply generation. */
function replyModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

/** Normalize a model-returned language value to a short code (2–3 letters), else
 *  "und" (BCP-47 "undetermined") so garbage can't ride through as a real language. */
function normalizeLang(v: unknown): string {
  if (typeof v !== "string") return "und";
  const primary = v.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : "und";
}

/** "Anahtar yok" alarmının süreç-içi penceresi. ↓callOpenAI'daki gerekçe. */
let lastKeyMissingReportAt = 0;
const KEY_MISSING_REPORT_MS = 10 * 60_000;

/** Sayısal kullanım alanı: yalnız sonlu, negatif olmayan tamsayı (aksi hâlde yok = ölçülmedi). */
function usageInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** OpenAI `usage` → PII'siz kullanım özeti. Bozuk/eksik alan atlanır, asla fırlatmaz. */
export function parseLlmUsage(data: unknown): LlmUsage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as { usage?: Record<string, unknown>; model?: unknown };
  const u = d.usage;
  const out: LlmUsage = {};
  if (u && typeof u === "object") {
    const pt = usageInt(u.prompt_tokens);
    const ct = usageInt(u.completion_tokens);
    const cpt = usageInt((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
    const rt = usageInt((u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
    if (pt !== undefined) out.pt = pt;
    if (ct !== undefined) out.ct = ct;
    if (cpt !== undefined) out.cpt = cpt;
    if (rt !== undefined) out.rt = rt;
  }
  if (typeof d.model === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(d.model)) out.m = d.model;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function callOpenAI(system: string, user: string): Promise<{ content: string | null; usage?: LlmUsage } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // 🚨 SESSİZ TAM ARIZA — SİNYALSİZ BIRAKMA (denetim 08-08).
    // Anahtar düşerse her çağrı `null` döner → deterministik fallback devreye
    // girer → `passesAutoReplySafetyGate` `source == "openai"` şartını arar ve
    // BULAMAZ → oto-yanıt TAMAMEN durur. `/api/health` 200 kalır, Sentry sessiz,
    // tek belirti "misafirlere cevap gitmiyor" ve fark edilmesi GÜNLER alır.
    // Kardeş dallar (401/5xx ve truncated) zaten raporlanıyordu; eksik olan tek
    // dal, arızanın EN SESSİZ hâliydi.
    // 🚨 KENDİ PENCERESİ ŞART — `reportError` YALNIZ E-POSTA BACAĞINI KISAR.
    // (İlk yazımım "reportError zaten kısıyor" diyordu; YANLIŞTI, denetimde
    // ölçüldü.) `report-error-core.ts` sırası: `console.error` → `captureToSentry`
    // → ANCAK SONRA throttle kontrolü. Yani kısılan tek şey e-postadır; Sentry
    // olayı ve log satırı HER çağrıda üretilir.
    // Bu dal ise bir DÖNGÜNÜN içindedir: anahtar yokken `suggestReply`
    // `source:"fallback"` döner → `skippedReason:"ai_unavailable"` → o sebep
    // `runDueChannelAutoReplies`'ta BİLEREK damgalanmaz ("modele ulaşılamadıysa
    // koşullar düzelince tekrar denensin") → konuşma aday kalır → 2 dakikada bir,
    // geçiş başına 25 konuşma, yanıt başına 2 OpenAI çağrısı. Kısılmasaydı günde
    // on binlerce Sentry olayı: kota yanar ve EKLEDİĞİMİZ alarm VAR OLAN
    // alarmları susturur. Emsal: `automation.ts`'in "koşu başına TEK toplu alarm".
    // Pencere süreç başınadır (replika başına bir alarm) — `reportError`'ın kendi
    // `Map`'iyle aynı granülerlik.
    const now = Date.now();
    if (now - lastKeyMissingReportAt >= KEY_MISSING_REPORT_MS) {
      lastKeyMissingReportAt = now;
      void reportError(
        "openai-key-missing",
        new Error("OPENAI_API_KEY tanımlı değil — AI yanıtı üretilemiyor, oto-yanıt durdu."),
      );
    }
    return null;
  }
  const model = replyModel();
  const payload: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Reasoning models only accept the default temperature; everything else gets
  // a low temperature for consistency.
  if (!isReasoningModel(model)) payload.temperature = 0.4;
  // Bound the output — a runaway generation would blow up cost/latency and bloat
  // the DB/UI/log surfaces it lands on. A reply + its small JSON envelope is short;
  // reasoning models use max_completion_tokens (must also cover hidden reasoning).
  if (isReasoningModel(model)) payload.max_completion_tokens = 2000;
  else payload.max_tokens = 900;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      // Reasoning models can be slower — allow a longer ceiling.
      signal: AbortSignal.timeout(isReasoningModel(model) ? 60000 : 20000),
    });
    if (!res.ok) {
      // Silent-degradation guard: every call here falls back to the deterministic
      // fallback on failure (by design — the guest always gets an answer), but a
      // persistent cause (bad/expired key, exhausted quota, deprecated model)
      // would otherwise degrade every reply with nobody noticing. Report, don't
      // throw — the fallback path below is unaffected.
      const body = await res.text().catch(() => res.statusText);
      // 🚨 KALICI arıza (kredi bitti / anahtar reddedildi / model yok) GEÇİŞ tabanlı
      // alarma gider: bu dal 2 dakikalık oto-yanıt döngüsünün içinde koşar ve
      // `reportError` Sentry'yi hiç kısmaz (↑ "anahtar yok" dalının ölçümü) →
      // kredisi biten hesap alarm seli üretirdi (09-23 ölçümü, `provider-health.ts`).
      const persistent = classifyModelProviderFailure(res.status, body);
      if (persistent) void noteModelProviderPersistentFailure(persistent, res.status, body);
      else void reportError(`openai-reply ${res.status}`, new Error(body));
      return null;
    }
    // HTTP başarısı sağlayıcının (kota/anahtar/model) sağlıklı olduğunu gösterir;
    // açık olabilecek kalıcı arıza alarmını kapatır (sağlıklı yolda sorgu yok).
    noteModelProviderSuccess();
    const data = await res.json();
    const choice = data?.choices?.[0];
    const usage = parseLlmUsage(data);
    // Truncated output (hit max_completion_tokens): the JSON is almost certainly
    // incomplete and any "reply" is cut off. Treat it as a failure → the caller
    // uses the deterministic fallback (source="fallback") and the auto-send gate
    // (which requires source==="openai") never ships a truncated reply.
    // Tokenler yine de HARCANDI → kullanım fallback yolunda da raporlanır.
    if (choice?.finish_reason === "length") {
      void reportError("openai-reply truncated", new Error("finish_reason=length"));
      return { content: null, usage };
    }
    return { content: choice?.message?.content ?? null, usage };
  } catch (err) {
    void reportError("openai-reply", err);
    return null;
  }
}

/**
 * Suggest a guest reply. Tries OpenAI when configured; otherwise (or on any
 * failure) uses the deterministic fallback so the feature always works.
 */
/**
 * Misafire giden yanıtın KARAKTER tavanı.
 *
 * ⚠️ Buradaki sayı, `max_completion_tokens` (2000 TOKEN) ile AYNI ŞEY DEĞİL —
 * ikisi iki farklı arızayı kapatır ve karıştırılmaları pahalıya patlar:
 *  · TOKEN tavanı aşılırsa `finish_reason === "length"` gelir, `callOpenAI` null
 *    döner, deterministik fallback devreye girer ve kapı `source==="openai"`
 *    istediği için yarım cümle misafire ASLA gitmez. O yol zaten güvenliydi.
 *  · KARAKTER tavanı ise modelin TAM ve geçerli bir JSON döndürdüğü, ama metnin
 *    beklenenden uzun olduğu durumdur. Eskiden burada sessiz bir `slice(0,2000)`
 *    vardı: metin cümlenin ortasından kesiliyor, `source` hâlâ "openai" kalıyor
 *    ve kapı bu YARIM mesajı misafire otomatik gönderebiliyordu. Tek görünür iz
 *    yoktu — ne log, ne alarm.
 *
 * Yeni davranış İKİ AYRI eşikle kurulur — tek bir sayıyla ikisi birden
 * yapılamaz, ilk denemede yapılmaya çalışıldı ve GİDEN MESAJ uzunluğunu da
 * değiştirdi (denetim yakaladı):
 *
 *  · OTO-GÖNDERİM EŞİĞİ (2.000) — bu uzunluğun ÜSTÜNDEKİ hiçbir yanıt misafire
 *    OTOMATİK gitmez. Eskiden 2.000'in üstü kesilip yine de gidebiliyordu;
 *    şimdi gitmiyor. Yani kanala çıkan mesajın uzunluk davranışı DEĞİŞMEDİ,
 *    yalnız "yarım gitme" ihtimali kalktı.
 *  · SAKLAMA TAVANI (4.000) — DB satırını/inbox'ı/logu şişirmemek için. Host
 *    taslağı görüp düzenleyebilsin diye gönderim eşiğinden geniş: metni 2.000'de
 *    kesip host'a yarım göstermenin bir faydası yok.
 *
 * Ölçek için: 2.000 karakter ≈ 280 Türkçe kelime ≈ 20 cümle. Prompt "2-5 cümle"
 * diyor (Bölüm 10), 6 soruluk bir mesajın TAM cevabı bile ~900 karakter — yani
 * eşik meşru hiçbir cevabı kesmez.
 */
const REPLY_AUTOSEND_CAP = 2000;
const REPLY_STORE_CAP = 4000;

function capReply(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= REPLY_AUTOSEND_CAP) return { text: trimmed, truncated: false };
  void reportError(
    "openai-reply over autosend cap",
    new Error(
      `reply ${trimmed.length} chars > ${REPLY_AUTOSEND_CAP}; held for human review`,
    ),
  );
  return { text: trimmed.slice(0, REPLY_STORE_CAP), truncated: true };
}

export async function suggestReply(input: SuggestReplyInput): Promise<SuggestReplyResult> {
  // §C: istem TEK KEZ kurulur; metin modele, muhasebe karar kaydına gider.
  const prompt = buildReplyPrompt(input);
  const call = await callOpenAI(REPLY_SYSTEM_PROMPT, prompt.text);
  const raw = call?.content ?? null;
  const llmUsage = call?.usage;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) {
        const cappedReply = capReply(parsed.reply);
        const priorityRaw = String(parsed.priority ?? "standard");
        const priority: Priority = (["urgent", "standard", "low"] as const).includes(
          priorityRaw as Priority,
        )
          ? (priorityRaw as Priority)
          : "standard";
        // ── GÜVENLİK METADATASI STRICT (Codex F01, P1) ──────────────────────
        // JSON üretmek ≠ güvenlik sözleşmesini doğrulamak. Eski kod yalnız
        // `reply`nin varlığına bakıyordu: `String(parsed.riskLevel ?? "none")`
        // EKSİK alanı "none"a (= oto-gönderim izni) çeviriyor, `Number(true)`
        // boolean güveni 1'e, `Number("0.99")` string güveni 0.99'a yükseltiyordu.
        // Codex sentetik `{intent:"parking", reply:"…", confidence:true}` ile
        // gerçek parserdan `confidence=1, riskLevel=none` çıkardı ve gerçek kapı
        // TRUE döndü. Artık iki alan da STRICT; ikisi de karar MODELE değil
        // KODA aittir ve eksik/bozuk metadata insan incelemesine düşer.
        //
        // riskLevel: yalnız kapalı kümeden bir STRING geçer. EKSİK alan,
        // tanınmayan değerle ("High", "critical") AYNI muameleyi görür → "high"
        // (kapı insana tutar; escalation yolu host'u haberdar eder). "Eksik →
        // none" ile "tanınmayan → high" asimetrisi tam olarak açığın kendisiydi.
        const riskLevelRaw = parsed.riskLevel;
        const riskLevelValid =
          typeof riskLevelRaw === "string" && (RISK_LEVELS as readonly string[]).includes(riskLevelRaw);
        const riskLevel: RiskLevel = riskLevelValid ? (riskLevelRaw as RiskLevel) : "high";
        // confidence: yalnız SONLU bir number. Boolean/string/null/eksik → 0
        // (coercion YOK). Kapı ≥ 0.75 istediği için 0 = "asla otomatik gitmez";
        // taslak host'a yine görünür. `clamp01` NaN'i 0.5'e çeviriyordu — o
        // yol da artık ulaşılmaz (NaN JSON'dan gelemez, sayı olmayan tip 0 olur).
        const confidenceRaw = parsed.confidence;
        const confidenceValid = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw);
        const baseConfidence = confidenceValid ? clamp01(confidenceRaw) : 0;
        const schemaViolation = !riskLevelValid || !confidenceValid;
        if (schemaViolation) {
          // Görünür olsun: sürekli tekrar ederse model/format değişmiş demektir
          // (prompt canlı modelle kalibre). Sabit context → 10 dk throttle çalışır.
          // Misafir metni ALARMA GİRMEZ.
          void reportError(
            "openai-reply schema violation",
            new Error(
              `model output missing/invalid safety fields: riskLevel=${riskLevelValid ? "ok" : "invalid"} confidence=${confidenceValid ? "ok" : "invalid"}`,
            ),
          );
        }
        const intentRaw = String(parsed.intent ?? "general");
        const intentKnown = KNOWN_INTENTS.has(intentRaw);
        // A2: iki adım AYRI tutuluyor — temizlenmiş BEYAN, sonra gerçek girdiye
        // karşı DOĞRULAMA. Tek satırda zincirlendiğinde aradaki fark (uydurma
        // atıf sayısı) hesaplanamadan kayboluyordu.
        const declaredSources = sanitizeStringList(parsed.usedSources, 8, 60);
        const verified = verifyUsedSources(declaredSources, input);
        return {
          intent: intentKnown ? intentRaw : "general",
          confidence: cappedReply.truncated
            ? // KESİLMİŞ YANIT ASLA OTOMATİK GİTMEZ. Kapı confidence ≥ 0.75
              // ister; 0.5'e kıstığımızda yanıt taslak olarak host'a görünür
              // ama misafire gönderilmez. (↑capReply gerekçesi.)
              Math.min(baseConfidence, 0.5)
            : intentKnown
              ? baseConfidence
              : Math.min(baseConfidence, 0.5),
          // Cap every free-text field the model returns — an over-long value would
          // bloat the DB row / inbox UI / logs it lands on (no token guarantee
          // per-field). ↑capReply: iki eşik, biri gönderim biri saklama.
          reply: cappedReply.text,
          risk:
            typeof parsed.risk === "string" && parsed.risk.trim()
              ? parsed.risk.slice(0, 300)
              : schemaViolation
                ? SCHEMA_VIOLATION_RISK_NOTE // host ekranda SEBEBİ görsün
                : null,
          priority,
          source: "openai",
          actionSuggestion:
            typeof parsed.actionSuggestion === "string" && parsed.actionSuggestion.trim()
              ? parsed.actionSuggestion.trim().slice(0, 300)
              : null,
          riskLevel,
          // Clamp to a normalized short language code (2–3 letters). Anything else
          // (a sentence, garbage) → "en" default, so the field can't be bloated or
          // carry model prose.
          detectedLanguage: normalizeLang(parsed.detectedLanguage),
          riskType:
            typeof parsed.riskType === "string" && RISK_TYPES.has(parsed.riskType)
              ? parsed.riskType
              : null,
          usedSources: verified,
          // A2: BEYAN ↔ DOĞRULANAN yan yana. `verifyUsedSources` uydurma atıfı
          // zaten eliyordu ama KAÇ TANE elediği hiçbir yere yazılmıyordu; fark
          // canlıda "model olmayan bir kaynağa dayandığını söyledi" sinyalidir.
          sourceAudit: { declared: declaredSources.length, verified: verified.length },
          // §C: istemin GERÇEK KB muhasebesi. Yüzeyler bu sayıyı kendileri
          // hesaplayamaz — pack karakter bütçesinin kesmesi yalnız istem
          // kurulurken bilinir ve eskiden ATILIYORDU.
          kbOmittedInPrompt: prompt.kbOmitted,
          // GÖLGE ölçüm: modelin KENDİ metni (imza/açıklama eklenmeden) modelin gördüğü AYNI
          // veriye karşı. Karar değildir; hata cevabı bozamaz (`auditClaimsSafe`).
          ...(() => {
            const claimAudit = auditClaimsSafe(cappedReply.text, prompt.claimContext);
            return claimAudit ? { claimAudit } : {};
          })(),
          ...(llmUsage ? { llmUsage } : {}),
          missingInfo: sanitizeStringList(parsed.missingInfo, 5, 80),
          statedCheckoutTime:
            // Format-valid AND deterministically evidenced in the guest's own
            // message (Codex #29): this value is persisted onto the reservation
            // (guestCheckoutTime) and feeds turnover planning, so a regex-valid
            // hallucination must never be written.
            typeof parsed.statedCheckoutTime === "string" &&
            /^([01]?\d|2[0-3]):[0-5]\d$/.test(parsed.statedCheckoutTime.trim()) &&
            timeStatedInMessage(parsed.statedCheckoutTime.trim(), input.guestMessage)
              ? parsed.statedCheckoutTime.trim()
              : null,
          // Şema beyanı (09-24): STRICT çözülür — kapalı küme dışı değer `unknown` olur, alanın
          // hiç gelmemesi `null` (sinyal yok). Kapı yalnız sıkılaştırır (`ai/semantic/stay-change.ts`).
          stayChange: parseStayChangeDeclaration(parsed.stayChangeAsked, parsed.replyStance),
        };
      }
    } catch {
      // fall through to deterministic fallback
    }
  }
  const fallback = suggestReplyFallback(input);
  // Model çağrıldı ama cevap kullanılamadıysa (kesildi / bozuk JSON) harcanan token yine görünür.
  return llmUsage ? { ...fallback, llmUsage } : fallback;
}

/**
 * Distil a short "style guide" from the host's own past replies, so future AI
 * drafts can mirror their voice and typical decisions. Internal summarisation —
 * uses a cheap model. Returns null if OpenAI isn't configured, on any failure,
 * or when there isn't enough signal. Never throws.
 *
 * 🚨 GÜNLÜK AI KOTASINDAN DÜŞMEZ — GEREKÇE (§E, 09-12; önceden HİÇBİR YERDE
 * YAZILI DEĞİLDİ ve denetim bunu "gerekçesiz asimetri" diye işaretledi):
 *  · Bu ARKA PLAN işidir, misafirin ya da host'un beklediği bir istek değil.
 *    Kota "kullanıcının bastığı düğme" için bir suistimal kapısıdır
 *    (`daily-budget.ts`: interaktif rotalar "önce tüket"); burada basan kimse yok.
 *  · Frekansı KENDİ kapılarıyla zaten sınırlı ve ölçüldü: org başına 24 saatte
 *    EN FAZLA BİR kez (`automation.ts` `refreshStyleProfile` throttle'ı), ≥5
 *    örnek şartı, ≤40 örnek tavanı. Yani org başına günde ~1 ucuz çağrı.
 *  · Kotadan düşseydi host'un GÖREBİLDİĞİ hakkını görünmez bir arka plan işi
 *    yerdi ve "neden 149 hakkım kaldı" sorusunun cevabı hiçbir ekranda olmazdı.
 * ⚠️ Bu gerekçe BUGÜN YAZILDI; "hep böyle tasarlanmıştı" diye okunmamalı —
 * ölçülen durum "kapı yok ve sebebi yazılı değil" idi, karar şimdi kayda geçti.
 */
export async function summarizeHostStyle(sampleReplies: string[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const samples = sampleReplies.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (samples.length < 5) return null; // too little signal to generalise safely

  const system =
    "Sen bir editör asistanısın. Bir kısa dönem kiralama ev sahibinin geçmiş misafir " +
    "cevaplarını okuyup, gelecekteki AI taslakları için bir REHBER çıkaracaksın. İKİ bölüm yaz:\n" +
    "1) TARZ: selamlama/kapanış alışkanlığı, samimiyet düzeyi, cümle uzunluğu, emoji kullanımı.\n" +
    "2) SIK SORULAN SORULAR: ev sahibinin tekrar eden, GİZLİ OLMAYAN sorulara (ör. otopark, " +
    "valiz/bagaj bırakma, ulaşım/yol tarifi, geç çıkış/erken giriş yaklaşımı, çevre önerileri) " +
    "verdiği tipik cevapları kısaca özetle — yalnızca tutarlı, tekrar eden cevapları.\n" +
    "KESİNLİKLE DIŞARIDA BIRAK: Wi-Fi şifresi, kapı/giriş kodu, tam ev adresi, fiyat ve iade " +
    "rakamları (bunlar gizli/değişkendir, rehbere ASLA koyma). En fazla 220 kelime, madde madde.";
  const user = `Ev sahibinin geçmiş cevapları:\n\n${samples.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;

  const model = process.env.OPENAI_STYLE_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (!isReasoningModel(model)) payload.temperature = 0.2;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(isReasoningModel(model) ? 60000 : 20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim().slice(0, 1800) : null;
  } catch {
    return null;
  }
}

/**
 * Classify an inbound message (intent / priority / complaint flag).
 * Uses the deterministic classifier for speed and predictability.
 */
export async function classifyMessage(message: string): Promise<ClassifyResult> {
  return classifyFallback(message);
}
