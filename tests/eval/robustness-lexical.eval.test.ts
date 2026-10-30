import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFallback, isAccessLossText, isSafetyEmergencyText } from "@/lib/ai/fallback";
import { PERTURBATIONS, perturb, typos, type Perturbation } from "./robustness-perturb";

// ---------------------------------------------------------------------------
// SAĞLAMLIK — KOL 1: MODELSİZ (ücretsiz; kurucu 10-29 gece K-1029-F). Sözcük ağlarının hükmü aynı mesajın bozuk eşinde DEĞİŞİYOR mu?
// Hüküm sırası: acil (isSafetyEmergencyText) → erişim kaybı (isAccessLossText) → şikâyet (classifyFallback) → yok.
// Ölçüt: değişmezlik = bozuk eşin hükmü temelinkiyle aynı · doğruluk = hüküm `truth` ile aynı.
// Koşu: RUN_ROBUSTNESS=1 npx vitest run --config vitest.eval.config.ts tests/eval/robustness-lexical.eval.test.ts
// (EVAL_WRITE_REPORT=1 → docs/olcum/robustness-kelime-agi-<tarih>.md + .json). Model ve veritabanı yok.
// ---------------------------------------------------------------------------

type Verdict = "emergency" | "access" | "complaint" | "none";
interface Base { id: string; lang: string; archetype: string; message: string; truth: Verdict }

function verdict(m: string): Verdict {
  if (isSafetyEmergencyText(m)) return "emergency";
  if (isAccessLossText(m)) return "access";
  if (classifyFallback(m).isComplaint) return "complaint";
  return "none";
}

const data = JSON.parse(readFileSync(join(process.cwd(), "evals/robustness/bases.json"), "utf8")) as { bases: Base[] };

describe("bozulmalar kodla, tekrarlanabilir", () => {
  it("aynı girdi aynı bozulmayı üretir; yazım hatası en az bir sözcüğü değiştirir", () => {
    const m = "Anahtarı kaybettim, ne yapmalıyız?";
    expect(typos(m)).toBe(typos(m));
    expect(typos(m)).not.toBe(m);
    expect(perturb(m, "tr", "P4")).toBe("Anahtari kaybettim, ne yapmaliyiz?");
    expect(perturb(m, "tr", "P1")).toBe("Anahtarı kaybettim ne yapmalıyız");
    expect(perturb("İçeri", "tr", "P3l")).toBe("içeri");
  });
});

describe.skipIf(!process.env.RUN_ROBUSTNESS)("sözcük ağları — temiz / bozuk değişmezliği", () => {
  it("ölçer + rapor", () => {
    type Row = { id: string; lang: string; truth: Verdict; base: Verdict; variants: Record<Perturbation, { text: string; v: Verdict }> };
    const rows: Row[] = data.bases.map((b) => {
      const variants = {} as Row["variants"];
      for (const p of PERTURBATIONS) {
        const text = perturb(b.message, b.lang, p);
        variants[p] = { text, v: verdict(text) };
      }
      return { id: b.id, lang: b.lang, truth: b.truth, base: verdict(b.message), variants };
    });
    const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}% (${n}/${d})`);
    const lines: string[] = [];
    lines.push(`# Sağlamlık — sözcük ağları, temiz / bozuk (kol 1, modelsiz) — ${new Date().toISOString().slice(0, 10)}`);
    lines.push("");
    lines.push(`Temel: ${rows.length} mesaj, ${[...new Set(rows.map((r) => r.lang))].join(" ")}. Hüküm: acil → erişim kaybı → şikâyet → yok.`);
    lines.push(`Temel doğruluk: ${pct(rows.filter((r) => r.base === r.truth).length, rows.length)}`);
    lines.push("");
    lines.push("| bozulma | değişmezlik (bozuk = temel) | doğruluk (bozuk = olması gereken) |");
    lines.push("|---|---|---|");
    for (const p of PERTURBATIONS) {
      const inv = rows.filter((r) => r.variants[p].v === r.base).length;
      const acc = rows.filter((r) => r.variants[p].v === r.truth).length;
      lines.push(`| ${p} | ${pct(inv, rows.length)} | ${pct(acc, rows.length)} |`);
    }
    lines.push("");
    lines.push("## Dile göre (P11 = noktalama yok + aksansız + yazım hatası + küçük harf)");
    lines.push("| dil | temel doğru | P5 doğru | P11 doğru |");
    lines.push("|---|---|---|---|");
    for (const lang of [...new Set(rows.map((r) => r.lang))]) {
      const rs = rows.filter((r) => r.lang === lang);
      lines.push(
        `| ${lang} | ${pct(rs.filter((r) => r.base === r.truth).length, rs.length)} | ${pct(rs.filter((r) => r.variants.P5.v === r.truth).length, rs.length)} | ${pct(rs.filter((r) => r.variants.P11.v === r.truth).length, rs.length)} |`,
      );
    }
    lines.push("");
    lines.push("## Hükmü değişen vakalar");
    lines.push("| id | olması gereken | temel | bozulma | bozuk metin | bozuk hüküm |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of rows) {
      for (const p of PERTURBATIONS) {
        if (r.variants[p].v !== r.base) lines.push(`| ${r.id} | ${r.truth} | ${r.base} | ${p} | ${r.variants[p].text.replace(/\|/g, "/")} | ${r.variants[p].v} |`);
      }
    }
    const report = lines.join("\n") + "\n";
    console.log(report);
    if (process.env.EVAL_WRITE_REPORT === "1") {
      const day = new Date().toISOString().slice(0, 10);
      writeFileSync(join(process.cwd(), `docs/olcum/robustness-kelime-agi-${day}.md`), report);
      writeFileSync(join(process.cwd(), `docs/olcum/robustness-kelime-agi-${day}.json`), JSON.stringify(rows, null, 1) + "\n");
    }
    expect(rows.length).toBe(data.bases.length);
  });
});
