import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LAUNCH_REPLY_FLAGS, evalProfileOf, launchDeviations, launchOverrides } from "../eval/launch-profile";

// ---------------------------------------------------------------------------
// AÇILIŞ KİPİ PİNİ (kurucu 11-12 gece: "testleri bayrağın açık olduğu, gerçek ürünün olacağı şekle göre yapıyorsun dimi?").
// Bulgu: canlı hat ölçümleri, açılış belgesinde "AÇILIŞTA 1" yazan ve misafire giden metni değiştiren dört anahtar olmadan koşuyordu.
// Bu pin ölçüm tabanını (`tests/eval/launch-profile.ts`) açılış belgesine bağlar ve kol seçme kurallarını sınar.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../..");
const doc = readFileSync(path.join(ROOT, "docs/RAILWAY-ACILIS-2026-10-15.md"), "utf8");

/** Belgedeki "ÖLÇÜM-TABANI" paragrafının anahtar listesi (ters tırnaklı adlar; açıklamadaki dosya adları hariç). */
function docBaseline(): string[] {
  const start = doc.indexOf("**ÖLÇÜM-TABANI**");
  expect(start).toBeGreaterThan(-1);
  const end = doc.indexOf("\n\n", start);
  const para = doc.slice(start, end < 0 ? undefined : end);
  return [...para.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]).filter((n) => n !== "EVAL_PROFILE");
}

describe("açılış kipi — ölçüm tabanı açılış belgesiyle birebir", () => {
  it("belgedeki ÖLÇÜM-TABANI listesi = LAUNCH_REPLY_FLAGS (sıra dahil)", () => {
    expect(docBaseline()).toEqual([...LAUNCH_REPLY_FLAGS]);
    expect(new Set(LAUNCH_REPLY_FLAGS).size).toBe(LAUNCH_REPLY_FLAGS.length);
  });

  it("listedeki her anahtar belgede AYRICA anlatılmış (yazım hatası / hayalet anahtar olmasın)", () => {
    for (const k of LAUNCH_REPLY_FLAGS) {
      expect(doc.split(`\`${k}\``).length - 1, k).toBeGreaterThanOrEqual(2);
    }
  });

  it("🚨 11-12 bulgusu: misafire gideni değiştiren dört açılış anahtarı tabanda", () => {
    for (const k of [
      "AI_NO_APOLOGY_RULE_ENABLED",
      "AI_UNDERSTANDING_PRIVACY_RULE_ENABLED",
      "AI_ASSISTANT_QUESTION_ITEM_ENABLED",
      "AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED",
    ]) {
      expect(LAUNCH_REPLY_FLAGS).toContain(k);
    }
  });

  it("açılışta AÇILMAYACAK anahtarlar tabanda YOK (ölçülen kollardır)", () => {
    for (const k of ["AI_ANSWER_PARTS_ENABLED", "AI_SENIOR_READER_ENABLED", "AI_NO_SOURCE_RULE_ENABLED", "AI_HELD_PET_SPLIT_ENABLED", "AI_TURN_MESSAGES_ENABLED"]) {
      expect(LAUNCH_REPLY_FLAGS as readonly string[]).not.toContain(k);
    }
  });
});

describe("açılış kipi — kol seçimi", () => {
  const forced = ["AUTO_REPLY_ENABLED", "KB_SEMANTIC_RETRIEVAL"];

  it("EVAL_PROFILE yoksa / başka değerse eski taban: hiçbir anahtar eklenmez", () => {
    expect(evalProfileOf({})).toBe("legacy");
    expect(evalProfileOf({ EVAL_PROFILE: "prod" })).toBe("legacy");
    expect(launchOverrides({}, forced)).toEqual({});
  });

  it("açılış kipi: ölçerin sabitlediği ve kabukta açıkça verilenler dışındaki her anahtar '1' olur", () => {
    expect(evalProfileOf({ EVAL_PROFILE: " Launch " })).toBe("launch");
    const out = launchOverrides({ EVAL_PROFILE: "launch", AI_NO_APOLOGY_RULE_ENABLED: "0", AI_KB_FEE_RULE_ENABLED: "" }, forced);
    expect(Object.keys(out).sort()).toEqual(
      LAUNCH_REPLY_FLAGS.filter((k) => !forced.includes(k) && k !== "AI_NO_APOLOGY_RULE_ENABLED" && k !== "AI_KB_FEE_RULE_ENABLED").sort(),
    );
    expect(new Set(Object.values(out))).toEqual(new Set(["1"]));
  });

  it("sapma listesi: '1' olmayan her açılış anahtarı (kapatılan kol görünür olsun)", () => {
    const all = Object.fromEntries(LAUNCH_REPLY_FLAGS.map((k) => [k, "1"]));
    expect(launchDeviations(all)).toEqual([]);
    expect(launchDeviations({ ...all, AI_NO_APOLOGY_RULE_ENABLED: "0", AI_KB_FEE_RULE_ENABLED: "" })).toEqual(["AI_KB_FEE_RULE_ENABLED", "AI_NO_APOLOGY_RULE_ENABLED"]);
    expect(launchDeviations({})).toEqual([...LAUNCH_REPLY_FLAGS]);
  });

  it("ölçer açılış kipini uygular ve mühürlü seti açılış kipi dışında başlatmaz (bağlantı pini)", () => {
    const harness = readFileSync(path.join(ROOT, "tests/eval/live-pipeline.eval.test.ts"), "utf8");
    expect(harness).toContain("launchOverrides(process.env, Object.keys(LIVE_FLAGS))");
    expect(harness).toMatch(/if \(SEALED\) \{\s+const effective = \{ \.\.\.process\.env, \.\.\.launchOverrides\(process\.env, Object\.keys\(LIVE_FLAGS\)\), \.\.\.LIVE_FLAGS \};/);
    expect(harness).toContain("Mühürlü set yalnız açılış kipinde koşar");
  });
});
