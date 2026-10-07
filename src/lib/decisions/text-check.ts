import { timesIn } from "@/lib/ai/retrieval/time-fields";
import { hasUnallowedMoney, moneyAmountsOf } from "@/lib/ai/stay-money";
import { auditClaims } from "@/lib/ai/claim-support";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { defersDecisionToHost } from "@/lib/ai/availability-claims";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { replyLanguageMismatch } from "@/lib/ai/language-signal";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import {
  DECISION_LANGS,
  decisionMessageText,
  formatDecisionDay,
  formatDecisionFee,
  type DecisionKind,
  type DecisionLang,
  type DecisionResolution,
} from "./core";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR MESAJININ KOD DENETİMİ (kurucu kararı 10-07, Sabah Kararları 62 h). Yapay zekâ karar mesajını doğal ve
// gerekçeli yazar; KOD doğrular: saat, gün ve ücret karar kaydıyla eşleşmeli. Aynı denetim gönderimde ev sahibinin düzenlediği metne de
// uygulanır (uyuşmazsa sade uyarı + "Yine de gönder" — kurucu seçimi).
//
// Yalnız SIKILAŞTIRIR (bir metni "gönder" diye yetkilendirmez). Saf, LLM'siz, veritabanısız. Koddan kurulan 7 dil şablonu her girdide
// temiz geçer (pinli) — denetim şablonu asla engellemez.
// ---------------------------------------------------------------------------

export const DECISION_TEXT_MAX = 1_200;

export interface DecisionTextFacts {
  kind: DecisionKind;
  resolution: DecisionResolution;
  lang: DecisionLang;
  /** Hedef takvim günü (YYYY-MM-DD). */
  dayKey: string | null;
  /** Onayda ev sahibinin seçtiği saat. */
  time: string | null;
  /** Misafirin istediği saat (retde "13:00 mümkün değil" doğal; onayda "13:00 yerine 14:00"). */
  requestedTime: string | null;
  /** Mülkün standart giriş (erken giriş) / çıkış (geç çıkış) saati. */
  standardTime: string | null;
  /** Ev sahibinin kayıtlı ücreti (erken giriş kuralı). */
  fee: { amount: number; currency: string } | null;
  /** Ev sahibinin kayıtlı notu (şablonda onayın sonuna eklenir). */
  note: string | null;
  /** Kartın kontrol listesi satırları (gerekçenin dayanağı: temizlik, önceki / sonraki misafirin saati). */
  checklist: readonly string[];
}

export type DecisionTextProblem =
  | "empty"
  | "too_long"
  /** Onay metninde ev sahibinin seçtiği saat yok. */
  | "time_missing"
  /** Karar kaydında ve kontrol listesinde olmayan bir saat. */
  | "time_unknown"
  /** Kayıtlı ücret dışında tutar ya da fiyat sözü (indirim, ücretsiz…). */
  | "money_unknown"
  /** Ücretli erken giriş onayında kayıtlı ücret söylenmiyor. */
  | "fee_missing"
  /** Dayanaksız başka bir sayı / tarih / kod (gün kaydı dahil). */
  | "claim_unsupported"
  /** Yer tutucu, makbuzsuz söz ya da devir cümlesi ("ev sahibinize iletiyorum"). */
  | "promise_or_handoff"
  /** Kararı ev sahibine bırakan cümle — karar mesajında anlamsız ("ev sahibinizin kararıdır"). */
  | "defers"
  /** "Bilgim yok" itirafı. */
  | "absence"
  /** Misafirin dilinden başka dilde cümle. */
  | "language"
  /** Kartın İÇ kontrol listesinden bir satır metne aynen kopyalanmış (ölçüldü 10-07: 5.1 İngilizce mesaja Türkçe satırı ekledi). */
  | "internal_copy";

export interface DecisionTextCheck {
  ok: boolean;
  problems: DecisionTextProblem[];
  /** Tanınmayan saatler (ev sahibine gösterilir; kapalı küme dışında metin yok). */
  unknownTimes: string[];
}

/** Metinde geçmesine izin verilen saatler: karar saati, istenen saat, standart saat, notun ve kontrol listesinin saatleri. */
export function allowedDecisionTimes(f: DecisionTextFacts): Set<string> {
  const out = new Set<string>();
  for (const t of [f.resolution === "approve" ? f.time : null, f.requestedTime, f.standardTime]) {
    const n = normalizeHhmm(t);
    if (n) out.add(n);
  }
  for (const src of [f.note ?? "", ...f.checklist]) for (const t of timesIn(src)) out.add(t);
  return out;
}

/** Denetimin "olgu" sayılan metinleri: şablonun kendisi (her dilde gün / saat / ücret biçimi), not, kontrol listesi, gün anahtarı. */
function factTexts(f: DecisionTextFacts): string[] {
  const out: string[] = [...f.checklist];
  if (f.note) out.push(f.note);
  if (f.dayKey) {
    out.push(f.dayKey);
    for (const lang of DECISION_LANGS) out.push(formatDecisionDay(f.dayKey, lang));
  }
  if (f.fee) for (const lang of DECISION_LANGS) out.push(formatDecisionFee(f.fee, lang));
  for (const t of allowedDecisionTimes(f)) out.push(t);
  const template = decisionMessageText({ ...f, time: f.time });
  if (template) out.push(template);
  return out;
}

const squash = (t: string) => t.toLocaleLowerCase("tr").replace(/[\s.,;:!?()"'’—–-]+/g, " ").trim();

/** Kontrol listesinin bir satırı (ya da satırın saatsiz gövdesi, ≥ 16 karakter) metinde aynen geçiyor mu. */
export function copiesChecklistLine(text: string, checklist: readonly string[]): boolean {
  const t = ` ${squash(text)} `;
  return checklist.some((line) => {
    const whole = squash(line);
    if (whole.length >= 16 && t.includes(` ${whole} `)) return true;
    // Saat / sayı öncesi gövde ("önceki misafirin beklenen çıkışı" — "… 11:00") da iç ifadedir.
    const head = squash(line.split(/[:(\d]/)[0] ?? "");
    return head.length >= 16 && t.includes(` ${head}`);
  });
}

function stripNote(text: string, note: string | null): string {
  const n = note?.trim();
  return n ? text.split(n).join(" ") : text;
}

/**
 * Karar mesajını karar kaydıyla kıyaslar. Boş `problems` = temiz. Ev sahibinin yazdığı not (kayıtlı) metinde olduğu gibi duruyorsa
 * dil kontrolünden ayıklanır (Türkçe not İngilizce mesajı tutmasın — doğrulanmış erken giriş onayıyla aynı kural).
 */
export function checkDecisionText(text: string | null | undefined, f: DecisionTextFacts): DecisionTextCheck {
  const body = (text ?? "").trim();
  const problems: DecisionTextProblem[] = [];
  const unknownTimes: string[] = [];
  if (!body) return { ok: false, problems: ["empty"], unknownTimes };
  if (Array.from(body).length > DECISION_TEXT_MAX) problems.push("too_long");

  const allowed = allowedDecisionTimes(f);
  const times = timesIn(body);
  for (const t of times) if (!allowed.has(t)) unknownTimes.push(t);
  if (unknownTimes.length > 0) problems.push("time_unknown");
  const decided = normalizeHhmm(f.time);
  if (f.resolution === "approve" && decided && !times.has(decided)) problems.push("time_missing");

  const fee = f.fee && Number.isFinite(f.fee.amount) && f.fee.amount > 0 ? f.fee : null;
  const approvedFee = f.resolution === "approve" && f.kind === "early_checkin" ? fee : null;
  const allowedMoney = [...(approvedFee ? [{ amount: approvedFee.amount, currency: approvedFee.currency }] : []), ...moneyAmountsOf(f.note)];
  if (hasUnallowedMoney(stripNote(body, f.note), allowedMoney)) problems.push("money_unknown");
  if (approvedFee && !moneyAmountsOf(body).some((m) => m.amount === approvedFee.amount)) problems.push("fee_missing");

  const audit = auditClaims(body, { facts: factTexts(f), operator: [], guest: [] });
  if (audit.u > 0) problems.push("claim_unsupported");

  if (vetoOutgoingReply(body) !== null) problems.push("promise_or_handoff");
  if (defersDecisionToHost(body)) problems.push("defers");
  if (admitsMissingKnowledge(body)) problems.push("absence");
  if (replyLanguageMismatch(f.lang, stripNote(body, f.note))) problems.push("language");
  if (copiesChecklistLine(stripNote(body, f.note), f.checklist)) problems.push("internal_copy");

  return { ok: problems.length === 0, problems, unknownTimes };
}

const PROBLEM_TR: Record<DecisionTextProblem, string> = {
  empty: "Mesaj boş.",
  too_long: "Mesaj çok uzun.",
  time_missing: "Mesajda seçtiğiniz saat yazmıyor.",
  time_unknown: "Mesajda karar kaydında olmayan bir saat var.",
  money_unknown: "Mesajda kayıtlı ücretinizden farklı bir tutar ya da fiyat ifadesi var.",
  fee_missing: "Mesajda kayıtlı erken giriş ücretiniz yazmıyor.",
  claim_unsupported: "Mesajda karar kaydıyla eşleşmeyen bir tarih ya da sayı var.",
  promise_or_handoff: "Mesajda yerine getirilmemiş bir söz ya da \"ev sahibine iletiyorum\" gibi bir ifade var.",
  defers: "Mesaj kararı hâlâ ev sahibine bırakıyor; kararınızı açıkça yazın.",
  absence: "Mesajda \"bilgim yok\" gibi bir ifade var.",
  language: "Mesajın bir kısmı misafirin dilinde değil.",
  internal_copy: "Mesajda kontrol listenizden bir satır aynen geçiyor; misafire kendi cümlenizle yazın.",
};

/** Ev sahibine gösterilen sade uyarı satırları (teknik açıklama yok). */
export function decisionTextProblemsTr(check: Pick<DecisionTextCheck, "problems" | "unknownTimes">, f: Pick<DecisionTextFacts, "time" | "resolution">): string[] {
  return check.problems.map((p) => {
    if (p === "time_unknown" && check.unknownTimes.length > 0) {
      const decided = f.resolution === "approve" ? normalizeHhmm(f.time) : null;
      return `Mesajda ${check.unknownTimes.join(", ")} yazıyor${decided ? `; seçtiğiniz saat ${decided}` : ""}.`;
    }
    return PROBLEM_TR[p];
  });
}
