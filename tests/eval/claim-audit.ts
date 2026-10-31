// ---------------------------------------------------------------------------
// İDDİA DENETÇİSİ — ÖLÇÜM ARACI (kurucu 10-21: "Cevabın anlamını da doğrula: yalnız kaynakta aynı sözcüklerin bulunmasına bakma. Hangi
// tesisin saati, hangi hizmetin ücreti, hangi misafire özel izin olduğu korunmalı"). Ürün kodu DEĞİL; hiçbir gönderim kararı bunu okumaz.
//
// Model misafire giden cevabın her somut iddiasını {konu, ilişki türü, değer, koşul} olarak çıkarır ve bilgi tabanında AYNI konu + AYNI
// ilişki + AYNI koşulla destekleyen cümleyi BİREBİR alıntılar. Kod alıntıyı o kalemde arar: bulunmazsa destek SAYILMAZ ("doğrulanmadı").
// Ayrıca her beklenen istek için cevabın onu içerik olarak karşılayıp karşılamadığını söyler (karşıladı / erteledi / değinmedi).
// Denetçi modeli cevap modelinden ayrıdır (`EVAL_JUDGE_MODEL`, varsayılan gpt-5.1; cevap modeli üretimde gpt-6-luna). Modelin kendi güveni
// istenmez ve kullanılmaz.
// ---------------------------------------------------------------------------

import { callStructuredJson } from "@/lib/ai/semantic/structured-call";
import { isReasoningModel } from "@/lib/ai/model-family";
import { AUDIT_SCHEMA, AUDIT_SYSTEM, buildAuditUser, parseAudit, type AuditResult } from "./claim-audit-core";

export * from "./claim-audit-core";

export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL?.trim() || "gpt-5.1";
const JUDGE_EFFORT = process.env.EVAL_JUDGE_REASONING_EFFORT?.trim() || "high";

/** Denetçi bir kez yeniden denenir (geçici arıza / düşünme payı kesilmesi); ikinci düşüşte satır "denetçi düştü" sayılır. */
export async function auditReply(input: Parameters<typeof buildAuditUser>[0], apiKey: string): Promise<AuditResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callStructuredJson({
      apiKey,
      model: JUDGE_MODEL,
      system: AUDIT_SYSTEM,
      user: buildAuditUser(input),
      schema: AUDIT_SCHEMA,
      timeoutMs: 180_000,
      maxTokens: 6_000,
      // Düşünme payı (10-21 ölçüldü: 16.000 tavanda 54 cevabın 3'ünde denetçi kesildi).
      maxCompletionTokens: 40_000,
      ...(isReasoningModel(JUDGE_MODEL) ? { reasoningEffort: JUDGE_EFFORT } : {}),
    });
    if (res.ok) {
      const parsed = parseAudit(res.data, input.kb, input.requests.map((r) => r.id));
      if (parsed) return parsed;
    } else if (process.env.EVAL_LIVE_DEBUG === "1") console.error(`[claim-audit] ${res.error}`);
  }
  return null;
}
