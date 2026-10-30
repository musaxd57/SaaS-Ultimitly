import { describe, it, expect } from "vitest";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { REPLY_FIELD_RULES, CODE_BUILT_CLEARED_FIELDS, withoutCodeBuiltClearedFields } from "@/lib/ai/reply-field-rules";
import { codeBuiltResult } from "@/lib/ai/code-built-result";
import { mergeSeniorRewrite } from "@/lib/ai/semantic/senior-rewrite";
import { autoReplyGateVerdict, verifiedEarlyCheckinResult } from "@/lib/automation";

// ---------------------------------------------------------------------------
// GD7 (kurucu 10-29 gece K-1029-E): cevap sonucunun HER alanı için iki fonksiyon tabloya karşı sınanır. Tamlık derleyicide
// (`satisfies` — yeni alan sınıflanmazsa `tsc` kırılır); bu dosya DOĞRULUK: iki fonksiyon her alanda tablonun dediğini yapıyor mu.
// Her alan iki yönden: (a) iki tarafta farklı değer → doğru taraf mı geldi; (b) beklenen tarafta alan yok → sonuçta da yok (yanlış
// taraftan sızma yok). `true` işaretleri (a)'da ayırt edilemez, (b) ayırır.
// ---------------------------------------------------------------------------

type Full = Required<SuggestReplyResult>;
const A: Full = {
  intent: "complaint",
  confidence: 0.9,
  reply: "ilk metin",
  risk: "ilk risk",
  priority: "urgent",
  source: "openai",
  actionSuggestion: "ilk öneri",
  riskLevel: "medium",
  detectedLanguage: "tr",
  riskType: "complaint",
  usedSources: ["kb:a"],
  sourceAudit: { declared: 2, verified: 1 },
  kbOmittedInPrompt: 3,
  claimAudit: { total: 1 } as never,
  llmUsage: { pt: 100, ct: 10 },
  partRewriteBilled: true,
  missingInfo: ["ilk eksik"],
  statedCheckoutTime: "11:00",
  stayChange: { asked: "early_checkin", stance: "defers" } as never,
  timeConflicts: [{ field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] }],
  claimedActions: { status: "declared", actions: ["will_follow_up"] } as never,
  answeredRequests: { ok: true, refs: ["r1"] } as never,
  answerParts: [{ ref: "r1", status: "verified" }] as never,
  verifiedPartsOnly: true,
  verifiedParts: [{ ref: "r1", text: "ilk parça", evidence: "e", source: "kb:a" }],
  hostContactOnly: true,
  hostContactRemovals: [{ kind: "write", form: "conditional", appendix: false, stems: [], topics: [], generic: true }],
};
const B: Full = {
  intent: "question",
  confidence: 0.6,
  reply: "yeni metin",
  risk: "yeni risk",
  priority: "low",
  source: "fallback",
  actionSuggestion: "yeni öneri",
  riskLevel: "low",
  detectedLanguage: "en",
  riskType: "general",
  usedSources: ["kb:b"],
  sourceAudit: { declared: 1, verified: 1 },
  kbOmittedInPrompt: 7,
  claimAudit: { total: 2 } as never,
  llmUsage: { pt: 50, ct: 5 },
  partRewriteBilled: true,
  missingInfo: ["yeni eksik"],
  statedCheckoutTime: "12:00",
  stayChange: { asked: "late_checkout", stance: "grants" } as never,
  timeConflicts: [{ field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] }],
  claimedActions: { status: "declared", actions: [] } as never,
  answeredRequests: { ok: true, refs: ["r2"] } as never,
  answerParts: [{ ref: "r2", status: "verified" }] as never,
  verifiedPartsOnly: true,
  verifiedParts: [{ ref: "r2", text: "yeni parça", evidence: "e", source: "kb:b" }],
  hostContactOnly: true,
  hostContactRemovals: [{ kind: "referral", form: "referral", appendix: false, stems: ["sauna"], topics: [], generic: false }],
};
const without = (r: Full, k: keyof Full) => {
  const c = { ...r } as Record<string, unknown>;
  delete c[k];
  return c as unknown as Full;
};
const KEYS = Object.keys(REPLY_FIELD_RULES) as (keyof Full)[];

describe("GD7 alan kuralları tablosu", () => {
  it("tablo SuggestReplyResult'ın her alanını sınıflar (sınama nesneleri de her alanı taşır — tamlık iki yönlü)", () => {
    expect(KEYS.sort()).toEqual(Object.keys(A).sort());
    expect(Object.keys(B).sort()).toEqual(Object.keys(A).sort());
  });

  it("kod metninde düşen alanlar tablodan türetilir; metin işaretleri listede", () => {
    expect([...CODE_BUILT_CLEARED_FIELDS].sort()).toEqual(["claimAudit", "hostContactOnly", "hostContactRemovals", "sourceAudit", "verifiedParts", "verifiedPartsOnly"]);
    const copy = { ...A };
    withoutCodeBuiltClearedFields(copy);
    expect(copy).toEqual(A); // girdi değişmez
  });

  describe("mergeSeniorRewrite her alanda tablonun dediğini yapar", () => {
    for (const k of KEYS) {
      const rule = REPLY_FIELD_RULES[k].rewrite;
      it(`${k} → ${rule}`, () => {
        const m = mergeSeniorRewrite<Full>(A, B) as Full;
        switch (rule) {
          case "first":
            expect(m[k]).toBe(A[k]);
            expect(mergeSeniorRewrite<Full>(without(A, k), B)[k]).toBeUndefined();
            break;
          case "retried":
            expect(m[k]).toBe(B[k]);
            expect(mergeSeniorRewrite<Full>(A, without(B, k))[k]).toBeUndefined();
            break;
          case "min":
            expect(m[k]).toBe(0.6);
            expect(mergeSeniorRewrite<Full>({ ...A, confidence: 0.5 }, B)[k]).toBe(0.5);
            break;
          case "sum":
            expect(m[k]).toEqual({ pt: 150, ct: 15 });
            break;
          case "split":
            // İSTEK yarısı ilk çağrıdan (mesaj), TUTUM yarısı yeni çağrıdan (metin).
            expect(m[k]).toEqual({ asked: "early_checkin", stance: "grants" });
            break;
          case "either":
            expect(mergeSeniorRewrite<Full>(A, without(B, k))[k]).toBe(true);
            expect(mergeSeniorRewrite<Full>(without(A, k), B)[k]).toBe(true);
            expect(mergeSeniorRewrite<Full>(without(A, k), without(B, k))[k]).toBeUndefined();
            break;
          default:
            throw new Error(`bilinmeyen kural ${rule as string}`);
        }
      });
    }
  });

  describe("codeBuiltResult her alanda tablonun dediğini yapar", () => {
    const REPLACED: Partial<Record<keyof Full, unknown>> = {
      reply: "kod metni",
      intent: "early_checkin",
      usedSources: [],
      claimedActions: { status: "declared", actions: [] },
    };
    for (const k of KEYS) {
      const rule = REPLY_FIELD_RULES[k].codeBuilt;
      it(`${k} → ${rule}`, () => {
        const c = codeBuiltResult<Full>(A, "kod metni", "early_checkin");
        if (rule === "keep") expect(c[k]).toBe(A[k]);
        else if (rule === "clear") expect(k in c).toBe(false);
        else {
          expect(k in REPLACED, `${k} için beklenen değer yazılmadı`).toBe(true);
          expect(c[k]).toEqual(REPLACED[k]);
        }
      });
    }
    it("eylem beyanı istenmediyse kod metninde de alan yok", () => {
      expect("claimedActions" in codeBuiltResult<Full>(without(A, "claimedActions"), "kod metni", "early_checkin")).toBe(false);
    });
  });

  describe("davranış: kod metni taslağın metin işaretini taşımaz", () => {
    const passing = {
      intent: "early_checkin",
      riskLevel: "low",
      riskType: null,
      confidence: 0.9,
      source: "openai",
      reply: "x",
      usedSources: ["kb:x"],
    };
    it("🚨 4.12 muafiyeti kod metnine taşınmaz: güveni < 0,75 taslağın yerine geçen onay metni GÜVEN TABANINDA tutulur (09-24 P2 kararı)", () => {
      // Önce: taslak parça kipinde doğrulanmış parçalardan oluşuyordu (muafiyet), güveni 0,6. Kod onay metnini kurunca muafiyet onay
      // metnine geçiyor, 09-24'te bilinçli korunan ≥ 0,75 tabanı atlanıyordu. Sonra: taban geri gelir.
      const grant = "Erken girişiniz onaylandı, saat 12:00'den itibaren girebilirsiniz.";
      // Gerçek akıştaki gibi: kapı kod metnini kendi doğrulanmış izniyle okur (`automation.ts` verifiedGrant).
      const ctx = { verifiedGrant: { text: grant } };
      const draft = { ...passing, confidence: 0.6, verifiedPartsOnly: true as const };
      const detail = (r: Parameters<typeof autoReplyGateVerdict>[0], c?: Parameters<typeof autoReplyGateVerdict>[2]) =>
        autoReplyGateVerdict(r, "Erken girebilir miyiz?", c)?.detail ?? null;
      // Taslağın kendisi muafiyetle güven tabanına takılmıyordu (öncül — anti-vakum).
      expect(detail(draft)).not.toBe("low_confidence");
      const verified = verifiedEarlyCheckinResult(draft, grant);
      expect("verifiedPartsOnly" in verified).toBe(false);
      expect(detail(verified, ctx)).toBe("low_confidence");
      // Güveni yeterli taslakta onay metni aynen geçer (aşırı uygulama yok).
      const ok = verifiedEarlyCheckinResult({ ...draft, confidence: 0.9 }, grant);
      expect(detail(ok, ctx)).toBeNull();
    });
  });
});
