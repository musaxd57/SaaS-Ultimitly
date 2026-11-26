// ---------------------------------------------------------------------------
// AÇILIŞ KİPİ — canlı hat ölçümünün bayrak tabanı (kurucu 11-12 gece: "testleri bayrağın açık olduğu, yani gerçek ürünün olacağı şekle
// göre yapıyorsun dimi?").
//
// Cevap: 11-12'ye kadar TAM DEĞİL. Ölçer (`live-pipeline.eval.test.ts`) açılış belgesinin §1 kümesini açıyordu, ama belgede "AÇILIŞTA 1"
// yazan ve MİSAFİRE GİDEN METNİ değiştiren dört anahtar (özür yasağı, başka kişinin bilgisi kuralı, "bunu nereden biliyorsun" öğesi, arıza ↔
// kullanım bağlamı) hiçbir ölçüm kolunda yoktu — ne ölçerin sabit listesinde ne de kol betiğinde.
//
// Bu dosya TEK KAYNAKTIR: açılışta "1" verilecek ve KANAL CEVAP HATTINI etkileyen anahtarlar. Belgeyle eşliği pinlidir
// (`tests/unit/eval-launch-profile.test.ts` ↔ `docs/RAILWAY-ACILIS-2026-10-15.md` "ÖLÇÜM-TABANI" satırı): belgeye açılış anahtarı eklenip
// buraya eklenmezse (ya da tersi) kapı kırmızı olur.
//
// Kullanım: `EVAL_PROFILE=launch` → ölçer bu listedeki her anahtarı "1" yapar; kol, bir anahtarı bilerek kapatmak isterse kabukta AÇIKÇA
// verir (`ANAHTAR=0`). 🚨 Mühürlü (kabul) seti yalnız açılış kipinde koşar — yanlış bayrak kümesiyle bir kör set yakılmasın.
// Gölge anahtarlar (`SHADOW_AI_ENABLED`, `CONVERSATION_CONTROL_SHADOW_ENABLED`) misafire gideni değiştirmez; ölçümde kapalı kalır (maliyet).
// ---------------------------------------------------------------------------

/** Açılışta "1": kanal cevap hattını etkileyenler (belge §1 + §5 "AÇILIŞTA 1"). Sıra belgedeki "ÖLÇÜM-TABANI" satırıyla aynı. */
export const LAUNCH_REPLY_FLAGS = [
  "AUTO_REPLY_ENABLED",
  "KB_SEMANTIC_RETRIEVAL",
  "KB_RERANK_ENABLED",
  "AI_UNDERSTANDING_ENABLED",
  "AI_STAY_GUARD_ENABLED",
  "AI_CONVERSATION_ITEMS_ENABLED",
  "AI_HOUSE_RULES_SHADOW",
  "AI_CODE_GREETING_ENABLED",
  "AI_HOST_DECISION_HOLD_ENABLED",
  "AI_ACCESS_CODE_COMPLETE_ENABLED",
  "AI_COMPLAINT_FOLLOWUP_RULE_ENABLED",
  "AI_KB_FEE_RULE_ENABLED",
  "AI_NO_APOLOGY_RULE_ENABLED",
  "AI_UNDERSTANDING_PRIVACY_RULE_ENABLED",
  "AI_ASSISTANT_QUESTION_ITEM_ENABLED",
  "AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED",
] as const;

export type EvalProfile = "launch" | "legacy";

/** `EVAL_PROFILE`: "launch" = açılış kipi; boş / başka = eski taban (yalnız ölçerin sabit listesi + kabuktan gelen kollar). */
export function evalProfileOf(env: Record<string, string | undefined>): EvalProfile {
  return env.EVAL_PROFILE?.trim().toLowerCase() === "launch" ? "launch" : "legacy";
}

/**
 * Açılış kipinde ölçerin EK olarak açacağı anahtarlar: listede olup ölçerin kendi sabitlediği (`forced`) kümede bulunmayan ve kabukta
 * AÇIKÇA verilmemiş olanlar. Kabukta verilen değer (boş dize dahil) korunur — kol bir anahtarı bilerek kapatabilir.
 */
export function launchOverrides(env: Record<string, string | undefined>, forced: readonly string[]): Record<string, string> {
  if (evalProfileOf(env) !== "launch") return {};
  const out: Record<string, string> = {};
  for (const k of LAUNCH_REPLY_FLAGS) {
    if (forced.includes(k)) continue;
    if (env[k] !== undefined) continue;
    out[k] = "1";
  }
  return out;
}

/** Açılış kipinden SAPAN anahtarlar (kol bilerek kapattıysa rapor bunu yazar; mühürlü koşuda izin verilmez). */
export function launchDeviations(env: Record<string, string | undefined>): string[] {
  return LAUNCH_REPLY_FLAGS.filter((k) => env[k]?.trim() !== "1");
}
